import { addDays, differenceInCalendarDays, endOfDay, format, parseISO, startOfDay, subDays } from 'date-fns'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { resolveBookingDateRange, type BookingDatePreset } from '@/lib/booking-date-filter'
import { buildGuestStayOverlapWhere, buildInHouseStayOverlapWhere } from '@/lib/guest-stay-date-filter'
import {
  formatBusinessDate,
  formatBusinessDateDisplay,
  isValidBusinessDateString,
  parseBusinessDateString,
} from '@/lib/business-date-format'

export {
  formatBusinessDate,
  formatBusinessDateDisplay,
  isValidBusinessDateString,
  parseBusinessDateString,
} from '@/lib/business-date-format'

export const CURRENT_BUSINESS_DATE_KEY = 'current_business_date'

/** Calendar midnight bounds for a business date label (local timezone). */
export function getCalendarDayBounds(businessDate: string): { start: Date; end: Date } {
  const start = startOfDay(parseBusinessDateString(businessDate))
  return { start, end: endOfDay(start) }
}

export function getBusinessNowDate(businessDate: string): Date {
  return parseBusinessDateString(businessDate)
}

export async function readCurrentBusinessDateString(): Promise<string> {
  const row = await db.setting.findUnique({ where: { key: CURRENT_BUSINESS_DATE_KEY } })
  if (row?.value && isValidBusinessDateString(row.value)) {
    return row.value.trim()
  }
  const today = formatBusinessDate(new Date())
  await db.setting.upsert({
    where: { key: CURRENT_BUSINESS_DATE_KEY },
    create: { key: CURRENT_BUSINESS_DATE_KEY, value: today, group: 'hotel' },
    update: {},
  })
  return today
}

export async function setCurrentBusinessDateString(businessDate: string): Promise<void> {
  if (!isValidBusinessDateString(businessDate)) {
    throw new Error('Invalid business date')
  }
  await db.setting.upsert({
    where: { key: CURRENT_BUSINESS_DATE_KEY },
    create: { key: CURRENT_BUSINESS_DATE_KEY, value: businessDate.trim(), group: 'hotel' },
    update: { value: businessDate.trim() },
  })
}

export async function getLastDayClose() {
  return db.dayClose.findFirst({ orderBy: { closedAt: 'desc' } })
}

/** Open business day window: from previous close (or start of business date) until now. */
export async function getOpenBusinessDayWindow(): Promise<{
  businessDate: string
  openedAt: Date
  endsAt: Date
}> {
  const businessDate = await readCurrentBusinessDateString()
  const lastClose = await getLastDayClose()
  const { start: calendarStart } = getCalendarDayBounds(businessDate)
  const openedAt =
    lastClose && lastClose.businessDate !== businessDate
      ? lastClose.closedAt
      : lastClose?.openedAt ?? calendarStart

  return {
    businessDate,
    openedAt,
    endsAt: new Date(),
  }
}

/** Prisma filter: records attributed to a business date (explicit tag or legacy createdAt fallback). */
export function buildBusinessDateWhere(businessDate: string): {
  OR: Array<Record<string, unknown>>
} {
  const { start, end } = getCalendarDayBounds(businessDate)
  return {
    OR: [
      { businessDate },
      { businessDate: null, createdAt: { gte: start, lte: end } },
    ],
  }
}

export function mergeBusinessDateWhere<T extends Prisma.PaymentWhereInput>(
  where: T,
  businessDate: string
): T {
  const clause = buildBusinessDateWhere(businessDate)
  return { ...where, AND: [...(where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []), clause] }
}

export function mergeBusinessDateWhereOrder<T extends Prisma.RestaurantOrderWhereInput>(
  where: T,
  businessDate: string
): T {
  const clause = buildBusinessDateWhere(businessDate)
  return { ...where, AND: [...(where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []), clause] }
}

export function mergeBusinessDateWhereInvoice<T extends Prisma.InvoiceWhereInput>(
  where: T,
  businessDate: string
): T {
  const clause = buildBusinessDateWhere(businessDate)
  return { ...where, AND: [...(where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []), clause] }
}

export async function getCurrentBusinessDateWhereForPayments(): Promise<Prisma.PaymentWhereInput> {
  const businessDate = await readCurrentBusinessDateString()
  return buildBusinessDateWhere(businessDate)
}

export async function getCurrentBusinessDateWhereForOrders(): Promise<Prisma.RestaurantOrderWhereInput> {
  const businessDate = await readCurrentBusinessDateString()
  return buildBusinessDateWhere(businessDate)
}

/** Booking scheduled to arrive on the business calendar day (expected arrivals). */
export function buildExpectedArrivalsOnBusinessDateWhere(businessDate: string): Prisma.BookingWhereInput {
  const { start, end } = getCalendarDayBounds(businessDate)
  return {
    status: 'RESERVED',
    checkIn: { gte: start, lte: end },
  }
}

