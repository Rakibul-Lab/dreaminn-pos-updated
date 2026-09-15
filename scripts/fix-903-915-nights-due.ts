/**
 * One-time fix for rooms 903 and 915 (local or production):
 * - +1 night (same night-audit logic as Day Close)
 * - 915: coerce invalid PERCENTAGE>100 discount → FIXED, recalculate due
 *
 * Local:
 *   npx tsx scripts/fix-903-915-nights-due.ts
 *
 * Production (set live DATABASE_URL first):
 *   $env:DATABASE_URL="mysql://USER:PASS@HOST:3306/DBNAME"
 *   npx tsx scripts/fix-903-915-nights-due.ts
 *
 * Or run scripts/fix-903-915-production.sql in phpMyAdmin on live.
 */
import { PrismaClient } from '@prisma/client'
import { extendCheckedInBookingForBusinessDayClose } from '../src/lib/auto-stay-extension'
import { countHotelStayNights } from '../src/lib/hotel-times'
import { getRoomNightlyTotal } from '../src/lib/room-pricing'
import {
  computeRoomBookingTotals,
  sumBookingNetPaid,
  sumBookingPostedExtras,
  bookingVatOptions,
  bookingDiscountInput,
} from '../src/lib/booking-totals'

const db = new PrismaClient()

function localYmd(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

async function extendIfNeeded(bookingId: string, roomNumber: string) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      room: { include: { type: true } },
    },
  })
  if (!booking || booking.status !== 'CHECKED_IN') {
    console.log(`${roomNumber}: skip extend (not checked in)`)
    return null
  }

  const nightly = getRoomNightlyTotal(booking.room)
  const nights = countHotelStayNights(booking.checkIn, booking.checkOut)
  if (nights >= 2 && booking.totalRoomCharge >= nightly * 2 - 0.01) {
    console.log(`${roomNumber}: already at 2+ nights — skip extend`)
    return null
  }

  const closedAs = localYmd(booking.checkOut)
  const result = await extendCheckedInBookingForBusinessDayClose(db, bookingId, closedAs)
  console.log(`${roomNumber}: extend`, result)
  return result
}

async function fix915Due(bookingId: string) {
  const b = await db.booking.findUnique({
    where: { id: bookingId },
    include: { payments: true, charges: true },
  })
  if (!b || b.status !== 'CHECKED_IN') return

  const discountType =
    b.discountEnabled && b.discountType === 'PERCENTAGE' && Number(b.discountValue) > 100
      ? 'FIXED'
      : b.discountType

  const patch = { ...b, discountType }
  const paid = sumBookingNetPaid(b.payments)
  const extras = sumBookingPostedExtras(b.charges, b.payments)
  const roomTotal = computeRoomBookingTotals(
    b.totalRoomCharge,
    0,
    bookingVatOptions(patch),
    bookingDiscountInput(patch)
  ).totalWithVat
  const dueAmount = Math.max(0, roomTotal + extras - paid)

  if (discountType === b.discountType && Math.abs(dueAmount - b.dueAmount) < 0.01) {
    console.log('915: due already correct — skip')
    return
  }

  const updated = await db.booking.update({
    where: { id: b.id },
    data: {
      ...(discountType && discountType !== b.discountType ? { discountType } : {}),
      dueAmount,
    },
    select: {
      discountType: true,
      discountValue: true,
      totalRoomCharge: true,
      dueAmount: true,
      checkOut: true,
    },
  })

  console.log('915 due fix', {
    before: {
      discountType: b.discountType,
      discountValue: b.discountValue,
      dueAmount: b.dueAmount,
      totalRoomCharge: b.totalRoomCharge,
    },
    calc: { paid, extras, roomTotal, dueAmount },
    after: updated,
  })
}

async function main() {
  const rows = await db.booking.findMany({
    where: {
      status: 'CHECKED_IN',
      room: { roomNumber: { in: ['903', '915'] } },
    },
    select: {
      id: true,
      registrationNumber: true,
      checkIn: true,
      checkOut: true,
      totalRoomCharge: true,
      dueAmount: true,
      discountType: true,
      discountValue: true,
      room: { select: { roomNumber: true } },
      customer: { select: { name: true } },
    },
  })

  console.log(
    'Found',
    rows.map((r) => ({
      room: r.room.roomNumber,
      guest: r.customer.name,
      reg: r.registrationNumber,
      checkOut: r.checkOut,
      totalRoomCharge: r.totalRoomCharge,
      dueAmount: r.dueAmount,
    }))
  )

  if (rows.length === 0) {
    console.log('No checked-in 903/915 bookings on this database.')
    return
  }

  for (const row of rows) {
    await extendIfNeeded(row.id, row.room.roomNumber)
    if (row.room.roomNumber === '915') {
      await fix915Due(row.id)
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
