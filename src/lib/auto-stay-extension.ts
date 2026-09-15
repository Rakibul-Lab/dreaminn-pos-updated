import { addDays, startOfDay } from 'date-fns'
import type { PrismaClient } from '@prisma/client'
import { getHotelCheckInOutTimes } from '@/lib/app-settings'
import {
  applyHotelTimeToBookingInput,
  countHotelStayNights,
  datePickerValue,
} from '@/lib/hotel-times'
import { getRoomNightlyTotal } from '@/lib/room-pricing'
import { bookingVatOptions, computeRoomBookingTotals, sumBookingNetPaid } from '@/lib/booking-totals'

/** Only one extra night may be billed in a single day-close pass. */
const MAX_AUTO_EXTENSION_NIGHTS = 1

/**
 * Guests still checked in whose reserved checkout falls on or before the
 * business day being closed are billed one additional night (night audit).
 */
export function isEligibleForBusinessDayStayExtension(
  checkOut: Date,
  closedBusinessDate: string
): boolean {
  return datePickerValue(startOfDay(checkOut)) <= closedBusinessDate
}

/**
 * Advance checkout by exactly one hotel night at the configured check-out time.
 */
export function resolveBusinessDayExtendedCheckout(
  currentCheckOut: Date,
  checkOutTime: string
): Date | null {
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

export type StayExtensionResult = {
  bookingId: string
  registrationNumber: string | null
  roomNumber: string
  previousCheckOut: string
  newCheckOut: string
  nightsAdded: number
}

/**
 * Bill one extra night for a checked-in guest during business-day close.
 * Does not rewrite check-in; only advances check-out and room charges.
 */
export async function extendCheckedInBookingForBusinessDayClose(
  db: ExtensionDb,
  bookingId: string,
  closedBusinessDate: string
): Promise<StayExtensionResult | null> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      room: { include: { type: true } },
      payments: { select: { amount: true, paymentType: true } },
      charges: { select: { chargeType: true, amount: true, quantity: true } },
    },
  })
  if (!booking || booking.status !== 'CHECKED_IN') return null

  const currentCheckOut = new Date(booking.checkOut)
  if (!isEligibleForBusinessDayStayExtension(currentCheckOut, closedBusinessDate)) {
    return null
  }

  const times = await getHotelCheckInOutTimes()
  const checkOut = resolveBusinessDayExtendedCheckout(currentCheckOut, times.checkOutTime)
  if (!checkOut) return null

  const nightlyRate = getRoomNightlyTotal(booking.room)
  const previousNights = countHotelStayNights(booking.checkIn, currentCheckOut)
  const nights = countHotelStayNights(booking.checkIn, checkOut)
  const extensions = Math.max(0, nights - previousNights)
  if (extensions <= 0) return null
  if (extensions > MAX_AUTO_EXTENSION_NIGHTS) return null

  const totalRoomCharge = nights * nightlyRate
  const totalPaid = sumBookingNetPaid(booking.payments)
  const roomTotal = computeRoomBookingTotals(
    totalRoomCharge,
    0,
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
  ).totalWithVat
  const postedExtras = booking.charges
    .filter((c) => c.chargeType !== 'ROOM_RATE')
    .reduce((sum, c) => sum + c.amount * (c.quantity || 1), 0)
  // Apply payments against the full folio (room after discount + extras), not room alone.
  const dueAmount = Math.max(0, roomTotal + postedExtras - totalPaid)

  const noteLine = `Auto next-day bill (+${extensions} night) on business day close ${closedBusinessDate}.`

  console.info(
    `[auto-next-day-bill] day-close=${closedBusinessDate} booking=${bookingId} ` +
      `reg=${booking.registrationNumber ?? '—'} room=${booking.room.roomNumber} ` +
      `extended=${extensions} from=${currentCheckOut.toISOString()} to=${checkOut.toISOString()}`
  )

  await db.roomCharge.deleteMany({
    where: { bookingId, chargeType: 'ROOM_RATE' },
  })

  await db.booking.update({
    where: { id: bookingId },
    data: {
      checkOut,
      totalRoomCharge,
      dueAmount,
      notes: booking.notes ? `${booking.notes}\n${noteLine}` : noteLine,
    },
  })

  return {
    bookingId,
    registrationNumber: booking.registrationNumber,
    roomNumber: booking.room.roomNumber,
    previousCheckOut: currentCheckOut.toISOString(),
    newCheckOut: checkOut.toISOString(),
    nightsAdded: extensions,
  }
}

/**
 * Night audit: on closing business day D, add one night for every checked-in
 * guest whose reserved checkout is on or before D.
 */
export async function processStayExtensionsOnBusinessDayClose(
  db: ExtensionDb,
  closedBusinessDate: string
): Promise<{ extendedCount: number; extensions: StayExtensionResult[] }> {
  const checkedIn = await db.booking.findMany({
    where: { status: 'CHECKED_IN' },
    select: { id: true, checkOut: true },
  })

  const extensions: StayExtensionResult[] = []
  for (const booking of checkedIn) {
    if (!isEligibleForBusinessDayStayExtension(booking.checkOut, closedBusinessDate)) {
      continue
    }
    const result = await extendCheckedInBookingForBusinessDayClose(
      db,
      booking.id,
      closedBusinessDate
    )
    if (result) extensions.push(result)
  }

  return { extendedCount: extensions.length, extensions }
}
