import { addDays, format, parseISO } from 'date-fns'
import { db } from '@/lib/db'
import {
  buildBusinessDayWindowWhere,
  formatBusinessDateDisplay,
  isValidBusinessDateString,
} from '@/lib/business-date'
import { resolveBookingDiscount } from '@/lib/booking-discount'
import { formatOrderTypeLabel } from '@/lib/restaurant-order-dues'
import { resolveBusinessDayReportWindow, type BusinessDayWindow } from '@/lib/hotel-pms-reports'
import { resolveBookingRegistrationNumber } from '@/lib/booking-registration'
import {
  bookingDiscountAmount,
  fetchAllInHouseBookingDiscounts,
  fetchInHouseBookingDiscountsForWindow,
  type InHouseBookingDiscountRecord,
} from '@/lib/in-house-booking-discount'
import { bookingVatOptions, computeRoomBookingTotals } from '@/lib/booking-totals'

export type DailyDiscountLine = {
  id: string
  source: 'hotel' | 'restaurant'
  purpose: string
  reference: string
  guestName: string | null
  roomNumber: string | null
  detail: string | null
  company: string | null
  discountAmount: number
  grossAmount: number
  netAmount: number
  at: string
  createdBy: string | null
}

export type DailyDiscountReport = {
  reportType: 'hotel-daily-discounts'
  businessDate: string
  businessDateDisplay: string
  window: { openedAt: string; closedAt: string }
  summary: {
    hotelDiscountTotal: number
    restaurantDiscountTotal: number
    totalDiscount: number
    hotelCount: number
    restaurantCount: number
    lineCount: number
  }
  lines: DailyDiscountLine[]
}

