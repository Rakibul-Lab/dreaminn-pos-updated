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

export type DailySalesLine = {
  id: string
  source: 'invoice' | 'restaurant' | 'beverage'
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

function allocatePaymentAmounts(
  payments: Array<{ amount: number; method: string; paymentType: string }>
) {
  let cash = 0
  let card = 0
  let mbanking = 0
  for (const payment of payments) {
    if (payment.paymentType === 'REFUND') continue
    const amount = payment.amount
    if (payment.method === 'CASH') cash += amount
    else if (payment.method === 'CARD') card += amount
    else if (MBANKING_METHODS.has(payment.method)) mbanking += amount
  }
  return { cash, card, mbanking }
}

function allocateBeveragePaymentAmounts(
  method: string | null | undefined,
  amount: number
) {
  let cash = 0
  let card = 0
  let mbanking = 0
  if (method === 'CASH') cash = amount
  else if (method === 'CARD') card = amount
  else if (method && MBANKING_METHODS.has(method)) mbanking = amount
  else cash = amount
  return { cash, card, mbanking }
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
    beverageSales,
    companyBills,
    payments,
    checkIns,
    checkOuts,
    occupiedRooms,
    totalRooms,
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
            payments: {
              where: windowWhere,
              select: { amount: true, method: true, paymentType: true },
            },
          },
        },
        payments: {
          where: windowWhere,
          select: { amount: true, method: true, paymentType: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.restaurantOrder.findMany({
      where: orderWhere,
      include: {
        room: { select: { roomNumber: true } },
        payments: {
          where: windowWhere,
          select: { amount: true, method: true, paymentType: true },
        },
        companyLedgerBill: {
          include: { companyLedger: { select: { name: true } } },
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
    db.payment.findMany({
      where: windowWhere,
      select: { amount: true, paymentType: true },
    }),
    db.booking.count({ where: buildCheckInsDuringWindowWhere(openedAt, closedAt) }),
    db.booking.count({ where: buildCheckOutsDuringWindowWhere(openedAt, closedAt) }),
    db.room.count({ where: { status: 'OCCUPIED' } }),
    db.room.count(),
  ])

  const lines: DailySalesLine[] = []

  const bookingsWithFoodOnInvoice = new Set(
    invoices.filter((invoice) => invoice.foodCharges > 0).map((invoice) => invoice.bookingId)
  )

  for (const invoice of invoices) {
    const booking = invoice.booking
    const hotelPayments = [...invoice.payments, ...booking.payments].filter(
      (payment) => payment.paymentType !== 'RESTAURANT'
    )
    const { cash, card, mbanking } = allocatePaymentAmounts(hotelPayments)

    const ledgerBill = companyBills.find((b) => b.bookingId === booking.id)
    const onCompanyLedger = Boolean(booking.companyLedgerId || ledgerBill)
    const companyBill = onCompanyLedger
      ? ledgerBill?.dueAmount ?? invoice.dueAmount
      : 0

    const remark =
      booking.companyLedger?.name ??
      booking.company ??
      booking.customer.company ??
      ledgerBill?.companyLedger.name ??
      null

    lines.push({
      id: invoice.id,
      source: 'invoice',
      guestName: booking.customer.name,
      room: booking.room.roomNumber,
      regNo: resolveBookingRegistrationNumber(booking) || null,
      roomAmount: invoice.roomCharges,
      otherService: invoice.foodCharges + invoice.extraCharges,
      cash,
      card,
      mbanking,
      companyBill,
      remark,
      total: invoice.totalAmount,
      reference: invoice.invoiceNumber,
    })
  }

  for (const order of restaurantOrders) {
    if (order.bookingId && bookingsWithFoodOnInvoice.has(order.bookingId)) {
      continue
    }

    const { cash, card, mbanking } = allocatePaymentAmounts(order.payments)
    const ledgerBill = order.companyLedgerBill
    const companyBill = ledgerBill?.dueAmount ?? 0

    lines.push({
      id: order.id,
      source: 'restaurant',
      guestName: order.customerName,
      room: order.room?.roomNumber ?? null,
      regNo: order.orderNumber ? `ORD-${order.orderNumber}` : null,
      roomAmount: 0,
      otherService: order.totalAmount,
      cash,
      card,
      mbanking,
      companyBill,
      remark: ledgerBill?.companyLedger.name ?? null,
      total: order.totalAmount,
      reference: order.orderNumber ? `#${order.orderNumber}` : order.id.slice(-6),
    })
  }

  for (const sale of beverageSales) {
    if (sale.saleType !== 'WALK_IN') continue

    const { cash, card, mbanking } = allocateBeveragePaymentAmounts(
      sale.paymentMethod,
      sale.totalAmount
    )
    lines.push({
      id: sale.id,
      source: 'beverage',
      guestName: sale.customerName,
      room: null,
      regNo: sale.saleNumber,
      roomAmount: sale.totalAmount,
      otherService: 0,
      cash,
      card,
      mbanking,
      companyBill: 0,
      remark: 'Hotel beverage (walk-in)',
      total: sale.totalAmount,
      reference: sale.saleNumber,
    })
  }

  const roomSales = invoices.reduce((s, i) => s + i.roomCharges, 0)
  const foodSales = invoices.reduce((s, i) => s + i.foodCharges, 0)
  const extraSales = invoices.reduce((s, i) => s + i.extraCharges, 0)
  const invoiceDiscount = invoices.reduce((s, i) => s + i.discount, 0)
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
  const totalDiscount = invoiceDiscount + restaurantDiscount

  const salesTotal = lines.reduce((s, line) => s + line.total, 0)
  const companyBillTotal = companyBills.reduce((s, bill) => s + bill.dueAmount, 0)
  const balances =
    storedBalances ??
    computeDailySalesBalances(openingBalance, salesTotal, companyBillTotal)

  const collections = payments
    .filter((p) => p.paymentType !== 'REFUND')
    .reduce((s, p) => s + p.amount, 0)

  return {
    reportType: 'hotel-daily-sales',
    businessDate: window.businessDate,
    businessDateDisplay: window.businessDateDisplay,
    window: { openedAt: openedAt.toISOString(), closedAt: closedAt.toISOString() },
    openingBalance: balances.openingBalance,
    lines,
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
      discount: invoiceDiscount,
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
    grandTotal: balances.grandTotal,
    collections,
  }
}
