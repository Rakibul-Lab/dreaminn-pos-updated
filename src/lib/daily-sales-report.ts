import { db } from '@/lib/db'
import {
  buildCheckInsDuringWindowWhere,
  buildCheckOutsDuringWindowWhere,
  buildBusinessDayWindowWhere,
} from '@/lib/business-date'
import type { BusinessDayWindow } from '@/lib/hotel-pms-reports'
import {
  computeDailySalesBalances,
  getStoredBalancesForDate,
  resolveOpeningBalance,
  type DailySalesBalances,
} from '@/lib/daily-sales-balance'
import { resolveBookingRegistrationNumber } from '@/lib/booking-registration'
import { filterGuestFolioRestaurantOrders } from '@/lib/restaurant-order-billing'
import { isGuestFolioManualRestaurantBill } from '@/lib/booking-restaurant-bill.shared'
import { parseBookingRestaurantBillNotes } from '@/lib/booking-restaurant-bill-notes'
import { PAYMENT_METHOD_OPTIONS } from '@/lib/payment-method'
import {
  beverageSaleNumberFromPayment,
  resolvePaymentGuestName,
  resolvePaymentReference,
  resolvePaymentRoomNumber,
  resolvePaymentSourceLabel,
} from '@/lib/daily-payment-labels'
import {
  computeCashReconciliation,
  mapHeadOfficeRemittances,
  type CashReconciliation,
  type HeadOfficeRemittanceRow,
} from '@/lib/hotel-cash-reconciliation'
import {
  fetchInHouseBookingDiscountsForWindow,
  sumInHouseBookingDiscounts,
} from '@/lib/in-house-booking-discount'
import { resolveChargeLineTotal } from '@/lib/daily-sales-paper-format'

export type DailySalesLine = {
  id: string
  lineType: 'charge' | 'payment'
  source:
    | 'invoice'
    | 'restaurant'
    | 'beverage'
    | 'guest-restaurant-bill'
    | 'payment'
  guestName: string | null
  room: string | null
  regNo: string | null
  roomAmount: number
  otherService: number
  cash: number
  card: number
  mbanking: number
  companyBill: number
  remark: string | null
  total: number
  reference: string | null
  sortAt: string
}

export type DailySalesReportSummary = {
  checkIns: number
  checkOuts: number
  occupiedRooms: number
  totalRooms: number
}

export type DailySalesDetailReport = {
  reportType: 'hotel-daily-sales'
  businessDate: string
  businessDateDisplay: string
  window: { openedAt: string; closedAt: string }
  openingBalance: number
  lines: DailySalesLine[]
  balances: DailySalesBalances
  summary: DailySalesReportSummary
  hotel: {
    roomSales: number
    foodSales: number
    extraSales: number
    discount: number
    vat: number
    invoiceTotal: number
    invoicePaid: number
    invoiceDue: number
    invoiceCount: number
    beverageWalkInSales: number
    beverageRoomSales: number
    beverageSales: number
    /** Hotel-side total: room invoices + walk-in beverage (not restaurant POS). */
    hotelSalesTotal: number
  }
  restaurant: {
    grossSales: number
    vat: number
    discount: number
    orderCount: number
  }
  totalDiscount: number
  grandTotal: number
  collections: number
  cashReconciliation: CashReconciliation
  headOfficeRemittances: HeadOfficeRemittanceRow[]
  billBreakdown: {
    hotelBills: number
    restaurantBills: number
  }
}

const MBANKING_METHODS = new Set(['MOBILE_BANKING', 'BKASH', 'NAGAD', 'UPAY', 'BANK'])

function invoiceWindowWhere(businessDate: string, openedAt: Date, closedAt: Date) {
  return {
    status: { not: 'CANCELLED' as const },
    OR: [
      { businessDate },
      {
        businessDate: null,
        OR: [
          { issuedAt: { gte: openedAt, lte: closedAt } },
          {
            AND: [{ issuedAt: null }, { createdAt: { gte: openedAt, lte: closedAt } }],
          },
        ],
      },
    ],
  }
}

