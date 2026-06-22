import type { PrismaClient } from '@prisma/client'

export type BeverageCartLine = {
  menuItemId: string
  name: string
  unitPrice: number
  quantity: number
}

/** Stored in menu_categories.description — not shown in the UI. */
export const HOTEL_BEVERAGE_CATEGORY_MARKER = 'HOTEL_BEVERAGE_POS'

export type MenuCategoryLike = {
  name: string
  description?: string | null
}

export function computeBeverageCartTotals(lines: BeverageCartLine[]): {
  subtotal: number
  totalAmount: number
} {
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    totalAmount: Math.round(subtotal * 100) / 100,
  }
}

export async function generateHotelBeverageSaleNumber(db: Pick<PrismaClient, 'hotelBeverageSale'>): Promise<string> {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const prefix = `BEV-${y}${m}${d}-`

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const random = String(Math.floor(1000 + Math.random() * 9000))
    const saleNumber = `${prefix}${random}`
    const existing = await db.hotelBeverageSale.findUnique({
      where: { saleNumber },
      select: { id: true },
    })
    if (!existing) return saleNumber
  }

  return `${prefix}${Date.now().toString().slice(-6)}`
}

/** Legacy: older categories were tagged by having "beverage" in the name. */
export function isBeverageCategoryName(name: string): boolean {
  return name.trim().toLowerCase().includes('beverage')
}

/** Hotel beverage POS category (separate from CloudView restaurant menu). */
export function isHotelBeverageMenuCategory(category: MenuCategoryLike): boolean {
  if (category.description?.includes(HOTEL_BEVERAGE_CATEGORY_MARKER)) {
    return true
  }
  return isBeverageCategoryName(category.name)
}
