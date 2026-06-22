import { endOfDay } from 'date-fns'
import { db } from '@/lib/db'
import {
  buildBusinessDayArrivalsWhere,
  buildBusinessDayDeparturesWhere,
  buildBusinessDayWindowWhere,
  buildCheckInsDuringWindowWhere,
  buildCheckOutsDuringWindowWhere,
  formatBusinessDateDisplay,
  getCalendarDayBounds,
  getLastDayClose,
  isValidBusinessDateString,
  readCurrentBusinessDateString,
} from '@/lib/business-date'
import { formatPaymentMethod } from '@/lib/payment-method'
import { buildDailySalesDetailReport } from '@/lib/daily-sales-report'
import { buildHotelDailyDiscountReport } from '@/lib/hotel-daily-discount-report'
import {
  beverageSaleNumberFromPayment,
  resolvePaymentReference,
  resolvePaymentRoomNumber,
  resolvePaymentSourceLabel,
} from '@/lib/daily-payment-labels'

export type { DailyDiscountReport, DailyDiscountLine } from '@/lib/hotel-daily-discount-report'
export { buildHotelDailyDiscountReport }

export type BusinessDayWindow = {
  businessDate: string
  businessDateDisplay: string
  openedAt: Date
  closedAt: Date
}

/** Booking collections should mention the room number in the purpose label. */
export function formatCollectionPurposeLabel(
  purpose: string,
  roomNumber?: string | null
): string {
  if (roomNumber && !purpose.includes(`Room ${roomNumber}`)) {
    return `${purpose} · Room ${roomNumber}`
  }
  return purpose
}

export async function resolveBusinessDayReportWindow(
  businessDateParam?: string | null
): Promise<BusinessDayWindow> {
  const current = await readCurrentBusinessDateString()
  const businessDate =
    businessDateParam && isValidBusinessDateString(businessDateParam)
      ? businessDateParam.trim()
      : current

  const closedDay = await db.dayClose.findUnique({ where: { businessDate } })
  if (closedDay) {
    return {
      businessDate,
      businessDateDisplay: formatBusinessDateDisplay(businessDate),
      openedAt: closedDay.openedAt,
      closedAt: closedDay.closedAt,
    }
  }

  const { start: calendarStart } = getCalendarDayBounds(businessDate)
  const lastClose = await getLastDayClose()
  const openedAt =
    lastClose && lastClose.businessDate !== businessDate
      ? lastClose.closedAt
      : lastClose?.openedAt ?? calendarStart

  const closedAt = businessDate === current ? new Date() : endOfDay(calendarStart)

  return {
    businessDate,
    businessDateDisplay: formatBusinessDateDisplay(businessDate),
    openedAt,
    closedAt,
  }
}

export function resolveDateRangeReportWindow(input: {
  dateFrom?: string | null
  dateTo?: string | null
}): BusinessDayWindow | null {
  const dateFrom = (input.dateFrom ?? '').trim()
  const dateTo = (input.dateTo ?? '').trim()
  if (!dateFrom && !dateTo) return null

  const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null
  const to = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null
  const openedAt = from && Number.isFinite(from.getTime()) ? from : null
  const closedAt = to && Number.isFinite(to.getTime()) ? to : null
  if (!openedAt && !closedAt) return null

  const safeOpenedAt = openedAt ?? new Date(closedAt!.getTime())
  const safeClosedAt = closedAt ?? new Date(safeOpenedAt.getTime())

  const fromLabel = dateFrom ? formatBusinessDateDisplay(dateFrom) : '—'
  const toLabel = dateTo ? formatBusinessDateDisplay(dateTo) : '—'
  const businessDate = dateFrom || dateTo

  return {
    businessDate,
    businessDateDisplay: `${fromLabel} → ${toLabel}`,
    openedAt: safeOpenedAt,
    closedAt: safeClosedAt,
  }
}

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

export async function buildHotelDailySalesReport(window: BusinessDayWindow) {
  return buildDailySalesDetailReport(window)
}

