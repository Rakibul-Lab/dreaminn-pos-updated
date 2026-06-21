const { PrismaClient } = require('@prisma/client')

const db = new PrismaClient()

async function main() {
  const total = await db.booking.count()
  const withReg = await db.booking.count({
    where: { NOT: [{ registrationNumber: null }, { registrationNumber: '' }] },
  })
  const withoutReg = total - withReg

  const allWithReg = await db.booking.findMany({
    select: { registrationNumber: true },
    where: { registrationNumber: { not: null } },
  })
  const regMap = new Map()
  for (const b of allWithReg) {
    const r = b.registrationNumber?.trim()
    if (!r) continue
    regMap.set(r, (regMap.get(r) || 0) + 1)
  }
  const duplicateRegNumbers = [...regMap.entries()]
    .filter(([, c]) => c > 1)
    .map(([reg, count]) => ({ reg, count }))

  const bookings = await db.booking.findMany({
    select: {
      id: true,
      registrationNumber: true,
      customerId: true,
      status: true,
      createdAt: true,
      customer: { select: { name: true, registrationNumber: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  const customersWithMultipleStays = await db.booking.groupBy({
    by: ['customerId'],
    where: { registrationNumber: { not: null } },
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
  })

  const multiStayDetails = []
  for (const row of customersWithMultipleStays.slice(0, 8)) {
    const stays = await db.booking.findMany({
      where: { customerId: row.customerId },
      select: {
        registrationNumber: true,
        status: true,
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    const regs = stays.map((s) => s.registrationNumber?.trim() || null)
    const uniqueRegs = new Set(regs.filter(Boolean))
    multiStayDetails.push({
      guest: stays[0]?.customer?.name,
      stayCount: stays.length,
      registrationNumbers: regs,
      allUnique: uniqueRegs.size === regs.filter(Boolean).length,
    })
  }

  console.log('=== Booking registration number audit ===')
  console.log(`Total bookings: ${total}`)
  console.log(`With reg. no.: ${withReg}`)
  console.log(`Missing reg. no.: ${withoutReg}`)
  console.log(`Duplicate reg. nos across bookings: ${duplicateRegNumbers.length}`)
  if (duplicateRegNumbers.length) {
    console.log('Duplicates:', duplicateRegNumbers)
  }
  console.log('\n=== Repeat guests (multiple stays) ===')
  for (const d of multiStayDetails) {
    console.log(
      `- ${d.guest}: ${d.stayCount} stays, unique per stay: ${d.allUnique ? 'YES' : 'NO'}`,
      d.registrationNumbers
    )
  }
  console.log('\n=== Recent bookings ===')
  for (const b of bookings) {
    console.log(
      `${b.registrationNumber ?? 'MISSING'} | guest: ${b.customer.name} | customer reg: ${b.customer.registrationNumber ?? '—'} | ${b.status}`
    )
  }
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
