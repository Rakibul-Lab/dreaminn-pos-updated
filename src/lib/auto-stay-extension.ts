import { addDays, startOfDay } from 'date-fns'
import type { PrismaClient } from '@prisma/client'
import { getHotelCheckInOutTimes, getAutoNextDayBillTime } from '@/lib/app-settings'
import {
  applyHotelTimeToBookingInput,
  applyHotelTimeToDate,
  countHotelStayNights,
  datePickerValue,
  formatTime12h,
} from '@/lib/hotel-times'
import { getRoomNightlyTotal } from '@/lib/room-pricing'
import { bookingVatOptions, computeRoomBookingTotals, sumBookingNetPaid } from '@/lib/booking-totals'

/**
 * Default grace time: guests may check out until 2:00 PM on departure day; after
 * that an extra night is added. Overridable via the `auto_next_day_bill_time` setting.
 */
export const AUTO_EXTENSION_GRACE_END_TIME = '14:00'

/** Hard cap so a bad clock or corrupt row cannot bill decades of nights in one pass. */
const MAX_AUTO_EXTENSION_NIGHTS = 14

export function getAutoExtensionCutoff(
  checkOut: Date,
  now: Date = new Date(),
  graceTime: string = AUTO_EXTENSION_GRACE_END_TIME
): Date {
  void now
  return applyHotelTimeToDate(startOfDay(checkOut), graceTime)
}

export function isPastAutoExtensionCutoff(
  checkOut: Date,
  now: Date = new Date(),
  graceTime: string = AUTO_EXTENSION_GRACE_END_TIME
): boolean {
  return now.getTime() > getAutoExtensionCutoff(checkOut, now, graceTime).getTime()
}

/**
 * Earliest checkout calendar day that is still valid for a guest who remains in-house.
 *
 * After grace on day D the guest owes that night, so checkout moves to D+1. If the
 * system was offline for several days, jump once to that target — never add another
 * night on the next page load once checkout is caught up.
 */
export function resolveAutoExtendedCheckoutDate(
  currentCheckOut: Date,
  now: Date,
  graceTime: string,
  checkOutTime: string
): Date | null {
  if (!isPastAutoExtensionCutoff(currentCheckOut, now, graceTime)) {
    return null
  }

  let targetDay = startOfDay(now)
  if (now.getTime() > applyHotelTimeToDate(targetDay, graceTime).getTime()) {
    targetDay = addDays(targetDay, 1)
  }

  let target = applyHotelTimeToBookingInput(datePickerValue(targetDay), checkOutTime)

  // Always move at least one calendar day forward when grace on the current
  // checkout has passed; otherwise a timezone skew can leave checkout stuck and
  // re-bill the same night on every request.
  const minForward = applyHotelTimeToBookingInput(
    datePickerValue(addDays(startOfDay(currentCheckOut), 1)),
    checkOutTime
  )
  if (target.getTime() < minForward.getTime()) {
    target = minForward
  }

  if (target.getTime() <= currentCheckOut.getTime()) {
    return null
  }

  // Cap runaway catch-up (bad server clock / corrupt dates).
  const daysAdvanced = Math.round(
    (startOfDay(target).getTime() - startOfDay(currentCheckOut).getTime()) / 86_400_000
  )
  if (daysAdvanced > MAX_AUTO_EXTENSION_NIGHTS) {
    target = applyHotelTimeToBookingInput(
      datePickerValue(addDays(startOfDay(currentCheckOut), MAX_AUTO_EXTENSION_NIGHTS)),
      checkOutTime
    )
  }

  return target.getTime() > currentCheckOut.getTime() ? target : null
}

type ExtensionDb = Pick<PrismaClient, 'booking' | 'roomCharge'>

export async function extendOverdueCheckedInBooking(
  db: ExtensionDb,
  bookingId: string,
  now: Date = new Date(),
  graceTime?: string
): Promise<boolean> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      room: { include: { type: true } },
      payments: { select: { amount: true, paymentType: true } },
    },
  })
  if (!booking || booking.status !== 'CHECKED_IN') return false

  const times = await getHotelCheckInOutTimes()
  const resolvedGrace = graceTime ?? (await getAutoNextDayBillTime())
  const currentCheckOut = new Date(booking.checkOut)
  const checkOut = resolveAutoExtendedCheckoutDate(
    currentCheckOut,
    now,
    resolvedGrace,
    times.checkOutTime
  )
  if (!checkOut) return false

  const nightlyRate = getRoomNightlyTotal(booking.room)
  const previousNights = countHotelStayNights(booking.checkIn, currentCheckOut)
  const nights = countHotelStayNights(booking.checkIn, checkOut)
  const extensions = Math.max(0, nights - previousNights)
  if (extensions <= 0) return false

  const totalRoomCharge = nights * nightlyRate
  const totalPaid = sumBookingNetPaid(booking.payments)
  const { dueAmount } = computeRoomBookingTotals(
    totalRoomCharge,
    totalPaid,
    bookingVatOptions(booking),
    {
      discountEnabled: booking.discountEnabled === true,
      discountType: booking.discountType ?? undefined,
      discountValue: booking.discountValue ?? 0,
      nights,
    }
  )

  console.info(
    `[auto-next-day-bill] booking=${bookingId} reg=${booking.registrationNumber ?? '—'} ` +
      `grace=${resolvedGrace} (${formatTime12h(resolvedGrace)}) now=${now.toString()} ` +
      `TZ=${process.env.TZ ?? 'system'} extended=${extensions} night(s) ` +
      `from=${currentCheckOut.toString()} to=${checkOut.toString()}`
  )

  // Folio ROOM_RATE rows must not disagree with the booking total — checkout
  // used to prefer those rows and could keep showing a stale inflated charge.
  await db.roomCharge.deleteMany({
    where: { bookingId, chargeType: 'ROOM_RATE' },
  })

  await db.booking.update({
    where: { id: bookingId },
    data: {
      checkOut,
      totalRoomCharge,
      dueAmount,
      notes: booking.notes
        ? `${booking.notes}\nAuto-extended ${extensions} night(s) after ${formatTime12h(resolvedGrace)} checkout grace.`
        : `Auto-extended ${extensions} night(s) after ${formatTime12h(resolvedGrace)} checkout grace.`,
    },
  })

  return true
}

export async function processAllOverdueStayExtensions(
  db: ExtensionDb,
  now: Date = new Date()
): Promise<number> {
  const graceTime = await getAutoNextDayBillTime()
  const checkedIn = await db.booking.findMany({
    where: { status: 'CHECKED_IN' },
    select: { id: true, checkOut: true },
  })

  let extended = 0
  for (const booking of checkedIn) {
    if (!isPastAutoExtensionCutoff(booking.checkOut, now, graceTime)) continue
    const didExtend = await extendOverdueCheckedInBooking(db, booking.id, now, graceTime)
    if (didExtend) extended += 1
  }
  return extended
}
