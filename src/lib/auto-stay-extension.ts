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

export function getAutoExtensionCutoff(
  checkOut: Date,
  now: Date = new Date(),
  graceTime: string = AUTO_EXTENSION_GRACE_END_TIME
): Date {
  return applyHotelTimeToDate(startOfDay(checkOut), graceTime)
}

export function isPastAutoExtensionCutoff(
  checkOut: Date,
  now: Date = new Date(),
  graceTime: string = AUTO_EXTENSION_GRACE_END_TIME
): boolean {
  return now.getTime() > getAutoExtensionCutoff(checkOut, now, graceTime).getTime()
}

type ExtensionDb = Pick<PrismaClient, 'booking'>

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
  const nightlyRate = getRoomNightlyTotal(booking.room)
  let checkOut = new Date(booking.checkOut)
  let extensions = 0

  while (isPastAutoExtensionCutoff(checkOut, now, resolvedGrace) && extensions < 60) {
    const nextCheckoutDate = datePickerValue(addDays(startOfDay(checkOut), 1))
    checkOut = applyHotelTimeToBookingInput(nextCheckoutDate, times.checkOutTime)
    extensions += 1
  }

  if (extensions === 0) return false

  const nights = countHotelStayNights(booking.checkIn, checkOut)
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
    }
  )

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
