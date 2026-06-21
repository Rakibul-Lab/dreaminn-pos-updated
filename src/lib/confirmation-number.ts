export const CONFIRMATION_PREFIX = 'RRP-DI-'
export const RESERVATION_ENTRY_CONFIRMATION_PREFIX = 'RRP-RE-'

/** Display confirmation number (stored value or legacy fallback from id). */
export function formatConfirmationNumber(booking: {
  id: string
  confirmationNumber?: string | null
}): string {
  if (booking.confirmationNumber) return booking.confirmationNumber
  return legacyConfirmationFromId(booking.id)
}

/** Display reservation entry confirmation number. */
export function formatReservationEntryConfirmationNumber(entry: {
  id: string
  confirmationNumber?: string | null
}): string {
  if (entry.confirmationNumber) return entry.confirmationNumber
  const n =
    [...entry.id].reduce((acc, c) => (Math.imul(acc, 31) + c.charCodeAt(0)) | 0, 0) % 1_000_000
  return `${RESERVATION_ENTRY_CONFIRMATION_PREFIX}${String(Math.abs(n)).padStart(6, '0')}`
}

function sanitizeFileNamePart(value: string): string {
  return value
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '')
    .replace(/\s+/g, '-')
}

/** PDF download name: reservation-rakibul-hassan-RRP-DI-000001.pdf */
export function reservationPdfFileName(booking: {
  id: string
  confirmationNumber?: string | null
  customer: { name: string }
}): string {
  const guest = sanitizeFileNamePart(booking.customer.name).toLowerCase()
  const confirmation = formatConfirmationNumber(booking)
  return `reservation-${guest}-${confirmation}.pdf`
}

/** PDF download name for reservation entry holds. */
export function reservationEntryPdfFileName(entry: {
  id: string
  confirmationNumber?: string | null
  guestName: string | null
}): string {
  const guest = sanitizeFileNamePart(entry.guestName ?? 'guest').toLowerCase()
  const confirmation = formatReservationEntryConfirmationNumber(entry)
  return `reservation-entry-${guest}-${confirmation}.pdf`
}

function legacyConfirmationFromId(id: string): string {
  const n =
    [...id].reduce((acc, c) => (Math.imul(acc, 31) + c.charCodeAt(0)) | 0, 0) % 1_000_000
  return `${CONFIRMATION_PREFIX}${String(Math.abs(n)).padStart(6, '0')}`
}
