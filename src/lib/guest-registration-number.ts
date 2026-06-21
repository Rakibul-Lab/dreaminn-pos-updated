import { format } from 'date-fns'
import { db } from '@/lib/db'

/** Prefix: YYYYMMDD (year, month, day) + 4-digit daily sequence. */
export function registrationNumberDatePrefix(date: Date = new Date()): string {
  return format(date, 'yyyyMMdd')
}

function parseSequence(registrationNumber: string, prefix: string): number | null {
  if (!registrationNumber.startsWith(prefix)) return null
  const suffix = registrationNumber.slice(prefix.length)
  if (!/^\d{4}$/.test(suffix)) return null
  return parseInt(suffix, 10)
}

async function isRegistrationNumberTaken(candidate: string): Promise<boolean> {
  const [customer, ledgerGuest, reservationEntry, booking] = await Promise.all([
    db.customer.findFirst({
      where: { registrationNumber: candidate },
      select: { id: true },
    }),
    db.companyLedgerGuest.findFirst({
      where: { registrationNumber: candidate },
      select: { id: true },
    }),
    db.reservationEntry.findFirst({
      where: { registrationNumber: candidate },
      select: { id: true },
    }),
    db.booking.findFirst({
      where: { registrationNumber: candidate },
      select: { id: true },
    }),
  ])
  return !!(customer || ledgerGuest || reservationEntry || booking)
}

export async function generateGuestRegistrationNumber(date: Date = new Date()): Promise<string> {
  const prefix = registrationNumberDatePrefix(date)

  const [customers, ledgerGuests, reservationEntries, bookings] = await Promise.all([
    db.customer.findMany({
      where: { registrationNumber: { startsWith: prefix } },
      select: { registrationNumber: true },
    }),
    db.companyLedgerGuest.findMany({
      where: { registrationNumber: { startsWith: prefix } },
      select: { registrationNumber: true },
    }),
    db.reservationEntry.findMany({
      where: { registrationNumber: { startsWith: prefix } },
      select: { registrationNumber: true },
    }),
    db.booking.findMany({
      where: { registrationNumber: { startsWith: prefix } },
      select: { registrationNumber: true },
    }),
  ])

  let max = 0
  for (const row of [...customers, ...ledgerGuests, ...reservationEntries, ...bookings]) {
    if (!row.registrationNumber) continue
    const seq = parseSequence(row.registrationNumber, prefix)
    if (seq != null) max = Math.max(max, seq)
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    const next = max + 1 + attempt
    if (next > 9999) throw new Error('Daily registration number limit reached')
    const candidate = `${prefix}${String(next).padStart(4, '0')}`
    if (!(await isRegistrationNumberTaken(candidate))) return candidate
  }

  throw new Error('Could not allocate registration number')
}

export async function ensureCustomerRegistrationNumber(customerId: string): Promise<string> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, registrationNumber: true },
  })
  if (!customer) throw new Error('Customer not found')
  if (customer.registrationNumber?.trim()) return customer.registrationNumber.trim()

  const registrationNumber = await generateGuestRegistrationNumber()
  await db.customer.update({
    where: { id: customerId },
    data: { registrationNumber },
  })
  return registrationNumber
}

/** Assign a unique registration number to a booking (one per stay). */
export async function ensureBookingRegistrationNumber(bookingId: string): Promise<string> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      registrationNumber: true,
      sourceReservationEntry: { select: { registrationNumber: true } },
    },
  })
  if (!booking) throw new Error('Booking not found')

  const existing = booking.registrationNumber?.trim()
  if (existing) return existing

  const fromEntry = booking.sourceReservationEntry?.registrationNumber?.trim()
  const registrationNumber = fromEntry || (await generateGuestRegistrationNumber())

  await db.booking.update({
    where: { id: bookingId },
    data: { registrationNumber },
  })
  return registrationNumber
}
