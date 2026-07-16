import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireInventoryAccess } from '@/lib/auth'
import { successResponse, errorResponse, logActivity } from '@/lib/api-utils'

// GET /api/inventory/categories
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireInventoryAccess(request)
    if (authResult instanceof Response) return authResult

    const { searchParams } = new URL(request.url)
    const includeInactive = searchParams.get('includeInactive') === 'true'

    const categories = await db.inventoryCategory.findMany({
      where: includeInactive ? undefined : { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { items: true } },
      },
    })

    return successResponse(categories)
  } catch (error) {
    console.error('Inventory categories list error:', error)
    return errorResponse('Failed to fetch inventory categories', 500)
  }
}

// POST /api/inventory/categories
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireInventoryAccess(request)
    if (authResult instanceof Response) return authResult

    const body = await request.json()
    const name = String(body.name || '').trim()
    const description = body.description ? String(body.description).trim() : null

    if (!name) {
      return errorResponse('Category name is required')
    }

    const existing = await db.inventoryCategory.findUnique({
      where: { name },
    })
    if (existing) {
      if (!existing.active) {
        const reactivated = await db.inventoryCategory.update({
          where: { id: existing.id },
          data: {
            active: true,
            description: description ?? existing.description,
          },
        })
        await logActivity(
          authResult.id,
          'REACTIVATE_INVENTORY_CATEGORY',
          'restaurant',
          `Reactivated inventory category: ${name}`
        )
        return successResponse(reactivated, 'Category restored successfully')
      }
      return errorResponse('A category with this name already exists')
    }

    const maxSort = await db.inventoryCategory.aggregate({ _max: { sortOrder: true } })
    const category = await db.inventoryCategory.create({
      data: {
        name,
        description,
        active: true,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      },
    })

    await logActivity(
      authResult.id,
      'CREATE_INVENTORY_CATEGORY',
      'restaurant',
      `Created inventory category: ${name}`
    )

    return successResponse(category, 'Category created successfully', 201)
  } catch (error) {
    console.error('Inventory category create error:', error)
    return errorResponse('Failed to create inventory category', 500)
  }
}
