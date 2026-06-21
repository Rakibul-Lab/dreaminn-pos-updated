/**
 * Rename base_price -> total_price and drop deprecated room pricing columns.
 * Run before `npx prisma db push --accept-data-loss` when upgrading.
 */
const { PrismaClient } = require('@prisma/client')

const db = new PrismaClient()

async function tryExecute(sql) {
  try {
    await db.$executeRawUnsafe(sql)
    return true
  } catch {
    return false
  }
}

async function main() {
  await tryExecute(
    'ALTER TABLE rooms CHANGE COLUMN base_price total_price DOUBLE NOT NULL DEFAULT 0'
  )
  await tryExecute(
    'ALTER TABLE rooms ADD COLUMN total_price DOUBLE NOT NULL DEFAULT 0'
  )
  await tryExecute(
    'UPDATE rooms SET total_price = base_price WHERE total_price = 0 AND base_price > 0'
  )
  await tryExecute('ALTER TABLE rooms DROP COLUMN hourly_rate')
  await tryExecute('ALTER TABLE rooms DROP COLUMN vat_percent')
  await tryExecute('ALTER TABLE rooms DROP COLUMN service_charge_percent')
  await tryExecute('ALTER TABLE rooms DROP COLUMN base_price')
  console.log('Room pricing columns updated (total_price is inclusive nightly rate).')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
