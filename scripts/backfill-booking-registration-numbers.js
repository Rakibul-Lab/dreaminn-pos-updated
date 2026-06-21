/**
 * Assign a unique registration number to each booking that does not have one yet.
 * Usage: node scripts/backfill-booking-registration-numbers.js
 */
const { format } = require('date-fns')
const { PrismaClient } = require('@prisma/client')

const db = new PrismaClient()

function registrationNumberDatePrefix(date = new Date()) {
  return format(date, 'yyyyMMdd')
}

function parseSequence(registrationNumber, prefix) {
  if (!registrationNumber.startsWith(prefix)) return null
  const suffix = registrationNumber.slice(prefix.length)
  if (!/^\d{4}$/.test(suffix)) return null
  return parseInt(suffix, 10)
}

async function isRegistrationNumberTaken(candidate) {
  const [customer, ledgerGuest, reservationEntry, booking] = await Promise.all([
    db.customer.findFirst({ where: { registrationNumber: candidate }, select: { id: true } }),
    db.companyLedgerGuest.findFirst({
      where: { registrationNumber: candidate },
      select: { id: true },
    }),
    db.reservationEntry.findFirst({
      where: { registrationNumber: candidate },
      select: { id: true },
    }),
    db.booking.findFirst({ where: { registrationNumber: candidate }, select: { id: true } }),
  ])
  return !!(customer || ledgerGuest || reservationEntry || booking)
}

async function generateGuestRegistrationNumber(date = new Date()) {
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

async function resolveRegistrationNumber(booking) {
  const existing = booking.registrationNumber?.trim()
  if (existing) return existing

  const fromEntry = booking.sourceReservationEntry?.registrationNumber?.trim()
  if (fromEntry && !(await isRegistrationNumberTaken(fromEntry))) return fromEntry

  return generateGuestRegistrationNumber()
}

async function main() {
  const bookings = await db.booking.findMany({
    where: { OR: [{ registrationNumber: null }, { registrationNumber: '' }] },
    select: {
      id: true,
      registrationNumber: true,
      sourceReservationEntry: { select: { registrationNumber: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  if (bookings.length === 0) {
    console.log('All bookings already have registration numbers.')
    await db.$disconnect()
    return
  }

  console.log(`Backfilling ${bookings.length} booking(s)...`)
  let updated = 0

  for (const booking of bookings) {
    const registrationNumber = await resolveRegistrationNumber(booking)
    await db.booking.update({
      where: { id: booking.id },
      data: { registrationNumber },
    })
    updated += 1
    console.log(`  ${booking.id} -> ${registrationNumber}`)
  }

  console.log(`Done. Updated ${updated} booking(s).`)
  await db.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await db.$disconnect()
  process.exit(1)
})