function paymentWindowWhere(businessDate: string, openedAt: Date, closedAt: Date) {
  const windowWhere = buildBusinessDayWindowWhere(businessDate, openedAt, closedAt)
  return {
    OR: [
      ...windowWhere.OR,
      {
        notes: { contains: 'Beverage walk-in sale' },
        createdAt: { gte: openedAt, lte: closedAt },
      },
      {
        reference: { startsWith: 'BEV-' },
        createdAt: { gte: openedAt, lte: closedAt },
      },
    ],
  }
}

function resolvePaymentMethodValueFromLabel(label: string | null | undefined): string | null {
  if (!label?.trim()) return null
  const normalized = label.trim().toLowerCase()
  const match = PAYMENT_METHOD_OPTIONS.find(
    (option) =>
      option.label.toLowerCase() === normalized ||
      option.value.toLowerCase() === normalized.replace(/\s+/g, '_')
  )
  return match?.value ?? null
}

/** Map Add Restaurant Bill payment method (stored in notes) to report columns. */
function allocateFromRestaurantBillPaymentLabel(
  paymentMethodLabel: string | null | undefined,
  amount: number
) {
  if (amount <= 0) return { cash: 0, card: 0, mbanking: 0 }

  const method = resolvePaymentMethodValueFromLabel(paymentMethodLabel)
  if (method === 'CASH') return { cash: amount, card: 0, mbanking: 0 }
  if (method === 'CARD') return { cash: 0, card: amount, mbanking: 0 }
  if (method && MBANKING_METHODS.has(method)) return { cash: 0, card: 0, mbanking: amount }

  const normalized = paymentMethodLabel?.trim().toLowerCase() ?? ''
  if (normalized === 'cash') return { cash: amount, card: 0, mbanking: 0 }
  if (normalized === 'card') return { cash: 0, card: amount, mbanking: 0 }
  if (
    ['mobile banking', 'bkash', 'nagad', 'upay', 'bank'].includes(normalized)
  ) {
    return { cash: 0, card: 0, mbanking: amount }
  }

  return { cash: 0, card: 0, mbanking: 0 }
}

function sumGuestRestaurantBillPaymentAllocation(
  bookingId: string,
  restaurantOrders: Array<{
    bookingId?: string | null
    notes?: string | null
    totalAmount: number
  }>
) {
  let cash = 0
  let card = 0
  let mbanking = 0
  let billTotal = 0

  for (const order of restaurantOrders) {
    if (order.bookingId !== bookingId) continue
    if (!isGuestFolioManualRestaurantBill(order)) continue

    billTotal += order.totalAmount
    const parsed = parseBookingRestaurantBillNotes(order.notes ?? null)
    const allocation = allocateFromRestaurantBillPaymentLabel(
      parsed.paymentMethod,
      order.totalAmount
    )
    cash += allocation.cash
    card += allocation.card
    mbanking += allocation.mbanking
  }

  return { cash, card, mbanking, billTotal }
}

/** Scale guest bill payment columns to match checkout invoice food total. */
function resolveCheckoutFoodPaymentAllocation(
  bookingId: string,
  restaurantOrders: Array<{
    bookingId?: string | null
    notes?: string | null
    totalAmount: number
  }>,
  foodExtra: number
) {
  const { cash, card, mbanking, billTotal } = sumGuestRestaurantBillPaymentAllocation(
    bookingId,
    restaurantOrders
  )

  if (foodExtra <= 0 || billTotal <= 0) {
    return { cash: 0, card: 0, mbanking: 0 }
  }

  const paymentTotal = cash + card + mbanking
  if (paymentTotal <= 0) {
    return { cash: 0, card: 0, mbanking: 0 }
  }

  if (Math.abs(billTotal - foodExtra) <= 0.01) {
    return {
      cash: Number(cash.toFixed(2)),
      card: Number(card.toFixed(2)),
      mbanking: Number(mbanking.toFixed(2)),
    }
  }

  const scale = foodExtra / billTotal
  let scaledCash = cash * scale
  let scaledCard = card * scale
  let scaledMbanking = mbanking * scale
  const drift = foodExtra - (scaledCash + scaledCard + scaledMbanking)

  if (Math.abs(drift) > 0.001) {
    if (scaledCash > 0) scaledCash += drift
    else if (scaledCard > 0) scaledCard += drift
    else scaledMbanking += drift
  }

  return {
    cash: Number(scaledCash.toFixed(2)),
    card: Number(scaledCard.toFixed(2)),
    mbanking: Number(scaledMbanking.toFixed(2)),
  }
}

