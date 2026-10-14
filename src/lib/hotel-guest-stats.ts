import { db } from '@/lib/db'
import { getCalendarDayBounds } from '@/lib/business-date'

export type GuestPaxStats = {
  inHousePax: number
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
 * Computes:
 * 1. Current In-House Guest Pax: Real-time count of all guests currently in-house (CHECKED_IN).
 *    Decreases immediately when a guest checks out.
 * 2. Current Business Day Guest Pax: Cumulative count of all guests hosted during the current business day.
 *    Counts check-ins during the business day + active multi-day stays, and does NOT decrease upon check-out.
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
  for (const b of liveInHouseBookings) {
    inHousePax += calculateBookingPax(b)
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
    inHouseRooms: liveInHouseBookings.length,
    businessDayPax,
    businessDayRooms: Math.max(businessDayBookings.length, liveInHouseBookings.length),
  }
}