export async function buildHotelDailyArrivalsReport(window: BusinessDayWindow) {
  const { businessDate, openedAt, closedAt } = window

  const [rows, actualCount, expectedCount] = await Promise.all([
    db.booking.findMany({
      where: buildBusinessDayArrivalsWhere(businessDate, openedAt, closedAt),
      include: {
        customer: { select: { name: true, phone: true } },
        room: { select: { roomNumber: true, type: { select: { name: true } } } },
        companyLedger: { select: { name: true } },
      },
      orderBy: [{ status: 'asc' }, { checkIn: 'asc' }],
    }),
    db.booking.count({ where: buildCheckInsDuringWindowWhere(openedAt, closedAt) }),
    db.booking.count({
      where: {
        status: 'RESERVED',
        checkIn: {
          gte: getCalendarDayBounds(businessDate).start,
          lte: getCalendarDayBounds(businessDate).end,
        },
      },
    }),
  ])

  return {
    reportType: 'hotel-daily-arrivals' as const,
    businessDate: window.businessDate,
    businessDateDisplay: window.businessDateDisplay,
    actualCheckIns: actualCount,
    expectedArrivals: expectedCount,
    totalListed: rows.length,
    guests: rows.map((b) => ({
      id: b.id,
      guestName: b.customer.name,
      phone: b.customer.phone,
      roomNumber: b.room.roomNumber,
      roomType: b.room.type.name,
      status: b.status,
      company: b.companyLedger?.name ?? b.company ?? null,
      scheduledCheckIn: b.checkIn.toISOString(),
      actualCheckIn: b.actualCheckIn?.toISOString() ?? null,
      nights: b.totalRoomCharge,
      adults: b.adults,
      children: b.children,
    })),
  }
}

