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

/** Only one extra night may be billed in a single auto-extend pass. */
const MAX_AUTO_EXTENSION_NIGHTS = 1

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
 * Next checkout datetime after grace has passed on the current departure day.
 *
 * Only ever advances **one** night per run. Multi-day catch-up on every list/checkout
 * refresh was stacking stays (3 → 9 → 12 nights) and inflating due.
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

  const target = applyHotelTimeToBookingInput(
    datePickerValue(addDays(startOfDay(currentCheckOut), 1)),
    checkOutTime
  )

  if (target.getTime() <= currentCheckOut.getTime()) {
    return null
  }

  return target
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
      charges: { select: { chargeType: true, amount: true, quantity: true } },
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
  // Hard stop if calendar math somehow jumps more than one night in a single run.
  if (extensions > MAX_AUTO_EXTENSION_NIGHTS) return false

  const totalRoomCharge = nights * nightlyRate
  const totalPaid = sumBookingNetPaid(booking.payments)
  const roomDue = computeRoomBookingTotals(
    totalRoomCharge,
    totalPaid,
    bookingVatOptions(booking),
    {
      discountEnabled: booking.discountEnabled === true,
      discountType: booking.discountType ?? undefined,
      discountValue: booking.discountValue ?? 0,
      nights,
      checkIn: booking.checkIn,
      checkOut,
      totalRoomCharge,
    }
  ).dueAmount
  // Keep bill-transfer placeholders and other posted extras in the stored due.
  const postedExtras = booking.charges
    .filter((c) => c.chargeType !== 'ROOM_RATE')
    .reduce((sum, c) => sum + c.amount * (c.quantity || 1), 0)
  const dueAmount = Math.max(0, roomDue + postedExtras)

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
