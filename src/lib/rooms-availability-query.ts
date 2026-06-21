export type RoomsAvailabilityQueryParams = {
  checkIn: string
  checkOut: string
  /** Direct guest booking / initial / existing guest reservation */
  forBooking?: boolean
  /** Reservation entry wizard or convert-from-entry */
  forReservationEntry?: boolean
  excludeEntryId?: string
  /** When editing a booking, keep its current room in the list for the same dates */
  excludeBookingId?: string
  limit?: number
}

/** Build `/rooms?…` for date-scoped availability (shared by all reservation flows). */
export function buildRoomsAvailabilityQueryUrl(
  params: RoomsAvailabilityQueryParams
): string {
  const search = new URLSearchParams()
  search.set('checkIn', params.checkIn)
  search.set('checkOut', params.checkOut)
  search.set('limit', String(params.limit ?? 200))

  if (params.forReservationEntry) {
    search.set('forReservationEntry', 'true')
  } else {
    search.set('forBooking', 'true')
  }

  if (params.excludeEntryId?.trim()) {
    search.set('excludeEntryId', params.excludeEntryId.trim())
  }
  if (params.excludeBookingId?.trim()) {
    search.set('excludeBookingId', params.excludeBookingId.trim())
  }

  return `/rooms?${search.toString()}`
}

export type RoomsAvailabilityMeta = {
  categoryCapacity?: Array<{
    roomTypeId: string
    typeName: string
    total: number
    available: number
    entryHeld: number
  }>
}

export type RoomsAvailabilityResponse<T = unknown> = {
  success: boolean
  data: T[]
  meta?: RoomsAvailabilityMeta
}
