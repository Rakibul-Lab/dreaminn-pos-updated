import { format, startOfDay } from 'date-fns'
import type { RoomStatus } from '@prisma/client'
import { getCalendarDayBounds } from '@/lib/business-date'
import type { PrismaClient } from '@prisma/client'

export type RoomActiveBookingSnapshot = {
  id: string
  status: 'RESERVED' | 'CHECKED_IN'
  checkIn: Date | string
  customerName?: string | null
}

export function formatStayCalendarDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return format(startOfDay(date), 'yyyy-MM-dd')
}

/** True when scheduled arrival calendar day is on or before the open business date. */
export function isArrivalOnOrBeforeBusinessDate(
  checkIn: Date | string,
  businessDate: string
): boolean {
  return formatStayCalendarDate(checkIn) <= businessDate
}

export function isArrivalOnBusinessDate(checkIn: Date | string, businessDate: string): boolean {
  return formatStayCalendarDate(checkIn) === businessDate
}

export type RoomBookingForDisplay = {
  id: string
  status: 'RESERVED' | 'CHECKED_IN'
  checkIn: Date | string
  checkOut: Date | string
  customerName?: string | null
}

/** True when a booking occupies any part of the view stay window (hotel check-in/out times). */
export function bookingOverlapsStayWindow(
  booking: { checkIn: Date | string; checkOut: Date | string },
  stayCheckIn: Date,
  stayCheckOut: Date
): boolean {
  const ci = typeof booking.checkIn === 'string' ? new Date(booking.checkIn) : booking.checkIn
  const co = typeof booking.checkOut === 'string' ? new Date(booking.checkOut) : booking.checkOut
  return ci < stayCheckOut && co > stayCheckIn
}

export function pickBookingForStayWindow(
  bookings: RoomBookingForDisplay[],
  stayCheckIn: Date,
  stayCheckOut: Date
): RoomBookingForDisplay | null {
  const overlapping = bookings.filter((b) =>
    bookingOverlapsStayWindow(b, stayCheckIn, stayCheckOut)
  )
  if (!overlapping.length) return null
  overlapping.sort((a, b) => {
    if (a.status === 'CHECKED_IN' && b.status !== 'CHECKED_IN') return -1
    if (b.status === 'CHECKED_IN' && a.status !== 'CHECKED_IN') return 1
    return new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime()
  })
  return overlapping[0]
}

/**
 * Rooms board status for a selected view date/range (tape-chart style).
 * When reflectLiveRoomState is false (future dates), only bookings/entry holds
 * affect status — a room occupied today can show Available on a future date.
 */
export function computeRoomDisplayStatusForStayWindow(
  roomStatus: RoomStatus,
  booking: RoomBookingForDisplay | null | undefined,
  options: {
    cleaningInProgress?: boolean
    entryHold?: { guestName?: string | null } | null
    reflectLiveRoomState?: boolean
  } = {}
): RoomStatus | 'IN_PROGRESS' | 'ENTRY_HELD' {
  const { cleaningInProgress = false, entryHold, reflectLiveRoomState = true } = options

  if (roomStatus === 'MAINTENANCE') return 'MAINTENANCE'

  if (booking) {
    return booking.status === 'CHECKED_IN' ? 'OCCUPIED' : 'RESERVED'
  }

  if (entryHold) return 'ENTRY_HELD'

  if (reflectLiveRoomState) {
    if (roomStatus === 'CLEANING' && cleaningInProgress) return 'IN_PROGRESS'
    if (roomStatus === 'CLEANING') return 'CLEANING'
    if (roomStatus === 'OCCUPIED') return 'OCCUPIED'
  }

  return 'AVAILABLE'
}

export function pickLiveActiveBooking(
  bookings: RoomBookingForDisplay[],
  businessDate: string
): RoomBookingForDisplay | null {
  const checkedIn = bookings.filter((b) => b.status === 'CHECKED_IN')
  if (checkedIn.length) {
    checkedIn.sort((a, b) => new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime())
    return checkedIn[0]
  }

  const reserved = bookings.filter(
    (b) =>
      b.status === 'RESERVED' && isArrivalOnOrBeforeBusinessDate(b.checkIn, businessDate)
  )
  if (reserved.length) {
    reserved.sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime())
    return reserved[0]
  }

  return null
}

/**
 * Visual status for the rooms board (live / open business day).
 * Future reservations keep the room sellable (AVAILABLE) until arrival day.
 */
export function computeRoomDisplayStatus(
  roomStatus: RoomStatus,
  activeBooking: RoomActiveBookingSnapshot | null | undefined,
  businessDate: string,
  cleaningInProgress = false,
  entryHold?: { guestName?: string | null; checkIn?: Date | string } | null
): RoomStatus | 'IN_PROGRESS' | 'ENTRY_HELD' {
  if (roomStatus === 'CLEANING' && cleaningInProgress) return 'IN_PROGRESS'
  if (roomStatus === 'OCCUPIED' || roomStatus === 'CLEANING' || roomStatus === 'MAINTENANCE') {
    return roomStatus
  }

  if (activeBooking?.status === 'CHECKED_IN') return 'OCCUPIED'

  if (
    activeBooking?.status === 'RESERVED' &&
    isArrivalOnOrBeforeBusinessDate(activeBooking.checkIn, businessDate)
  ) {
    return 'RESERVED'
  }

  if (
    entryHold &&
    !activeBooking &&
    entryHold.checkIn &&
    isArrivalOnOrBeforeBusinessDate(entryHold.checkIn, businessDate)
  ) {
    return 'ENTRY_HELD'
  }

  if (roomStatus === 'RESERVED' && !activeBooking) return 'AVAILABLE'

  return roomStatus === 'RESERVED' && activeBooking ? 'RESERVED' : 'AVAILABLE'
}

/** Flip AVAILABLE → RESERVED for arrivals on the open business date. */
export async function syncArrivalReservedRoomStatuses(
  db: PrismaClient,
  businessDate: string
): Promise<void> {
  const { start, end } = getCalendarDayBounds(businessDate)
  const arrivals = await db.booking.findMany({
    where: {
      status: 'RESERVED',
      checkIn: { gte: start, lte: end },
      room: { status: 'AVAILABLE' },
    },
    select: { roomId: true },
  })

  if (arrivals.length === 0) return

  await db.room.updateMany({
    where: { id: { in: arrivals.map((row) => row.roomId) } },
    data: { status: 'RESERVED' },
  })
}

/** Release rooms marked RESERVED while the only active stay is still in the future. */
export async function releasePrematureReservedRooms(
  db: PrismaClient,
  businessDate: string
): Promise<void> {
  const reservedRooms = await db.room.findMany({
    where: { status: 'RESERVED' },
    select: {
      id: true,
      bookings: {
        where: { status: { in: ['RESERVED', 'CHECKED_IN'] } },
        select: { status: true, checkIn: true },
      },
    },
  })

  const toRelease = reservedRooms
    .filter((room) => {
      if (room.bookings.some((booking) => booking.status === 'CHECKED_IN')) return false
      const reserved = room.bookings.filter((booking) => booking.status === 'RESERVED')
      if (reserved.length === 0) return true
      return reserved.every(
        (booking) => formatStayCalendarDate(booking.checkIn) > businessDate
      )
    })
    .map((room) => room.id)

  if (toRelease.length === 0) return

  await db.room.updateMany({
    where: { id: { in: toRelease } },
    data: { status: 'AVAILABLE' },
  })
}
