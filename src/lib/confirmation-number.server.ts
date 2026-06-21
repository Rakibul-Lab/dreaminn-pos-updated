import { db } from '@/lib/db'
import { CONFIRMATION_PREFIX, RESERVATION_ENTRY_CONFIRMATION_PREFIX } from '@/lib/confirmation-number'

/** Next sequential RRP-DI-###### (retries on unique collision). */
export async function generateConfirmationNumber(): Promise<string> {
  const existing = await db.booking.findMany({
    where: { confirmationNumber: { not: null } },
    select: { confirmationNumber: true },
  })

  let max = 0
  for (const row of existing) {
    const match = row.confirmationNumber?.match(/^RRP-DI-(\d{6})$/)
    if (match) max = Math.max(max, Number.parseInt(match[1], 10))
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    const next = max + 1 + attempt
    if (next > 999_999) throw new Error('Confirmation number limit reached')
    const candidate = `${CONFIRMATION_PREFIX}${String(next).padStart(6, '0')}`
    const taken = await db.booking.findFirst({
      where: { confirmationNumber: candidate },
      select: { id: true },
    })
    if (!taken) return candidate
  }

  throw new Error('Could not allocate confirmation number')
}

/** Next sequential RRP-RE-###### for reservation entry holds. */
export async function generateReservationEntryConfirmationNumber(): Promise<string> {
  const existing = await db.reservationEntry.findMany({
    where: { confirmationNumber: { not: null } },
    select: { confirmationNumber: true },
  })

  let max = 0
  for (const row of existing) {
    const match = row.confirmationNumber?.match(/^RRP-RE-(\d{6})$/)
    if (match) max = Math.max(max, Number.parseInt(match[1], 10))
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    const next = max + 1 + attempt
    if (next > 999_999) throw new Error('Reservation entry confirmation number limit reached')
    const candidate = `${RESERVATION_ENTRY_CONFIRMATION_PREFIX}${String(next).padStart(6, '0')}`
    const taken = await db.reservationEntry.findFirst({
      where: { confirmationNumber: candidate },
      select: { id: true },
    })
    if (!taken) return candidate
  }

  throw new Error('Could not allocate reservation entry confirmation number')
}

/** Persist confirmation number when missing (existing bookings). */
export async function ensureConfirmationNumber(bookingId: string): Promise<string> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, confirmationNumber: true },
  })
  if (!booking) throw new Error('Booking not found')
  if (booking.confirmationNumber) return booking.confirmationNumber

  const confirmationNumber = await generateConfirmationNumber()
  const updated = await db.booking.update({
    where: { id: bookingId },
    data: { confirmationNumber },
    select: { confirmationNumber: true },
  })
  return updated.confirmationNumber!
}