function invoiceWindowWhere(businessDate: string, openedAt: Date, closedAt: Date) {
  return {
    status: { not: 'CANCELLED' as const },
    discount: { gt: 0 },
    // Matches the sales report: an invoice raised while the guest is still in
    // house is a preview of the folio, so its discount is only given on the day
    // the guest checks out. Until then the stay is reported from the booking.
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

function resolveBookingCompany(booking: {
  company: string | null
  companyLedger?: { name: string } | null
}): string | null {
  const company = booking.companyLedger?.name ?? booking.company?.trim()
  return company || null
}

function formatHotelDiscountDetail(
  booking: {
    discountEnabled: boolean
    discountType: string | null
    discountValue: number
  },
  discountItems: Array<{ description: string }>
): string | null {
  const parts: string[] = []
  const { enabled, type, value } = resolveBookingDiscount(booking)
  if (enabled && value > 0) {
    parts.push(
      type === 'FIXED'
        ? `Booking discount: ৳${value}/night`
        : `Booking discount: ${value}%`
    )
  }
  for (const item of discountItems) {
    const desc = item.description?.trim()
    if (!desc) continue
    const normalized = desc.toLowerCase()
    if (normalized === 'hotel discount' || normalized === 'discount') continue
    parts.push(desc)
  }
  return parts.length ? parts.join(' · ') : null
}

function formatRestaurantDetail(order: {
  orderType: string
  room?: { roomNumber: string } | null
  table?: { tableNumber: string } | null
  notes?: string | null
}): string {
  const parts = [formatOrderTypeLabel(order.orderType)]
  const location = formatRestaurantLocation(order)
  if (location && order.orderType !== 'TAKEAWAY') parts.push(location)
  if (order.notes?.trim()) parts.push(order.notes.trim())
  return parts.join(' · ')
}

function formatRestaurantLocation(order: {
  orderType: string
  room?: { roomNumber: string } | null
  table?: { tableNumber: string } | null
}): string | null {
  if (order.orderType === 'ROOM_SERVICE' && order.room?.roomNumber) {
    return `Room ${order.room.roomNumber}`
  }
  if (order.orderType === 'DINE_IN' && order.table?.tableNumber) {
    return `Table ${order.table.tableNumber}`
  }
  return formatOrderTypeLabel(order.orderType)
}

const invoiceInclude = {
  items: {
    where: { itemType: 'discount' as const },
    select: { description: true },
  },
  booking: {
    include: {
      customer: { select: { name: true } },
      room: { select: { roomNumber: true } },
      companyLedger: { select: { name: true } },
    },
  },
} as const

const restaurantOrderInclude = {
  room: { select: { roomNumber: true } },
  table: { select: { tableNumber: true } },
  waiter: { select: { name: true } },
  creator: { select: { name: true } },
  companyLedgerBill: {
    include: { companyLedger: { select: { name: true } } },
  },
} as const

type DiscountInvoiceRecord = Awaited<
  ReturnType<typeof db.invoice.findMany<{ include: typeof invoiceInclude }>>
>[number]

type DiscountRestaurantOrderRecord = Awaited<
  ReturnType<typeof db.restaurantOrder.findMany<{ include: typeof restaurantOrderInclude }>>
>[number]

function buildInHouseBookingDiscountLines(
  bookings: InHouseBookingDiscountRecord[]
): DailyDiscountLine[] {
  const lines: DailyDiscountLine[] = []

  for (const booking of bookings) {
    const discountAmount = bookingDiscountAmount(booking)
    if (discountAmount <= 0) continue

    const totals = computeRoomBookingTotals(
      booking.totalRoomCharge,
      0,
      bookingVatOptions(booking),
      booking
    )
    const at = (booking.actualCheckIn ?? booking.createdAt).toISOString()
    const regNo = resolveBookingRegistrationNumber(booking)

    lines.push({
      id: `booking-${booking.id}`,
      source: 'hotel',
      purpose: booking.status === 'CHECKED_IN' ? 'In-house booking' : 'Reservation',
      reference: regNo || booking.id.slice(-8),
      guestName: booking.customer.name,
      roomNumber: booking.room.roomNumber,
      detail: formatHotelDiscountDetail(booking, []),
      company: resolveBookingCompany(booking),
      discountAmount,
      grossAmount: booking.totalRoomCharge,
      netAmount: totals.totalWithVat,
      at,
      createdBy: null,
    })
  }

  return lines
}

function buildDiscountLinesFromRecords(
  invoices: DiscountInvoiceRecord[],
  restaurantOrders: DiscountRestaurantOrderRecord[],
  inHouseBookings: InHouseBookingDiscountRecord[] = []
): DailyDiscountLine[] {
  const lines: DailyDiscountLine[] = []

  for (const invoice of invoices) {
    const booking = invoice.booking
    const at = (invoice.issuedAt ?? invoice.createdAt).toISOString()
    lines.push({
      id: invoice.id,
      source: 'hotel',
      purpose: 'Hotel invoice',
      reference: invoice.invoiceNumber,
      guestName: booking.customer.name,
      roomNumber: booking.room.roomNumber,
      detail: formatHotelDiscountDetail(booking, invoice.items),
      company: resolveBookingCompany(booking),
      discountAmount: invoice.discount,
      grossAmount: invoice.subtotal,
      netAmount: invoice.totalAmount,
      at,
      createdBy: null,
    })
  }

  for (const order of restaurantOrders) {
    lines.push({
      id: order.id,
      source: 'restaurant',
      purpose: 'Restaurant POS',
      reference: order.orderNumber,
      guestName: order.customerName,
      roomNumber: order.room?.roomNumber ?? order.table?.tableNumber ?? null,
      detail: formatRestaurantDetail(order),
      company: order.companyLedgerBill?.companyLedger.name ?? null,
      discountAmount: order.discount,
      grossAmount: order.subtotal,
      netAmount: order.totalAmount,
      at: order.createdAt.toISOString(),
      createdBy: order.waiter?.name ?? order.creator?.name ?? null,
    })
  }

  lines.push(...buildInHouseBookingDiscountLines(inHouseBookings))

  lines.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  return lines
}

function summarizeDiscountLines(lines: DailyDiscountLine[]): DailyDiscountReport['summary'] {
  const hotelDiscountTotal = lines
    .filter((line) => line.source === 'hotel')
    .reduce((sum, line) => sum + line.discountAmount, 0)
  const restaurantDiscountTotal = lines
    .filter((line) => line.source === 'restaurant')
    .reduce((sum, line) => sum + line.discountAmount, 0)

  return {
    hotelDiscountTotal,
    restaurantDiscountTotal,
    totalDiscount: hotelDiscountTotal + restaurantDiscountTotal,
    hotelCount: lines.filter((line) => line.source === 'hotel').length,
    restaurantCount: lines.filter((line) => line.source === 'restaurant').length,
    lineCount: lines.length,
  }
}

function formatDiscountReportDateDisplay(dateFrom?: string, dateTo?: string): string {
  if (!dateFrom && !dateTo) return 'All dates'
  const from = dateFrom ?? dateTo!
  const to = dateTo ?? dateFrom!
  if (from === to) return formatBusinessDateDisplay(from)
  return `${formatBusinessDateDisplay(from)} – ${formatBusinessDateDisplay(to)}`
}

async function fetchDiscountRecordsForWindow(window: BusinessDayWindow) {
  const { businessDate, openedAt, closedAt } = window
  const windowWhere = buildBusinessDayWindowWhere(businessDate, openedAt, closedAt)
  const orderWhere = {
    ...windowWhere,
    status: { not: 'CANCELLED' as const },
    discount: { gt: 0 },
  }

  return Promise.all([
    db.invoice.findMany({
      where: invoiceWindowWhere(businessDate, openedAt, closedAt),
      include: invoiceInclude,
      orderBy: { createdAt: 'asc' },
    }),
    db.restaurantOrder.findMany({
      where: orderWhere,
      include: restaurantOrderInclude,
      orderBy: { createdAt: 'asc' },
    }),
    fetchInHouseBookingDiscountsForWindow(openedAt, closedAt),
  ])
}

async function fetchAllDiscountRecords() {
  return Promise.all([
    db.invoice.findMany({
      where: { status: { not: 'CANCELLED' }, discount: { gt: 0 } },
      include: invoiceInclude,
      orderBy: { createdAt: 'asc' },
    }),
    db.restaurantOrder.findMany({
      where: { status: { not: 'CANCELLED' }, discount: { gt: 0 } },
      include: restaurantOrderInclude,
      orderBy: { createdAt: 'asc' },
    }),
    fetchAllInHouseBookingDiscounts(),
  ])
}

function buildDiscountReportPayload(input: {
  businessDate: string
  businessDateDisplay: string
  openedAt: string
  closedAt: string
  lines: DailyDiscountLine[]
}): DailyDiscountReport {
  return {
    reportType: 'hotel-daily-discounts',
    businessDate: input.businessDate,
    businessDateDisplay: input.businessDateDisplay,
    window: { openedAt: input.openedAt, closedAt: input.closedAt },
    summary: summarizeDiscountLines(input.lines),
    lines: input.lines,
  }
}

export async function buildHotelDailyDiscountReport(
  window: BusinessDayWindow
): Promise<DailyDiscountReport> {
  const { businessDate, businessDateDisplay, openedAt, closedAt } = window
  const [invoices, restaurantOrders, inHouseBookings] =
    await fetchDiscountRecordsForWindow(window)
  const lines = buildDiscountLinesFromRecords(invoices, restaurantOrders, inHouseBookings)

  return buildDiscountReportPayload({
    businessDate,
    businessDateDisplay,
    openedAt: openedAt.toISOString(),
    closedAt: closedAt.toISOString(),
    lines,
  })
}

export async function buildHotelDiscountReportForDateRange(
  dateFrom?: string,
  dateTo?: string
): Promise<DailyDiscountReport> {
  if (!dateFrom && !dateTo) {
    const [invoices, restaurantOrders, inHouseBookings] = await fetchAllDiscountRecords()
    const lines = buildDiscountLinesFromRecords(invoices, restaurantOrders, inHouseBookings)
    const now = new Date().toISOString()
    return buildDiscountReportPayload({
      businessDate: '',
      businessDateDisplay: formatDiscountReportDateDisplay(),
      openedAt: now,
      closedAt: now,
      lines,
    })
  }

  const from = (dateFrom ?? dateTo)!.trim()
  const to = (dateTo ?? dateFrom)!.trim()
  if (!isValidBusinessDateString(from) || !isValidBusinessDateString(to)) {
    throw new Error('Invalid discount report date range')
  }

  if (from === to) {
    const window = await resolveBusinessDayReportWindow(from)
    return buildHotelDailyDiscountReport(window)
  }

  const seenIds = new Set<string>()
  const mergedLines: DailyDiscountLine[] = []
  let openedAt = new Date().toISOString()
  let closedAt = new Date(0).toISOString()

  let day = from
  while (day <= to) {
    const window = await resolveBusinessDayReportWindow(day)
    const [invoices, restaurantOrders, inHouseBookings] =
      await fetchDiscountRecordsForWindow(window)
    openedAt =
      new Date(window.openedAt).getTime() < new Date(openedAt).getTime()
        ? window.openedAt.toISOString()
        : openedAt
    closedAt =
      new Date(window.closedAt).getTime() > new Date(closedAt).getTime()
        ? window.closedAt.toISOString()
        : closedAt

    for (const line of buildDiscountLinesFromRecords(
      invoices,
      restaurantOrders,
      inHouseBookings
    )) {
      if (seenIds.has(line.id)) continue
      seenIds.add(line.id)
      mergedLines.push(line)
    }

    if (day === to) break
    day = format(addDays(parseISO(`${day}T12:00:00`), 1), 'yyyy-MM-dd')
  }

  mergedLines.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  return buildDiscountReportPayload({
    businessDate: from,
    businessDateDisplay: formatDiscountReportDateDisplay(from, to),
    openedAt,
    closedAt,
    lines: mergedLines,
  })
}