function allocateSinglePaymentAmounts(payment: { amount: number; method: string; paymentType: string }) {
  if (payment.paymentType === 'REFUND') {
    const amount = Math.abs(payment.amount)
    if (payment.method === 'CASH') return { cash: -amount, card: 0, mbanking: 0 }
    if (payment.method === 'CARD') return { cash: 0, card: -amount, mbanking: 0 }
    if (MBANKING_METHODS.has(payment.method)) return { cash: 0, card: 0, mbanking: -amount }
    return { cash: -amount, card: 0, mbanking: 0 }
  }

  const amount = payment.amount
  if (payment.method === 'CASH') return { cash: amount, card: 0, mbanking: 0 }
  if (payment.method === 'CARD') return { cash: 0, card: amount, mbanking: 0 }
  if (MBANKING_METHODS.has(payment.method)) return { cash: 0, card: 0, mbanking: amount }
  return { cash: amount, card: 0, mbanking: 0 }
}

function buildCheckoutInvoiceRoomRemark(invoiceNumber: string, extra?: string | null): string {
  return [`Room sale · Checkout · ${invoiceNumber}`, extra].filter(Boolean).join(' · ')
}

function buildCheckoutInvoiceFoodRemark(
  invoiceNumber: string,
  extra?: string | null
): string {
  return [`Food & service sale · Checkout · ${invoiceNumber}`, extra]
    .filter(Boolean)
    .join(' · ')
}

function buildRestaurantSaleRemark(orderNumber: string, companyName?: string | null): string {
  const base = `Restaurant sale · #${orderNumber}`
  return companyName ? `${base} · ${companyName}` : base
}

function buildGuestRestaurantBillRemark(notes: string | null): string {
  const parsed = parseBookingRestaurantBillNotes(notes)
  const parts = ['Guest restaurant bill (Add restaurant bill)']
  if (parsed.billNo !== '—') parts.push(`Bill ${parsed.billNo}`)
  if (parsed.paymentMethod) parts.push(`Pay: ${parsed.paymentMethod}`)
  return parts.join(' · ')
}

function buildCheckoutRestaurantBillRemark(
  bookingId: string,
  restaurantOrders: Array<{ bookingId?: string | null; notes?: string | null }>
): string | null {
  const bills = restaurantOrders.filter(
    (order) => order.bookingId === bookingId && isGuestFolioManualRestaurantBill(order)
  )
  if (!bills.length) return null

  const details = bills
    .map((order) => {
      const parsed = parseBookingRestaurantBillNotes(order.notes ?? null)
      return parsed.paymentMethod
        ? `${parsed.billNo} (${parsed.paymentMethod})`
        : parsed.billNo
    })
    .join('; ')

  return `Guest restaurant bills: ${details}`
}

function sortSalesLines(lines: DailySalesLine[]): DailySalesLine[] {
  return [...lines].sort(
    (a, b) => new Date(a.sortAt).getTime() - new Date(b.sortAt).getTime()
  )
}

function checkoutInvoiceIdsWithPayments(
  payments: Array<{ invoiceId: string | null }>
): Set<string> {
  return new Set(
    payments
      .filter((payment) => payment.invoiceId)
      .map((payment) => payment.invoiceId as string)
  )
}

