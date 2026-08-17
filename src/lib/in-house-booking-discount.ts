import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { bookingVatOptions, computeRoomBookingTotals } from '@/lib/booking-totals'

const inHouseBookingDiscountInclude = {
  customer: { select: { name: true } },
  room: { select: { roomNumber: true, totalPrice: true } },
  companyLedger: { select: { name: true } },
  sourceReservationEntry: { select: { registrationNumber: true } },
  companyLedgerGuest: { select: { registrationNumber: true } },
} as const

export type InHouseBookingDiscountRecord = Awaited<
  ReturnType<typeof fetchInHouseBookingDiscountsForWindow>
>[number]

/**
 * Discounts on stays that have not reached a bill yet. A booking leaves this set
 * the moment the guest checks out, and only then does its invoice discount get
 * reported, so a discount is never counted twice. An invoice previewed while the
 * guest is in house is not a bill and must not hide the stay from the reports.
 */
export function inHouseBookingDiscountWhere(
  openedAt: Date,
  closedAt: Date
): Prisma.BookingWhereInput {
  return {
    status: { in: ['CHECKED_IN', 'RESERVED'] },
    discountEnabled: true,
    discountValue: { gt: 0 },
    OR: [
      { actualCheckIn: { gte: openedAt, lte: closedAt } },
      {
        status: 'RESERVED',
        actualCheckIn: null,
        createdAt: { gte: openedAt, lte: closedAt },
      },
    ],
  }
}

export async function fetchInHouseBookingDiscountsForWindow(openedAt: Date, closedAt: Date) {
  return db.booking.findMany({
    where: inHouseBookingDiscountWhere(openedAt, closedAt),
    include: inHouseBookingDiscountInclude,
    orderBy: { createdAt: 'asc' },
  })
}

export async function fetchAllInHouseBookingDiscounts() {
  return db.booking.findMany({
    where: {
      status: { in: ['CHECKED_IN', 'RESERVED'] },
      discountEnabled: true,
      discountValue: { gt: 0 },
    },
    include: inHouseBookingDiscountInclude,
    orderBy: { createdAt: 'asc' },
  })
}

export function bookingDiscountAmount(booking: {
  totalRoomCharge: number
  discountEnabled: boolean
  discountType: string | null
  discountValue: number
  checkIn?: Date | string | null
  checkOut?: Date | string | null
  vatApplied?: boolean | null
  vatPercent?: number | null
}): number {
  return computeRoomBookingTotals(
    booking.totalRoomCharge,
    0,
    bookingVatOptions(booking),
    booking
  ).discountAmount
}

export function sumInHouseBookingDiscounts(
  bookings: Array<Parameters<typeof bookingDiscountAmount>[0]>
): number {
  return Number(
    bookings.reduce((sum, booking) => sum + bookingDiscountAmount(booking), 0).toFixed(2)
  )
}