export async function buildHotelDailyDeparturesReport(window: BusinessDayWindow) {
  const { businessDate, openedAt, closedAt } = window

  const [rows, actualCount] = await Promise.all([
    db.booking.findMany({
      where: buildBusinessDayDeparturesWhere(businessDate),
      include: {
        customer: { select: { name: true, phone: true } },
        room: { select: { roomNumber: true, type: { select: { name: true } } } },
        invoices: {
          where: { status: { not: 'CANCELLED' } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { totalAmount: true, paidAmount: true, dueAmount: true, invoiceNumber: true },
        },
      },
      orderBy: { checkOut: 'asc' },
    }),
    db.booking.count({ where: buildCheckOutsDuringWindowWhere(openedAt, closedAt) }),
  ])

  return {
    reportType: 'hotel-daily-departures' as const,
    businessDate: window.businessDate,
    businessDateDisplay: window.businessDateDisplay,
    actualCheckOuts: actualCount,
    totalListed: rows.length,
    guests: rows.map((b) => {
      const inv = b.invoices[0]
      return {
        id: b.id,
        guestName: b.customer.name,
        phone: b.customer.phone,
        roomNumber: b.room.roomNumber,
        status: b.status,
        scheduledCheckOut: b.checkOut.toISOString(),
        actualCheckOut: b.actualCheckOut?.toISOString() ?? null,
        invoiceNumber: inv?.invoiceNumber ?? null,
        invoiceTotal: inv?.totalAmount ?? b.totalRoomCharge,
        paidAmount: inv?.paidAmount ?? 0,
        dueAmount: inv?.dueAmount ?? b.dueAmount,
      }
    }),
  }
}

export async function buildHotelDailyCollectionsReport(window: BusinessDayWindow) {
  const { businessDate, openedAt, closedAt } = window
  const windowWhere = buildBusinessDayWindowWhere(businessDate, openedAt, closedAt)

  const [salesReport, payments, beverageWalkInSales] = await Promise.all([
    buildDailySalesDetailReport(window),
    db.payment.findMany({
      where: {
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
      },
      select: {
        id: true,
        amount: true,
        method: true,
        paymentType: true,
        createdAt: true,
        notes: true,
        reference: true,
        settlementSource: true,
        booking: {
          select: {
            id: true,
            customer: { select: { name: true } },
            room: { select: { roomNumber: true } },
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
        receiver: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.hotelBeverageSale.findMany({
      where: {
        saleType: 'WALK_IN',
        createdAt: { gte: openedAt, lte: closedAt },
      },
      select: {
        id: true,
        saleNumber: true,
        totalAmount: true,
        paymentMethod: true,
        createdAt: true,
        creator: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const coveredBeverageSaleNumbers = new Set<string>()
  for (const payment of payments) {
    const saleNumber = beverageSaleNumberFromPayment(payment)
    if (saleNumber) coveredBeverageSaleNumbers.add(saleNumber)
  }

  type CollectionPaymentRow = {
    id: string
    amount: number
    method: string
    type: string
    purpose: string
    roomNumber: string | null
    guestName: string | null
    at: string
    receivedBy: string
    reference: string | null
    paymentType: string
  }

  const collectionPayments: CollectionPaymentRow[] = payments.map((p) => {
    const purpose = resolvePaymentSourceLabel(p)
    const roomNumber = resolvePaymentRoomNumber(p)

    return {
      id: p.id,
      amount: p.amount,
      method: formatPaymentMethod(p.method),
      type: p.paymentType,
      paymentType: p.paymentType,
      purpose: formatCollectionPurposeLabel(purpose, roomNumber),
      roomNumber,
      guestName:
        p.booking?.customer?.name ?? p.reservationEntry?.guestName ?? null,
      at: p.createdAt.toISOString(),
      receivedBy: p.receiver.name,
      reference: resolvePaymentReference(p),
    }
  })

  for (const sale of beverageWalkInSales) {
    if (coveredBeverageSaleNumbers.has(sale.saleNumber)) continue

    const method = formatPaymentMethod(sale.paymentMethod ?? 'CASH')
    collectionPayments.push({
      id: `beverage-sale-${sale.id}`,
      amount: sale.totalAmount,
      method,
      type: 'FINAL',
      paymentType: 'FINAL',
      purpose: 'Hotel beverage (walk-in)',
      roomNumber: null,
      guestName: null,
      at: sale.createdAt.toISOString(),
      receivedBy: sale.creator?.name ?? '—',
      reference: sale.saleNumber,
    })
  }

  collectionPayments.sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  )

  const byMethod = new Map<string, number>()
  let refunds = 0
  let grossCollected = 0

  for (const p of collectionPayments) {
    if (p.paymentType === 'REFUND') {
      refunds += Math.abs(p.amount)
      continue
    }
    grossCollected += p.amount
    byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount)
  }

  const netCollected = collectionPayments.reduce((sum, p) => {
    if (p.paymentType === 'REFUND') return sum - Math.abs(p.amount)
    return sum + p.amount
  }, 0)

  const recon = salesReport.cashReconciliation

  return {
    reportType: 'hotel-daily-collections' as const,
    businessDate: window.businessDate,
    businessDateDisplay: window.businessDateDisplay,
    window: { openedAt: openedAt.toISOString(), closedAt: closedAt.toISOString() },
    summary: {
      grossCollected,
      refunds,
      netCollected,
      paymentCount: collectionPayments.filter((p) => p.paymentType !== 'REFUND').length,
      depositTotal: recon.totalRemitted,
      depositCount: recon.remittanceCount,
      openingCash: recon.openingCash,
      cashCollected: recon.cashCollectedToday,
      cardCollected: recon.cardCollectedToday,
      mBankingCollected: recon.mBankingCollectedToday,
      cashRemitted: recon.cashRemitted,
      cardRemitted: recon.cardRemitted,
      mBankingRemitted: recon.mBankingRemitted,
      cashOnHand: recon.cashOnHand,
      salesReportCashTotal: recon.cashCollectedToday,
    },
    byMethod: Array.from(byMethod.entries())
      .map(([method, amount]) => ({ method, amount }))
      .sort((a, b) => b.amount - a.amount),
    payments: collectionPayments.map(({ paymentType: _paymentType, ...p }) => p),
    deposits: salesReport.headOfficeRemittances,
  }
}

export function sumPaymentsByMethod(
  payments: Array<{ amount: number; method: string; paymentType: string }>
): Array<{ method: string; amount: number }> {
  const byMethod = new Map<string, number>()
  for (const p of payments) {
    if (p.paymentType === 'REFUND') continue
    const label = formatPaymentMethod(p.method)
    byMethod.set(label, (byMethod.get(label) ?? 0) + p.amount)
  }
  return Array.from(byMethod.entries())
    .map(([method, amount]) => ({ method, amount }))
    .sort((a, b) => b.amount - a.amount)
}
