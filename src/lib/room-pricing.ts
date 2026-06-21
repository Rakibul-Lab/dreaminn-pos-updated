export type RoomPricingFields = {
  totalPrice?: number | null
  /** @deprecated use totalPrice */
  basePrice?: number | null
}

/** Nightly room rate (inclusive of VAT and service charge). */
export function getRoomNightlyTotal(room: RoomPricingFields): number {
  const raw = room.totalPrice ?? room.basePrice
  return Math.max(0, Number(raw) || 0)
}

/** @deprecated use getRoomNightlyTotal */
export const getRoomNightlyRate = getRoomNightlyTotal