function shouldSkipInvoiceChargeLines(
  invoice: {
    id: string
    dueAmount: number
    paidAmount: number
    totalAmount: number
  },
  invoiceIdsWithCheckoutPayments: Set<string>
): boolean {
  if (invoiceIdsWithCheckoutPayments.has(invoice.id)) return true
  return (
    invoice.totalAmount > 0 &&
    invoice.dueAmount <= 0.01 &&
    invoice.paidAmount >= invoice.totalAmount - 0.01
  )
}

function suppressedCheckoutInvoiceChargeTotal(
  invoices: Array<{ id: string; totalAmount: number }>,
  invoiceIdsWithCheckoutPayments: Set<string>
): number {
  return invoices
    .filter((invoice) => invoiceIdsWithCheckoutPayments.has(invoice.id))
    .reduce((sum, invoice) => sum + invoice.totalAmount, 0)
}

/** Booking advances, reservation payments, walk-in beverage, etc. — not already on charge lines. */
function uncapturedPaymentSalesTotal(
  payments: Array<{
    amount: number
    paymentType: string
    invoiceId: string | null
    orderId: string | null
  }>
): number {
  return Number(
    payments
      .reduce((sum, payment) => {
        if (payment.invoiceId || payment.orderId) return sum
        if (payment.paymentType === 'REFUND') return sum - Math.abs(payment.amount)
        return sum + payment.amount
      }, 0)
      .toFixed(2)
  )
}

function computeReportBillBreakdown(
  lines: DailySalesLine[],
  invoices: Array<{ id: string; totalAmount: number }>,
  invoiceIdsWithCheckoutPayments: Set<string>
): { hotelBills: number; restaurantBills: number } {
  let hotelBills = 0
  let restaurantBills = 0
  for (const line of lines) {
    if (line.lineType !== 'charge') continue
    const total = resolveChargeLineTotal(line.total ?? 0, {
      companyBill: line.companyBill,
      cash: line.cash,
      card: line.card,
      mbanking: line.mbanking,
    })
    if (total <= 0) continue
    if (line.source === 'invoice' || line.source === 'beverage') {
      hotelBills += total > 0 ? total : 0
    } else if (line.source === 'restaurant' || line.source === 'guest-restaurant-bill') {
      restaurantBills += total
    }
  }
  hotelBills += suppressedCheckoutInvoiceChargeTotal(invoices, invoiceIdsWithCheckoutPayments)
  return {
    hotelBills: Number(hotelBills.toFixed(2)),
    restaurantBills: Number(restaurantBills.toFixed(2)),
  }
}