/** Expected arrivals + actual check-ins during the open business day window. */
export function buildBusinessDayArrivalsWhere(
  businessDate: string,
  openedAt: Date,
  closedAt: Date
): Prisma.BookingWhereInput {
  const { start, end } = getCalendarDayBounds(businessDate)
  return {
    status: { not: 'CANCELLED' },
    OR: [
      { status: 'RESERVED', checkIn: { gte: start, lte: end } },
      { actualCheckIn: { gte: openedAt, lte: closedAt } },
    ],
  }
}

/** Departures scheduled or completed on the business calendar day. */
export function buildBusinessDayDeparturesWhere(businessDate: string): Prisma.BookingWhereInput {
  const { start, end } = getCalendarDayBounds(businessDate)
  return {
    status: { not: 'CANCELLED' },
    OR: [
      {
        status: 'CHECKED_OUT',
        actualCheckOut: { gte: start, lte: end },
      },
      {
        status: { in: ['CHECKED_IN', 'RESERVED'] },
        checkOut: { gte: start, lte: end },
      },
    ],
  }
}

export async function resolveBusinessBookingDateRange(
  preset: BookingDatePreset,
  customFrom?: string,
  customTo?: string
): Promise<{ dateFrom?: string; dateTo?: string; businessDate: string }> {
  const businessDate = await readCurrentBusinessDateString()
  const now = getBusinessNowDate(businessDate)
  const range = resolveBookingDateRange(preset, customFrom, customTo, now)
  return { ...range, businessDate }
}

export function nextBusinessDateString(current: string): string {
  return formatBusinessDate(addDays(parseBusinessDateString(current), 1))
}

export function previousBusinessDateString(current: string): string {
  return formatBusinessDate(subDays(parseBusinessDateString(current), 1))
}

export async function stampCurrentBusinessDate(): Promise<string> {
  return readCurrentBusinessDateString()
}

export function getCalendarDateString(date: Date = new Date()): string {
  return formatBusinessDate(date)
}

export type DayCloseGateResult = {
  allowed: boolean
  warning: boolean
  businessDate: string
  calendarDate: string
  daysBehind: number
  message?: string
}

/** Warn when the calendar has moved ahead of the open business day (operations still allowed). */
export async function getDayCloseGate(): Promise<DayCloseGateResult> {
  const businessDate = await readCurrentBusinessDateString()
  const calendarDate = getCalendarDateString()

  if (calendarDate <= businessDate) {
    return { allowed: true, warning: false, businessDate, calendarDate, daysBehind: 0 }
  }

  const daysBehind = differenceInCalendarDays(
    parseBusinessDateString(calendarDate),
    parseBusinessDateString(businessDate)
  )

  return {
    allowed: true,
    warning: true,
    businessDate,
    calendarDate,
    daysBehind,
    message: `Business day is still ${formatBusinessDateDisplay(businessDate)} but today is ${formatBusinessDateDisplay(calendarDate)}. Run Day Close when you are ready to advance to ${formatBusinessDateDisplay(nextBusinessDateString(businessDate))}. Check-ins and reservations can continue until then.`,
  }
}

/** Kept for API compatibility; no longer blocks hotel operations. */
export async function assertDayCloseCaughtUp(): Promise<void> {
  return
}

/** Activity attributed to a business day within the open/close window. */
export function buildBusinessDayWindowWhere(
  businessDate: string,
  openedAt: Date,
  closedAt: Date
): { OR: Array<Record<string, unknown>> } {
  return {
    OR: [
      { businessDate },
      { businessDate: null, createdAt: { gte: openedAt, lte: closedAt } },
    ],
  }
}

export async function buildCurrentOpenDayActivityWhere(): Promise<{
  OR: Array<Record<string, unknown>>
}> {
  const { businessDate, openedAt } = await getOpenBusinessDayWindow()
  return buildBusinessDayWindowWhere(businessDate, openedAt, new Date())
}

export function buildCheckInsDuringWindowWhere(
  openedAt: Date,
  closedAt: Date
): Prisma.BookingWhereInput {
  return {
    status: { not: 'CANCELLED' },
    actualCheckIn: { gte: openedAt, lte: closedAt },
  }
}

export function buildCheckOutsDuringWindowWhere(
  openedAt: Date,
  closedAt: Date
): Prisma.BookingWhereInput {
  return {
    status: 'CHECKED_OUT',
    actualCheckOut: { gte: openedAt, lte: closedAt },
  }
}

