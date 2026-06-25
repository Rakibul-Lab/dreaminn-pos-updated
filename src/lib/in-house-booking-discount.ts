import { db } from '@/lib/db'
import { bookingVatOptions, computeRoomBookingTotals } from '@/lib/booking-totals'

const inHouseBookingDiscountInclude = {
  customer: { select: { name: true } },
  room: { select: { roomNumber: true } },
  companyLedger: { select: { name: true } },
  sourceReservationEntry: { select: { registrationNumber: true } },
  companyLedgerGuest: { select: { registrationNumber: true } },
} as const

export type InHouseBookingDiscountRecord = Awaited<
  ReturnType<typeof fetchInHouseBookingDiscountsForWindow>
>[number]

export function inHouseBookingDiscountWhere(openedAt: Date, closedAt: Date) {
  return {
    status: { in: ['CHECKED_IN', 'RESERVED'] as const },
    discountEnabled: true,
    discountValue: { gt: 0 },
    OR: [
      { actualCheckIn: { gte: openedAt, lte: closedAt } },
      {
        status: 'RESERVED' as const,
        actualCheckIn: null,
        createdAt: { gte: openedAt, lte: closedAt },
      },
    ],
    invoices: {
      none: {
        status: { not: 'CANCELLED' as const },
        discount: { gt: 0 },
      },
    },
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
      invoices: {
        none: {
          status: { not: 'CANCELLED' },
          discount: { gt: 0 },
        },
      },
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
