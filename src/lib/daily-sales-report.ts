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
  isTransportSalePayment,
  transportSaleNumberFromPayment,
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
    | 'transport'
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
  /**
   * Part of `total` that came from the restaurant. Only set on checkout invoice
   * lines, where a guest's F&B bill is settled together with the room.
   */
  restaurantAmount?: number
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
    transportWalkInSales: number
    transportRoomSales: number
    transportSales: number
    /** Hotel-side total: room invoices + walk-in beverage (not restaurant POS or transport). */
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
    transportBills: number
  }
}

const MBANKING_METHODS = new Set(['MOBILE_BANKING', 'BKASH', 'NAGAD', 'UPAY', 'BANK'])

function invoiceWindowWhere(businessDate: string, openedAt: Date, closedAt: Date) {
  return {
    status: { not: 'CANCELLED' as const },
    // An invoice viewed or generated while the guest is still in house is only a
    // preview of the folio — the bill becomes a sale on the day the guest checks out.
    booking: { status: 'CHECKED_OUT' as const },
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
      {
        notes: { contains: 'Transport sale' },
        createdAt: { gte: openedAt, lte: closedAt },
      },
      {
        reference: { startsWith: 'TRN-' },
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

/**
 * When checkout invoice charge rows are hidden (same-day payments shown instead),
 * count only today's invoice-linked collections — never the full invoice.totalAmount.
 * Using full invoice inflated Total Sale by prior-day advances already paid.
 */
function suppressedCheckoutInvoiceCollections(
  invoiceIdsWithCheckoutPayments: Set<string>,
  payments: Array<{
    invoiceId: string | null
    amount: number
    paymentType: string
  }>
): Map<string, number> {
  const byInvoice = new Map<string, number>()
  if (invoiceIdsWithCheckoutPayments.size === 0) return byInvoice

  for (const payment of payments) {
    if (!payment.invoiceId || !invoiceIdsWithCheckoutPayments.has(payment.invoiceId)) {
      continue
    }
    const delta =
      payment.paymentType === 'REFUND' ? -Math.abs(payment.amount) : payment.amount
    byInvoice.set(payment.invoiceId, (byInvoice.get(payment.invoiceId) ?? 0) + delta)
  }

  return byInvoice
}

function suppressedCheckoutInvoiceCollectionsTotal(
  invoiceIdsWithCheckoutPayments: Set<string>,
  payments: Array<{
    invoiceId: string | null
    amount: number
    paymentType: string
  }>
): number {
  const byInvoice = suppressedCheckoutInvoiceCollections(
    invoiceIdsWithCheckoutPayments,
    payments
  )
  let total = 0
  for (const amount of byInvoice.values()) total += amount
  return Number(total.toFixed(2))
}

/** Booking advances, reservation payments, walk-in beverage, etc. — not already on charge lines. */
function uncapturedPaymentSalesTotal(
  payments: Array<{
    amount: number
    paymentType: string
    invoiceId: string | null
    orderId: string | null
    notes?: string | null
    reference?: string | null
  }>
): number {
  return Number(
    payments
      .reduce((sum, payment) => {
        if (payment.invoiceId || payment.orderId) return sum
        if (isTransportSalePayment(payment)) return sum
        if (payment.paymentType === 'REFUND') return sum - Math.abs(payment.amount)
        return sum + payment.amount
      }, 0)
      .toFixed(2)
  )
}

/**
 * Day sale that foots with printed rows: tender columns when present,
 * otherwise charge-line totals (posted sale with no cash/card yet).
 */
function sumReportSalesTotal(lines: DailySalesLine[]): number {
  return Number(
    lines
      .reduce((sum, line) => {
        const columnSum =
          (line.cash || 0) +
          (line.card || 0) +
          (line.mbanking || 0) +
          (line.companyBill || 0)
        if (Math.abs(columnSum) > 0.005) return sum + columnSum
        if (line.lineType === 'charge' && line.total) return sum + line.total
        return sum
      }, 0)
      .toFixed(2)
  )
}

function transportRoomFromSale(
  sale: { roomNumber?: string | null; room?: { roomNumber: string } | null } | undefined
): string | null {
  if (!sale) return null
  const manual = sale.roomNumber?.trim()
  if (manual) return manual
  return sale.room?.roomNumber ?? null
}

type TransportSaleForReport = {
  id: string
  saleNumber: string
  saleType: string
  customerName: string
  roomNumber?: string | null
  totalAmount: number
  createdAt: Date
  room?: { roomNumber: string } | null
  invoice?: { invoiceNumber: string } | null
}

type TransportPaymentBucket = {
  cash: number
  card: number
  mbanking: number
  sortAt: string
}

function buildTransportSalesReportLine(
  sale: TransportSaleForReport,
  bucket?: TransportPaymentBucket
): DailySalesLine {
  const invoiceRef = sale.invoice?.invoiceNumber ?? sale.saleNumber
  const guestLabel = sale.saleType === 'ROOM' ? 'in-house guest' : 'walk-in guest'
  const cash = bucket?.cash ?? 0
  const card = bucket?.card ?? 0
  const mbanking = bucket?.mbanking ?? 0

  return {
    id: sale.id,
    lineType: 'charge',
    source: 'transport',
    guestName: sale.customerName,
    room: transportRoomFromSale(sale),
    regNo: sale.saleNumber,
    roomAmount: 0,
    otherService: sale.totalAmount,
    cash,
    card,
    mbanking,
    companyBill: 0,
    remark: `Transport sale (${guestLabel}) · ${invoiceRef}`,
    total: resolveChargeLineTotal(sale.totalAmount, { cash, card, mbanking }),
    reference: invoiceRef,
    sortAt: bucket?.sortAt ?? sale.createdAt.toISOString(),
  }
}

type InvoiceBillMix = {
  id: string
  roomCharges: number
  foodCharges: number
  extraCharges: number
}

/**
 * Share of a checkout invoice that came from the restaurant. A guest's F&B bills
 * ride on the folio and are settled with the room, so the invoice has to be split
 * for the breakdown — otherwise restaurant sales are reported as hotel sales.
 */
function invoiceRestaurantShare(invoice: InvoiceBillMix | undefined): number {
  if (!invoice) return 0
  const chargeBase = invoice.roomCharges + invoice.foodCharges + invoice.extraCharges
  if (chargeBase <= 0 || invoice.foodCharges <= 0) return 0
  return Math.min(1, invoice.foodCharges / chargeBase)
}

function computeReportBillBreakdown(
  lines: DailySalesLine[],
  invoiceIdsWithCheckoutPayments: Set<string>,
  payments: Array<{
    invoiceId: string | null
    amount: number
    paymentType: string
  }>,
  transportBills: number,
  invoices: InvoiceBillMix[]
): { hotelBills: number; restaurantBills: number; transportBills: number } {
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
      const fromRestaurant = Math.min(total, Math.max(0, line.restaurantAmount ?? 0))
      restaurantBills += fromRestaurant
      hotelBills += total - fromRestaurant
    } else if (line.source === 'restaurant' || line.source === 'guest-restaurant-bill') {
      restaurantBills += total
    }
  }

  // Checkout invoices paid the same day show as collection rows instead of charge
  // rows, so split what was collected on each one the same way.
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]))
  const suppressedCollections = suppressedCheckoutInvoiceCollections(
    invoiceIdsWithCheckoutPayments,
    payments
  )
  for (const [invoiceId, collected] of suppressedCollections) {
    const share = invoiceRestaurantShare(invoiceById.get(invoiceId))
    restaurantBills += collected * share
    hotelBills += collected * (1 - share)
  }

  return {
    hotelBills: Number(hotelBills.toFixed(2)),
    restaurantBills: Number(restaurantBills.toFixed(2)),
    transportBills: Number(transportBills.toFixed(2)),
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
    transportSales,
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
    db.transportSale.findMany({
      where: {
        OR: [
          { createdAt: { gte: openedAt, lte: closedAt } },
          { businessDate },
        ],
      },
      include: {
        room: { select: { roomNumber: true } },
        booking: {
          include: {
            customer: { select: { name: true } },
          },
        },
        invoice: { select: { invoiceNumber: true } },
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
  const transportPaymentBuckets = new Map<string, TransportPaymentBucket>()
  const transportSaleByNumber = new Map(
    transportSales.map((sale) => [sale.saleNumber, sale] as const)
  )

  for (const payment of allPayments) {
    const saleNumber = beverageSaleNumberFromPayment(payment)
    if (saleNumber) coveredBeverageSaleNumbers.add(saleNumber)

    const transportSaleNumber = transportSaleNumberFromPayment(payment)
    if (transportSaleNumber && isTransportSalePayment(payment)) {
      const { cash, card, mbanking } = allocateSinglePaymentAmounts(payment)
      const bucket = transportPaymentBuckets.get(transportSaleNumber) ?? {
        cash: 0,
        card: 0,
        mbanking: 0,
        sortAt: payment.createdAt.toISOString(),
      }
      bucket.cash += cash
      bucket.card += card
      bucket.mbanking += mbanking
      if (payment.createdAt.toISOString() < bucket.sortAt) {
        bucket.sortAt = payment.createdAt.toISOString()
      }
      transportPaymentBuckets.set(transportSaleNumber, bucket)
      continue
    }

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
      const foodLineTotal = resolveChargeLineTotal(foodExtra, {
        companyBill: foodCompanyBill,
        cash: billPayment.cash,
        card: billPayment.card,
        mbanking: billPayment.mbanking,
      })

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
        total: foodLineTotal,
        restaurantAmount: Number(
          (foodLineTotal * (invoice.foodCharges / foodExtra)).toFixed(2)
        ),
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
    // Posting the bill raises the room due instead of taking money, so it is not a
    // sale yet — it reaches the report through the invoice on the check-out day.
    if (order.booking && order.booking.status !== 'CHECKED_OUT') continue

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
      // Minibar/room beverage is already on the checkout invoice when the guest settles today.
      if (sale.bookingId && checkoutBookingIds.has(sale.bookingId)) continue
      if (coveredBeverageSaleNumbers.has(sale.saleNumber)) continue

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

  const missingTransportSaleNumbers = [...transportPaymentBuckets.keys()].filter(
    (saleNumber) => !transportSaleByNumber.has(saleNumber)
  )
  if (missingTransportSaleNumbers.length > 0) {
    const extraTransportSales = await db.transportSale.findMany({
      where: { saleNumber: { in: missingTransportSaleNumbers } },
      include: {
        room: { select: { roomNumber: true } },
        booking: {
          include: {
            customer: { select: { name: true } },
          },
        },
        invoice: { select: { invoiceNumber: true } },
      },
    })
    for (const sale of extraTransportSales) {
      transportSaleByNumber.set(sale.saleNumber, sale)
      if (!transportSales.some((existing) => existing.id === sale.id)) {
        transportSales.push(sale)
      }
    }
  }

  for (const sale of transportSales) {
    const bucket = transportPaymentBuckets.get(sale.saleNumber)
    if (bucket) {
      transportPaymentBuckets.delete(sale.saleNumber)
    }
    lines.push(buildTransportSalesReportLine(sale, bucket))
  }

  for (const [saleNumber, bucket] of transportPaymentBuckets) {
    const sale = transportSaleByNumber.get(saleNumber)
    if (!sale) continue
    lines.push(buildTransportSalesReportLine(sale, bucket))
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
  const transportWalkInSales = transportSales
    .filter((sale) => sale.saleType === 'WALK_IN')
    .reduce((s, sale) => s + sale.totalAmount, 0)
  const transportRoomSales = transportSales
    .filter((sale) => sale.saleType === 'ROOM')
    .reduce((s, sale) => s + sale.totalAmount, 0)
  const transportSalesTotal = transportWalkInSales + transportRoomSales
  const hotelSalesTotal = invoiceTotal + beverageWalkInSales
  const totalDiscount = hotelDiscount + restaurantDiscount

  const chargeTotalFromLines = sumReportSalesTotal(sortedLines)
  // Prefer line-based total (foots with Cash/Card/M.Banking/Company columns).
  // Keep additive path only as a safety net if lines were empty but payments exist.
  const chargeTotal =
    chargeTotalFromLines > 0
      ? chargeTotalFromLines
      : suppressedCheckoutInvoiceCollectionsTotal(
          invoiceIdsWithCheckoutPayments,
          allPayments
        ) + uncapturedPaymentSalesTotal(allPayments)
  const billBreakdown = computeReportBillBreakdown(
    sortedLines,
    invoiceIdsWithCheckoutPayments,
    allPayments,
    transportSalesTotal,
    invoices
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
      transportWalkInSales,
      transportRoomSales,
      transportSales: transportSalesTotal,
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
