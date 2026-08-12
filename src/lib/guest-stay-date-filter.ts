import { endOfDay, parseISO, startOfDay } from 'date-fns'
import { Prisma } from '@prisma/client'

export type StayDateRange = {
  start: Date
  end: Date
}

function parseDateOnlyParam(value: string): Date | null {
  const trimmed = value.trim()
  const parsed = parseISO(trimmed.includes('T') ? trimmed : `${trimmed}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function parseStayDateRange(
  dateFrom: string | null,
  dateTo: string | null
): StayDateRange | null {
  let start: Date | null = null
  let end: Date | null = null

  if (dateFrom) {
    const parsed = parseDateOnlyParam(dateFrom)
    if (parsed) start = startOfDay(parsed)
  }
  if (dateTo) {
    const parsed = parseDateOnlyParam(dateTo)
    if (parsed) end = endOfDay(parsed)
  }

  if (!start && !end) return null
  return {
    start: start ?? new Date(0),
    end: end ?? new Date(8640000000000000),
  }
}

export type StayBoundsSource = {
  checkIn: Date | string
  checkOut: Date | string
  actualCheckIn?: Date | string | null
  actualCheckOut?: Date | string | null
  status: string
}

/** First calendar day the guest is in-house (arrival day). */
export function getGuestArrivalCalendarDay(booking: StayBoundsSource): Date {
  if (booking.status === 'CHECKED_IN' || booking.status === 'CHECKED_OUT') {
    return startOfDay(new Date(booking.actualCheckIn ?? booking.checkIn))
  }
  return startOfDay(new Date(booking.checkIn))
}

/** Last calendar day the guest is in-house (departure day, inclusive until checkout). */
export function getGuestDepartureCalendarDay(booking: StayBoundsSource): Date {
  if (booking.status === 'CHECKED_OUT' && booking.actualCheckOut) {
    return startOfDay(new Date(booking.actualCheckOut))
  }
  return startOfDay(new Date(booking.checkOut))
}

/**
 * PMS daily guest visibility:
 * - RESERVED: appears on scheduled check-in business day only (expected arrival).
 * - CHECKED_IN: appears every business day from actual check-in through checkout.
 * - CHECKED_OUT: appears on each day the guest was in-house, including checkout day.
 */
export function guestStayOverlapsRange(
  booking: StayBoundsSource,
  dateFrom: string | null,
  dateTo: string | null
): boolean {
  if (booking.status === 'CANCELLED') return false

  const range = parseStayDateRange(dateFrom, dateTo)
  if (!range) return true

  const filterStartDay = startOfDay(range.start)
  const filterEndDay = startOfDay(range.end)

  if (booking.status === 'RESERVED') {
    const scheduledArrival = startOfDay(new Date(booking.checkIn))
    return scheduledArrival >= filterStartDay && scheduledArrival <= filterEndDay
  }

  const arrivalDay = getGuestArrivalCalendarDay(booking)
  const departureDay = getGuestDepartureCalendarDay(booking)

  // Inclusive stay span (arrival through departure/checkout day)
  if (arrivalDay <= filterEndDay && departureDay >= filterStartDay) return true

  // Same-day checkout edge: still count the checkout calendar day
  if (booking.status === 'CHECKED_OUT' && booking.actualCheckOut) {
    const checkoutDay = startOfDay(new Date(booking.actualCheckOut))
    if (checkoutDay >= filterStartDay && checkoutDay <= filterEndDay) return true
  }

  return false
}

export function pickGuestStayBooking<T extends StayBoundsSource>(
  bookings: T[],
  dateFrom: string | null,
  dateTo: string | null,
  hasDateFilter: boolean
): T | null {
  const candidates = hasDateFilter
    ? bookings.filter((b) => guestStayOverlapsRange(b, dateFrom, dateTo))
    : bookings.filter((b) => b.status !== 'CANCELLED')

  if (!candidates.length) return null

  const statusRank = (status: string) => {
    if (status === 'CHECKED_IN') return 0
    if (status === 'RESERVED') return 1
    return 2
  }

  return [...candidates].sort((a, b) => {
    const rankDiff = statusRank(a.status) - statusRank(b.status)
    if (rankDiff !== 0) return rankDiff
    const aStart = getGuestArrivalCalendarDay(a).getTime()
    const bStart = getGuestArrivalCalendarDay(b).getTime()
    return aStart - bStart
  })[0]
}

/** Checked-in guests occupying the hotel across at least one day in the period. */
export function buildInHouseStayOverlapWhere(
  dateFrom: string | null,
  dateTo: string | null
): Prisma.BookingWhereInput | null {
  const range = parseStayDateRange(dateFrom, dateTo)
  if (!range) return null

  const { start, end } = range
  const scheduledInHouse = {
    checkIn: { lte: end },
    checkOut: { gte: start },
  }

  return {
    status: 'CHECKED_IN',
    OR: [
      {
        AND: [
          { actualCheckIn: { not: null } },
          { actualCheckIn: { lte: end } },
          { checkOut: { gte: start } },
        ],
      },
      {
        AND: [{ actualCheckIn: null }, scheduledInHouse],
      },
    ],
  }
}

/**
 * Prisma filter: guests visible on a business day per PMS rules.
 * Reserved = scheduled arrival day; checked-in = full stay span.
 */
export function buildGuestStayOverlapWhere(
  dateFrom: string | null,
  dateTo: string | null
): Prisma.BookingWhereInput | null {
  const range = parseStayDateRange(dateFrom, dateTo)
  if (!range) return null

  const { start, end } = range

  const scheduledInHouse = {
    checkIn: { lte: end },
    checkOut: { gte: start },
  }

  return {
    status: { not: 'CANCELLED' },
    OR: [
      {
        status: 'RESERVED',
        checkIn: { gte: start, lte: end },
      },
      {
        status: 'CHECKED_IN',
        OR: [
          {
            AND: [
              { actualCheckIn: { not: null } },
              { actualCheckIn: { lte: end } },
              { checkOut: { gte: start } },
            ],
          },
          {
            AND: [{ actualCheckIn: null }, scheduledInHouse],
          },
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
      {
        status: 'CHECKED_OUT',
        OR: [{ actualCheckIn: null }, { actualCheckOut: null }],
        ...scheduledInHouse,
      },
    ],
  }
}