/** Open/closed window for a business date (current open day or historical day close). */
export async function resolveBusinessDayWindowForDate(
  businessDate: string
): Promise<{ businessDate: string; openedAt: Date; closedAt: Date }> {
  const current = await readCurrentBusinessDateString()
  const closedDay = await db.dayClose.findUnique({ where: { businessDate } })
  if (closedDay) {
    return {
      businessDate,
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

  return { businessDate, openedAt, closedAt }
}

/**
 * Guests visible on a business day: expected arrivals, check-ins during the open
 * window (even when calendar date is ahead), in-house stays, and departures.
 */
export function buildGuestStayOnBusinessDayWhere(
  businessDate: string,
  openedAt: Date,
  closedAt: Date
): Prisma.BookingWhereInput {
  const { start, end } = getCalendarDayBounds(businessDate)
  const scheduledInHouse = {
    checkIn: { lte: end },
    checkOut: { gte: start },
  }

  return {
    status: { not: 'CANCELLED' },
    OR: [
      { status: 'RESERVED', checkIn: { gte: start, lte: end } },
      { actualCheckIn: { gte: openedAt, lte: closedAt } },
      {
        status: 'CHECKED_IN',
        OR: [
          {
            AND: [
              { actualCheckIn: { not: null } },
              { actualCheckIn: { lt: openedAt } },
              { checkOut: { gte: start } },
            ],
          },
          { AND: [{ actualCheckIn: null }, scheduledInHouse] },
        ],
      },
      {
        status: 'CHECKED_OUT',
        AND: [
          { actualCheckIn: { not: null } },
          { actualCheckOut: { not: null } },
          { actualCheckIn: { lte: end } },
          { actualCheckOut: { gte: start } },
        ],
      },
      // Checkout during the open business-day window (may cross calendar midnight)
      {
        status: 'CHECKED_OUT',
        actualCheckOut: { gte: openedAt, lte: closedAt },
      },
      {
        status: 'CHECKED_OUT',
        OR: [{ actualCheckIn: null }, { actualCheckOut: null }],
        ...scheduledInHouse,
      },
    ],
  }
}

/** Checked-in guests on a business day (includes check-ins during the open window). */
export function buildInHouseOnBusinessDayWhere(
  businessDate: string,
  openedAt: Date,
  closedAt: Date
): Prisma.BookingWhereInput {
  const { start, end } = getCalendarDayBounds(businessDate)
  const scheduledInHouse = {
    checkIn: { lte: end },
    checkOut: { gte: start },
  }

  return {
    status: 'CHECKED_IN',
    OR: [
      { actualCheckIn: { gte: openedAt, lte: closedAt } },
      {
        AND: [
          { actualCheckIn: { not: null } },
          { actualCheckIn: { lt: openedAt } },
          { checkOut: { gte: start } },
        ],
      },
      { AND: [{ actualCheckIn: null }, scheduledInHouse] },
    ],
  }
}

/**
 * Police / in-house register: guests who were still in-house when the business day ended.
 * Once a guest checks out (e.g. 30/06 at noon), they drop off that day and all later days.
 */
export function buildPoliceInHouseOnBusinessDayWhere(
  businessDate: string,
  openedAt: Date,
  closedAt: Date
): Prisma.BookingWhereInput {
  const { start } = getCalendarDayBounds(businessDate)

  return {
    status: { not: 'CANCELLED' },
    actualCheckIn: { not: null, lte: closedAt },
    AND: [
      {
        OR: [
          { actualCheckIn: { gte: openedAt, lte: closedAt } },
          {
            AND: [
              { actualCheckIn: { lt: openedAt } },
              { checkOut: { gte: start } },
            ],
          },
        ],
      },
      {
        OR: [
          { status: 'CHECKED_IN' },
          {
            status: 'CHECKED_OUT',
            actualCheckOut: { gt: closedAt },
          },
        ],
      },
    ],
  }
}

/** Resolve booking list / guest filters using business-day window for single-day filters. */
export async function buildGuestStayFilterWhere(
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined
): Promise<Prisma.BookingWhereInput | null> {
  const from = dateFrom?.trim() || null
  const to = dateTo?.trim() || null
  if (!from && !to) return null

  if (from && to && from === to) {
    const window = await resolveBusinessDayWindowForDate(from)
    return buildGuestStayOnBusinessDayWhere(window.businessDate, window.openedAt, window.closedAt)
  }

  return buildGuestStayOverlapWhere(from, to)
}

/**
 * Guests menu / directory: keep checked-out guests visible for days they stayed
 * or checked out (including business-day window after midnight).
 */
export async function buildGuestDirectoryFilterWhere(
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined
): Promise<Prisma.BookingWhereInput | null> {
  const from = dateFrom?.trim() || null
  const to = dateTo?.trim() || null
  if (!from && !to) return null

  if (from && to && from === to) {
    const window = await resolveBusinessDayWindowForDate(from)
    const calendarOverlap = buildGuestStayOverlapWhere(from, to)
    return {
      OR: [
        ...(calendarOverlap ? [calendarOverlap] : []),
        buildGuestStayOnBusinessDayWhere(window.businessDate, window.openedAt, window.closedAt),
        {
          status: 'CHECKED_OUT',
          actualCheckOut: { gte: window.openedAt, lte: window.closedAt },
        },
      ],
    }
  }

  return buildGuestStayOverlapWhere(from, to)
}

/** Checked-in guests occupying the hotel on a business calendar day. */
export function buildInHouseOnBusinessDateWhere(businessDate: string): Prisma.BookingWhereInput {
  return buildInHouseStayOverlapWhere(businessDate, businessDate) ?? { status: 'CANCELLED' }
}
