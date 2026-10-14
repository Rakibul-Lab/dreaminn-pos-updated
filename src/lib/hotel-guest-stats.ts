import { db } from '@/lib/db'
import { getCalendarDayBounds } from '@/lib/business-date'

export type GuestPaxStats = {
  inHousePax: number
  inHouseAdults: number
  inHouseChildren: number
  inHouseRooms: number
  businessDayPax: number
  businessDayRooms: number
}

/**
 * Calculates guest pax count for a single booking:
 * Primary guest (1) + companions / additional adults + children.
 */
export function calculateBookingPax(booking: {
  adults?: number | null
  children?: number | null
  companions?: Array<{ companionType: string }>
}): number {
  const companions = booking.companions ?? []
  const adultCompanions = companions.filter((c) => c.companionType !== 'CHILD').length
  const childCompanions = companions.filter((c) => c.companionType === 'CHILD').length
  const adults = Math.max(1, booking.adults ?? 1)
  const children = Math.max(0, booking.children ?? 0)

  const adultPax = 1 + Math.max(adultCompanions, adults - 1)
  const childPax = Math.max(childCompanions, children)
  return adultPax + childPax
}

/**
 * Calculates child count for a single booking:
 * Max of child companions and declared children count.
 */
export function calculateBookingChildren(booking: {
  children?: number | null
  companions?: Array<{ companionType: string }>
}): number {
  const companions = booking.companions ?? []
  const childCompanions = companions.filter((c) => c.companionType === 'CHILD').length
  const children = Math.max(0, booking.children ?? 0)
  return Math.max(childCompanions, children)
}

/**
 * Computes:
 * 1. Current In-House Guest Pax & Children: Real-time count of all guests and children currently in-house (CHECKED_IN).
 *    Increases on check-in and decreases immediately when a guest checks out.
 * 2. Current Business Day Guest Pax: Cumulative count of all guests hosted during the current business day.
 */
export async function computeDashboardGuestStats(
  businessDate: string,
  openedAt: Date,
  now: Date = new Date()
): Promise<GuestPaxStats> {
  const { start } = getCalendarDayBounds(businessDate)

  // 1. Current Live In-House: only currently active CHECKED_IN bookings.
  // When a guest checks out, their booking status becomes CHECKED_OUT and they drop out immediately.
  const liveInHouseBookings = await db.booking.findMany({
    where: {
      status: 'CHECKED_IN',
    },
    select: {
      id: true,
      adults: true,
      children: true,
      companions: {
        select: { companionType: true },
      },
    },
  })

  let inHousePax = 0
  let inHouseAdults = 0
  let inHouseChildren = 0
  for (const b of liveInHouseBookings) {
    const companions = b.companions ?? []
    const adultCompanions = companions.filter((c) => c.companionType !== 'CHILD').length
    const childCompanions = companions.filter((c) => c.companionType === 'CHILD').length
    const adults = Math.max(1, b.adults ?? 1)
    const children = Math.max(0, b.children ?? 0)

    const adultPax = 1 + Math.max(adultCompanions, adults - 1)
    const childPax = Math.max(childCompanions, children)

    inHouseAdults += adultPax
    inHouseChildren += childPax
    inHousePax += (adultPax + childPax)
  }

  // 2. Current Business Day Guests: all bookings hosted on today's business day.
  // Includes guests who checked in today, as well as multi-day stays from earlier days
  // that were present during today's open business day.
  // Crucially: DOES NOT MINUS when checked out.
  const businessDayBookings = await db.booking.findMany({
    where: {
      status: { in: ['CHECKED_IN', 'CHECKED_OUT'] },
      actualCheckIn: { not: null, lte: now },
      OR: [
        // Checked in during today's open business day window (never drops out after check-out)
        { actualCheckIn: { gte: openedAt, lte: now } },
        // Checked in before today's business day window opened, but stayed into today
        {
          AND: [
            { actualCheckIn: { lt: openedAt } },
            {
              OR: [
                { status: 'CHECKED_IN' },
                { actualCheckOut: { gte: openedAt } },
                {
                  AND: [
                    { actualCheckOut: null },
                    { checkOut: { gte: start } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    select: {
      id: true,
      adults: true,
      children: true,
      companions: {
        select: { companionType: true },
      },
    },
  })

  let businessDayPax = 0
  for (const b of businessDayBookings) {
    businessDayPax += calculateBookingPax(b)
  }

  // Mathematical safety: businessDayPax should always be >= inHousePax
  businessDayPax = Math.max(businessDayPax, inHousePax)

  return {
    inHousePax,
    inHouseAdults,
    inHouseChildren,
    inHouseRooms: liveInHouseBookings.length,
    businessDayPax,
    businessDayRooms: Math.max(businessDayBookings.length, liveInHouseBookings.length),
  }
}
