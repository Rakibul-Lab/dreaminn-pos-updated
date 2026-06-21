/** Client-safe helper — resolve reg. no. for a stay from booking fields (no server/db imports). */
export function resolveBookingRegistrationNumber(booking: {
  registrationNumber?: string | null
  sourceReservationEntry?: { registrationNumber?: string | null } | null
  companyLedgerGuest?: { registrationNumber?: string | null } | null
}): string {
  const fromBooking = booking.registrationNumber?.trim()
  if (fromBooking) return fromBooking
  const fromEntry = booking.sourceReservationEntry?.registrationNumber?.trim()
  if (fromEntry) return fromEntry
  const fromLedger = booking.companyLedgerGuest?.registrationNumber?.trim()
  if (fromLedger) return fromLedger
  return ''
}