export async function buildDailySalesDetailReport(
  window: BusinessDayWindow
): Promise<DailySalesDetailReport> {
  const { businessDate, openedAt, closedAt } = window
  const windowWhere = buildBusinessDayWindowWhere(businessDate, openedAt, closedAt)
  const orderWhere = {
    ...windowWhere,
    status: { not: 'CANCELLED' as const },
  }

  const openingBalance = await resolveOpeningBalance(businessDate)
  const storedBalances = await getStoredBalancesForDate(businessDate)

  const [
    invoices,
    restaurantOrders,
    allPayments,
    beverageSales,
    companyBills,
    checkIns,
    checkOuts,
    occupiedRooms,
    totalRooms,
    headOfficeDeposits,
    inHouseBookingDiscounts,
  ] = await Promise.all([
    db.invoice.findMany({
      where: invoiceWindowWhere(businessDate, openedAt, closedAt),
      include: {
        booking: {
          include: {
            customer: { select: { name: true, registrationNumber: true, company: true } },
            room: { select: { roomNumber: true } },
            companyLedger: { select: { name: true } },
            sourceReservationEntry: { select: { registrationNumber: true } },
            companyLedgerGuest: { select: { registrationNumber: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.restaurantOrder.findMany({
      where: orderWhere,
      include: {
        room: { select: { roomNumber: true } },
        booking: {
          include: {
            customer: { select: { name: true, registrationNumber: true } },
            sourceReservationEntry: { select: { registrationNumber: true } },
            companyLedgerGuest: { select: { registrationNumber: true } },
          },
        },
        companyLedgerBill: {
          include: { companyLedger: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.payment.findMany({
      where: paymentWindowWhere(businessDate, openedAt, closedAt),
      include: {
        booking: {
          include: {
            customer: { select: { name: true, registrationNumber: true } },
            room: { select: { roomNumber: true } },
            sourceReservationEntry: { select: { registrationNumber: true } },
            companyLedgerGuest: { select: { registrationNumber: true } },
          },
        },
        invoice: {
          select: {
            invoiceNumber: true,
            booking: { select: { room: { select: { roomNumber: true } } } },
          },
        },
        order: {
          select: {
            orderNumber: true,
            orderType: true,
            bookingId: true,
            notes: true,
            room: { select: { roomNumber: true } },
          },
        },
        reservationEntry: {
          select: {
            guestName: true,
            registrationNumber: true,
            lines: {
              take: 1,
              select: {
                room: { select: { roomNumber: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.hotelBeverageSale.findMany({
      where: { createdAt: { gte: openedAt, lte: closedAt } },
      include: {
        room: { select: { roomNumber: true } },
        booking: {
          include: {
            customer: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.companyLedgerBill.findMany({
      where: {
        billedAt: { gte: openedAt, lte: closedAt },
      },
      include: {
        companyLedger: { select: { name: true } },
      },
    }),
    db.booking.count({ where: buildCheckInsDuringWindowWhere(openedAt, closedAt) }),
    db.booking.count({ where: buildCheckOutsDuringWindowWhere(openedAt, closedAt) }),
    db.room.count({ where: { status: 'OCCUPIED' } }),
    db.room.count(),
    db.hotelDeposit.findMany({
      where: windowWhere,
      select: {
        id: true,
        amount: true,
        method: true,
        bankName: true,
        reference: true,
        notes: true,
        depositedAt: true,
        depositor: { select: { name: true } },
      },
      orderBy: { depositedAt: 'asc' },
    }),
    fetchInHouseBookingDiscountsForWindow(openedAt, closedAt),
  ])

  const lines: DailySalesLine[] = []
  const checkoutBookingIds = new Set(invoices.map((invoice) => invoice.bookingId))
  const invoiceIdsWithCheckoutPayments = checkoutInvoiceIdsWithPayments(allPayments)
  const coveredBeverageSaleNumbers = new Set<string>()

  for (const payment of allPayments) {
    const saleNumber = beverageSaleNumberFromPayment(payment)
    if (saleNumber) coveredBeverageSaleNumbers.add(saleNumber)

    const { cash, card, mbanking } = allocateSinglePaymentAmounts(payment)
    const roomNumber = resolvePaymentRoomNumber(payment)
    const guestName = resolvePaymentGuestName(payment)
    const booking = payment.booking

    lines.push({
      id: payment.id,
      lineType: 'payment',
      source: 'payment',
      guestName,
      room: roomNumber,
      regNo:
        (booking ? resolveBookingRegistrationNumber(booking) : null) ??
        payment.reservationEntry?.registrationNumber ??
        null,
      roomAmount: 0,
      otherService: 0,
      cash,
      card,
      mbanking,
      companyBill: 0,
      remark: resolvePaymentSourceLabel(payment),
      total: payment.paymentType === 'REFUND' ? -Math.abs(payment.amount) : payment.amount,
      reference: resolvePaymentReference(payment),
      sortAt: payment.createdAt.toISOString(),
    })
  }

  for (const invoice of invoices) {
    const booking = invoice.booking

    const ledgerBill = companyBills.find((b) => b.bookingId === booking.id)
    const onCompanyLedger = Boolean(booking.companyLedgerId || ledgerBill)
    const companyBill = onCompanyLedger
      ? ledgerBill?.dueAmount ?? invoice.dueAmount
      : 0

    const companyRemark =
      booking.companyLedger?.name ??
      booking.company ??
      booking.customer.company ??
      ledgerBill?.companyLedger.name ??
      null
    const restaurantBillRemark =
      invoice.foodCharges > 0
        ? buildCheckoutRestaurantBillRemark(booking.id, restaurantOrders)
        : null

    const sortAt = (invoice.issuedAt ?? invoice.createdAt).toISOString()
    const foodExtra = invoice.foodCharges + invoice.extraCharges
    const guestName = booking.customer.name
    const room = booking.room.roomNumber
    const regNo = resolveBookingRegistrationNumber(booking) || null

    // Same-day checkout payments appear as collection rows; fully prepaid checkouts
    // (advance on a prior day) omit invoice charge rows entirely.
    if (shouldSkipInvoiceChargeLines(invoice, invoiceIdsWithCheckoutPayments)) {
      continue
    }

    if (invoice.roomCharges > 0) {
      const roomCompanyBill = foodExtra > 0 ? 0 : companyBill
      lines.push({
        id: `${invoice.id}-room`,
        lineType: 'charge',
        source: 'invoice',
        guestName,
        room,
        regNo,
        roomAmount: invoice.roomCharges,
        otherService: 0,
        cash: 0,
        card: 0,
        mbanking: 0,
        companyBill: roomCompanyBill,
        remark: buildCheckoutInvoiceRoomRemark(invoice.invoiceNumber, companyRemark),
        total: resolveChargeLineTotal(invoice.roomCharges, { companyBill: roomCompanyBill }),
        reference: invoice.invoiceNumber,
        sortAt,
      })
    }

    if (foodExtra > 0) {
      const billPayment = restaurantBillRemark
        ? resolveCheckoutFoodPaymentAllocation(booking.id, restaurantOrders, foodExtra)
        : { cash: 0, card: 0, mbanking: 0 }
      const foodCompanyBill = invoice.roomCharges > 0 ? 0 : companyBill

      lines.push({
        id: `${invoice.id}-food`,
        lineType: 'charge',
        source: 'invoice',
        guestName,
        room,
        regNo,
        roomAmount: 0,
        otherService: foodExtra,
        cash: billPayment.cash,
        card: billPayment.card,
        mbanking: billPayment.mbanking,
        companyBill: foodCompanyBill,
        remark: buildCheckoutInvoiceFoodRemark(invoice.invoiceNumber, restaurantBillRemark),
        total: resolveChargeLineTotal(foodExtra, {
          companyBill: foodCompanyBill,
          cash: billPayment.cash,
          card: billPayment.card,
          mbanking: billPayment.mbanking,
        }),
        reference: invoice.invoiceNumber,
        sortAt,
      })
    }

    if (invoice.roomCharges <= 0 && foodExtra <= 0 && invoice.totalAmount > 0) {
      lines.push({
        id: invoice.id,
        lineType: 'charge',
        source: 'invoice',
        guestName,
        room,
        regNo,
        roomAmount: 0,
        otherService: invoice.totalAmount,
        cash: 0,
        card: 0,
        mbanking: 0,
        companyBill,
        remark: buildCheckoutInvoiceRoomRemark(invoice.invoiceNumber, companyRemark),
        total: resolveChargeLineTotal(invoice.totalAmount, { companyBill }),
        reference: invoice.invoiceNumber,
        sortAt,
      })
    }
  }

  for (const order of restaurantOrders) {
    if (!isGuestFolioManualRestaurantBill(order)) continue
    if (order.bookingId && checkoutBookingIds.has(order.bookingId)) continue

    const parsed = parseBookingRestaurantBillNotes(order.notes ?? null)
    const booking = order.booking
    const billPayment = allocateFromRestaurantBillPaymentLabel(
      parsed.paymentMethod,
      order.totalAmount
    )

    lines.push({
      id: order.id,
      lineType: 'charge',
      source: 'guest-restaurant-bill',
      guestName: order.customerName ?? booking?.customer.name ?? null,
      room: order.room?.roomNumber ?? null,
      regNo:
        parsed.billNo !== '—'
          ? parsed.billNo
          : booking
            ? resolveBookingRegistrationNumber(booking) || null
            : null,
      roomAmount: 0,
      otherService: order.totalAmount,
      cash: billPayment.cash,
      card: billPayment.card,
      mbanking: billPayment.mbanking,
      companyBill: 0,
      remark: buildGuestRestaurantBillRemark(order.notes ?? null),
      total: resolveChargeLineTotal(order.totalAmount, {
        cash: billPayment.cash,
        card: billPayment.card,
        mbanking: billPayment.mbanking,
      }),
      reference:
        parsed.billNo !== '—'
          ? parsed.billNo
          : order.orderNumber
            ? `#${order.orderNumber}`
            : order.id.slice(-6),
      sortAt: order.createdAt.toISOString(),
    })
  }

  for (const order of restaurantOrders) {
    if (isGuestFolioManualRestaurantBill(order)) continue
    if (filterGuestFolioRestaurantOrders([order]).length > 0) continue

    const ledgerBill = order.companyLedgerBill
    const companyBill = ledgerBill?.dueAmount ?? 0

    lines.push({
      id: order.id,
      lineType: 'charge',
      source: 'restaurant',
      guestName: order.customerName,
      room: order.room?.roomNumber ?? null,
      regNo: order.orderNumber ? `ORD-${order.orderNumber}` : null,
      roomAmount: 0,
      otherService: order.totalAmount,
      cash: 0,
      card: 0,
      mbanking: 0,
      companyBill,
      remark: buildRestaurantSaleRemark(
        order.orderNumber,
        ledgerBill?.companyLedger.name ?? null
      ),
      total: resolveChargeLineTotal(order.totalAmount, { companyBill }),
      reference: order.orderNumber ? `#${order.orderNumber}` : order.id.slice(-6),
      sortAt: order.createdAt.toISOString(),
    })
  }

  for (const sale of beverageSales) {
    if (sale.saleType === 'WALK_IN') {
      if (coveredBeverageSaleNumbers.has(sale.saleNumber)) continue

      lines.push({
        id: sale.id,
        lineType: 'charge',
        source: 'beverage',
        guestName: sale.customerName,
        room: null,
        regNo: sale.saleNumber,
        roomAmount: sale.totalAmount,
        otherService: 0,
        cash: 0,
        card: 0,
        mbanking: 0,
        companyBill: 0,
        remark: `Hotel beverage sale (walk-in) · ${sale.saleNumber}`,
        total: sale.totalAmount,
        reference: sale.saleNumber,
        sortAt: sale.createdAt.toISOString(),
      })
      continue
    }

    if (sale.saleType === 'ROOM') {
      lines.push({
        id: sale.id,
        lineType: 'charge',
        source: 'beverage',
        guestName: sale.customerName ?? sale.booking?.customer.name ?? null,
        room: sale.room?.roomNumber ?? null,
        regNo: sale.saleNumber,
        roomAmount: sale.totalAmount,
        otherService: 0,
        cash: 0,
        card: 0,
        mbanking: 0,
        companyBill: 0,
        remark: `Hotel beverage sale (room) · ${sale.saleNumber}`,
        total: sale.totalAmount,
        reference: sale.saleNumber,
        sortAt: sale.createdAt.toISOString(),
      })
    }
  }

  const sortedLines = sortSalesLines(lines)

  const roomSales = invoices.reduce((s, i) => s + i.roomCharges, 0)
  const guestManualFoodSales = sortedLines
    .filter((line) => line.source === 'guest-restaurant-bill')
    .reduce((sum, line) => sum + line.total, 0)
  const foodSales =
    invoices.reduce((s, i) => s + i.foodCharges, 0) + guestManualFoodSales
  const extraSales = invoices.reduce((s, i) => s + i.extraCharges, 0)
  const invoiceDiscount = invoices.reduce((s, i) => s + i.discount, 0)
  const inHouseBookingDiscount = sumInHouseBookingDiscounts(inHouseBookingDiscounts)
  const hotelDiscount = invoiceDiscount + inHouseBookingDiscount
  const invoiceVat = invoices.reduce((s, i) => s + i.vatAmount, 0)
  const invoiceTotal = invoices.reduce((s, i) => s + i.totalAmount, 0)
  const invoicePaid = invoices.reduce((s, i) => s + i.paidAmount, 0)
  const invoiceDue = invoices.reduce((s, i) => s + i.dueAmount, 0)

  const restaurantGross = restaurantOrders.reduce((s, o) => s + o.totalAmount, 0)
  const restaurantVat = restaurantOrders.reduce((s, o) => s + o.vatAmount, 0)
  const restaurantDiscount = restaurantOrders.reduce((s, o) => s + o.discount, 0)

  const beverageWalkInSales = beverageSales
    .filter((sale) => sale.saleType === 'WALK_IN')
    .reduce((s, sale) => s + sale.totalAmount, 0)
  const beverageRoomSales = beverageSales
    .filter((sale) => sale.saleType === 'ROOM')
    .reduce((s, sale) => s + sale.totalAmount, 0)
  const beverageSalesTotal = beverageWalkInSales + beverageRoomSales
  const hotelSalesTotal = invoiceTotal + beverageWalkInSales
  const totalDiscount = hotelDiscount + restaurantDiscount

  const chargeTotalFromLines = sortedLines
    .filter((line) => line.lineType === 'charge')
    .reduce((sum, line) => sum + line.total, 0)
  const chargeTotal =
    chargeTotalFromLines +
    suppressedCheckoutInvoiceChargeTotal(invoices, invoiceIdsWithCheckoutPayments) +
    uncapturedPaymentSalesTotal(allPayments)
  const billBreakdown = computeReportBillBreakdown(
    sortedLines,
    invoices,
    invoiceIdsWithCheckoutPayments
  )
  const companyBillTotal = companyBills.reduce((s, bill) => s + bill.dueAmount, 0)
  const balances =
    storedBalances ??
    computeDailySalesBalances(openingBalance, chargeTotal, companyBillTotal)

  const collections = allPayments.reduce((sum, payment) => {
    if (payment.paymentType === 'REFUND') return sum - Math.abs(payment.amount)
    return sum + payment.amount
  }, 0)

  const cashReconciliation = computeCashReconciliation(
    balances.openingBalance,
    sortedLines,
    headOfficeDeposits
  )
  const headOfficeRemittances = mapHeadOfficeRemittances(headOfficeDeposits)

  return {
    reportType: 'hotel-daily-sales',
    businessDate: window.businessDate,
    businessDateDisplay: window.businessDateDisplay,
    window: { openedAt: openedAt.toISOString(), closedAt: closedAt.toISOString() },
    openingBalance: balances.openingBalance,
    lines: sortedLines,
    balances,
    summary: {
      checkIns,
      checkOuts,
      occupiedRooms,
      totalRooms,
    },
    hotel: {
      roomSales,
      foodSales,
      extraSales,
      discount: hotelDiscount,
      vat: invoiceVat,
      invoiceTotal,
      invoicePaid,
      invoiceDue,
      invoiceCount: invoices.length,
      beverageWalkInSales,
      beverageRoomSales,
      beverageSales: beverageSalesTotal,
      hotelSalesTotal,
    },
    restaurant: {
      grossSales: restaurantGross,
      vat: restaurantVat,
      discount: restaurantDiscount,
      orderCount: restaurantOrders.length,
    },
    totalDiscount,
    grandTotal: openingBalance + collections,
    collections,
    cashReconciliation,
    headOfficeRemittances,
    billBreakdown,
  }
}
