const { PrismaClient } = require('@prisma/client')

const db = new PrismaClient()

async function main() {
  const companies = await db.companyLedger.findMany({
    include: {
      bills: {
        select: {
          id: true,
          billType: true,
          totalAmount: true,
          paidAmount: true,
          dueAmount: true,
          settlementStage: true,
          guestName: true,
          bookingId: true,
          reservationEntryId: true,
        },
      },
      guests: { select: { id: true, guestName: true } },
    },
    orderBy: { name: 'asc' },
  })

  console.log('=== Company Ledger Data Audit ===\n')
  let driftCount = 0

  for (const c of companies) {
    const sumBilled = c.bills.reduce((s, b) => s + b.totalAmount, 0)
    const sumPaid = c.bills.reduce((s, b) => s + b.paidAmount, 0)
    const sumDue = c.bills.reduce((s, b) => s + b.dueAmount, 0)
    const billedDrift = Math.abs((c.totalBilled || 0) - sumBilled) > 0.01
    const paidDrift = Math.abs((c.totalPaid || 0) - sumPaid) > 0.01
    const dueDrift = Math.abs((c.dueAmount || 0) - sumDue) > 0.01

    if (c.bills.length === 0 && !c.isSystem) continue

    console.log(`--- ${c.name}${c.isSystem ? ' (SYSTEM CloudView)' : ''} ---`)
    console.log(`  Guests: ${c.guests.length} | Bills: ${c.bills.length}`)
    console.log(`  Stored totals: billed ${c.totalBilled} | paid ${c.totalPaid} | due ${c.dueAmount}`)
    console.log(`  Sum of bills:  billed ${sumBilled.toFixed(2)} | paid ${sumPaid.toFixed(2)} | due ${sumDue.toFixed(2)}`)

    if (billedDrift || paidDrift || dueDrift) {
      console.log('  ⚠ AGGREGATE MISMATCH')
      driftCount++
    }

    const openBills = c.bills.filter((b) => b.dueAmount > 0.009)
    if (openBills.length) {
      console.log('  Open bills:')
      for (const b of openBills) {
        console.log(
          `    - ${b.billType} | due ${b.dueAmount.toFixed(2)} | stage ${b.settlementStage ?? '—'} | ${b.guestName}`
        )
      }
    }
    console.log('')
  }

  const corpBookings = await db.booking.count({ where: { companyLedgerId: { not: null } } })
  const billsNoBooking = await db.companyLedgerBill.count({
    where: { billType: 'BOOKING', bookingId: null },
  })
  const entryBillsOpen = await db.companyLedgerBill.count({
    where: { billType: 'RESERVATION_ENTRY', dueAmount: { gt: 0.009 } },
  })

  console.log('=== Cross-checks ===')
  console.log(`Corporate bookings linked: ${corpBookings}`)
  console.log(`BOOKING bills missing bookingId: ${billsNoBooking}`)
  console.log(`Open RESERVATION_ENTRY bills: ${entryBillsOpen}`)

  if (entryBillsOpen > 0) {
    const entries = await db.companyLedgerBill.findMany({
      where: { billType: 'RESERVATION_ENTRY', dueAmount: { gt: 0.009 } },
      select: { id: true, guestName: true, dueAmount: true, companyLedger: { select: { name: true } } },
    })
    console.log('  (These cannot be paid via company "Receive payment" — booking bills only)')
    for (const e of entries) {
      console.log(`    ${e.companyLedger.name}: ${e.guestName} due ${e.dueAmount}`)
    }
  }

  console.log(
    driftCount === 0
      ? '\nPASS: Company totals match sum of bills'
      : `\nFAIL: ${driftCount} company(ies) with aggregate drift`
  )
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
