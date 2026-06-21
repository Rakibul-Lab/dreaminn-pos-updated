import type { RoomStatus } from '@prisma/client'

/** Rooms that must never be sold or assigned, regardless of stay dates. */
export const ROOM_STATUSES_BLOCKED_FOR_SALE: RoomStatus[] = ['MAINTENANCE', 'CLEANING']

/** Physical statuses considered when resolving date-scoped availability. */
export const ROOM_STATUSES_DATE_SCOPED_CANDIDATES: RoomStatus[] = [
  'AVAILABLE',
  'RESERVED',
  'OCCUPIED',
]

export function isRoomStatusBlockedForSale(status: string): boolean {
  return ROOM_STATUSES_BLOCKED_FOR_SALE.includes(status as RoomStatus)
}

export function filterSellableRooms<T extends { status: string }>(rooms: T[]): T[] {
  return rooms.filter((room) => !isRoomStatusBlockedForSale(room.status))
}

export function roomBlockedForSaleMessage(
  roomNumber: string,
  status: string
): string {
  if (status === 'MAINTENANCE') {
    return `Room ${roomNumber} is under maintenance and cannot be reserved`
  }
  if (status === 'CLEANING') {
    return `Room ${roomNumber} is dirty / under cleaning and cannot be reserved`
  }
  return `Room ${roomNumber} is not available`
}
