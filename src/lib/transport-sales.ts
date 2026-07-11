import type { PrismaClient } from '@prisma/client'

export type TransportCartLine = {
  transportServiceId?: string | null
  serviceName: string
  description?: string | null
  unitPrice: number
  quantity: number
}

export const DEFAULT_TRANSPORT_SERVICES = [
  { name: 'Airport Pickup', description: 'Hotel to airport or airport to hotel', defaultPrice: 1500, sortOrder: 1 },
  { name: 'Airport Drop-off', description: 'Drop-off service to airport', defaultPrice: 1500, sortOrder: 2 },
  { name: 'City Transfer', description: 'Point-to-point city transfer', defaultPrice: 800, sortOrder: 3 },
  { name: 'Half Day Hire', description: 'Half day vehicle hire', defaultPrice: 3500, sortOrder: 4 },
  { name: 'Full Day Hire', description: 'Full day vehicle hire', defaultPrice: 6000, sortOrder: 5 },
] as const

export function computeTransportSaleTotals(
  lines: TransportCartLine[]
): { subtotal: number; vatAmount: number; totalAmount: number } {
  const totalAmount = Math.round(
    lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0) * 100
  ) / 100
  return { subtotal: totalAmount, vatAmount: 0, totalAmount }
}

export function computeTransportManualSaleTotal(amount: number): {
  subtotal: number
  vatAmount: number
  totalAmount: number
} {
  const totalAmount = Math.round(Math.max(0, amount) * 100) / 100
  return { subtotal: totalAmount, vatAmount: 0, totalAmount }
}

export async function generateTransportSaleNumber(
  db: Pick<PrismaClient, 'transportSale'>
): Promise<string> {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const prefix = `TRN-${y}${m}${d}-`

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const random = String(Math.floor(1000 + Math.random() * 9000))
    const saleNumber = `${prefix}${random}`
    const existing = await db.transportSale.findUnique({
      where: { saleNumber },
      select: { id: true },
    })
    if (!existing) return saleNumber
  }

  return `${prefix}${Date.now().toString().slice(-6)}`
}

export async function generateTransportInvoiceNumber(
  db: Pick<PrismaClient, 'transportInvoice'>
): Promise<string> {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const prefix = `TRP-${y}${m}${d}-`

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const random = String(Math.floor(1000 + Math.random() * 9000))
    const invoiceNumber = `${prefix}${random}`
    const existing = await db.transportInvoice.findUnique({
      where: { invoiceNumber },
      select: { id: true },
    })
    if (!existing) return invoiceNumber
  }

  return `${prefix}${Date.now().toString().slice(-6)}`
}

export async function ensureDefaultTransportServices(
  db: Pick<PrismaClient, 'transportService'>
): Promise<void> {
  const count = await db.transportService.count()
  if (count > 0) return

  await db.transportService.createMany({
    data: DEFAULT_TRANSPORT_SERVICES.map((service) => ({
      name: service.name,
      description: service.description,
      defaultPrice: service.defaultPrice,
      sortOrder: service.sortOrder,
      isActive: true,
    })),
  })
}
