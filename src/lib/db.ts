import { PrismaClient } from '@prisma/client'
import { getServerEnv } from '@/lib/env'

/** Bump when Prisma schema changes so dev HMR picks up new fields without a full server restart. */
const PRISMA_CLIENT_VERSION = '20250713120000_inventory_categories'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaClientVersion?: string
}

function createPrismaClient() {
  return new PrismaClient({
    datasources: {
      db: { url: getServerEnv().DATABASE_URL },
    },
    log: process.env.NODE_ENV === 'development' ? ['query'] : [],
  })
}

if (
  globalForPrisma.prisma &&
  globalForPrisma.prismaClientVersion !== PRISMA_CLIENT_VERSION
) {
  void globalForPrisma.prisma.$disconnect()
  globalForPrisma.prisma = undefined
}

export const db =
  globalForPrisma.prisma ??
  (() => {
    const client = createPrismaClient()
    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.prisma = client
      globalForPrisma.prismaClientVersion = PRISMA_CLIENT_VERSION
    }
    return client
  })()