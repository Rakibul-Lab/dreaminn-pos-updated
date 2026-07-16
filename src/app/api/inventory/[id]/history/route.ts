import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireInventoryAccess } from '@/lib/auth'
import { successResponse, errorResponse, notFoundResponse } from '@/lib/api-utils'
import { Prisma } from '@prisma/client'

type RouteContext = { params: Promise<{ id: string }> }

function parseDayBound(value: string | null, endOfDay: boolean): Date | null {
  if (!value?.trim()) return null
  const date = new Date(`${value.trim()}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`)
  return Number.isNaN(date.getTime()) ? null : date
}

// GET /api/inventory/[id]/history
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireInventoryAccess(request)
    if (authResult instanceof Response) return authResult

    const { id } = await context.params
    const { searchParams } = new URL(request.url)
    const dateFrom = parseDayBound(searchParams.get('dateFrom'), false)
    const dateTo = parseDayBound(searchParams.get('dateTo'), true)
    const type = searchParams.get('type')?.trim()
    const limit = Math.max(1, Math.min(5000, parseInt(searchParams.get('limit') || '500', 10) || 500))

    const item = await db.inventoryItem.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        category: true,
        unit: true,
        quantity: true,
        minQuantity: true,
        costPerUnit: true,
        supplier: true,
      },
    })

    if (!item) return notFoundResponse('Inventory item')

    const createdAt: Prisma.DateTimeFilter = {}
    if (dateFrom) createdAt.gte = dateFrom
    if (dateTo) createdAt.lte = dateTo

    const where: Prisma.InventoryTransactionWhereInput = {
      itemId: id,
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
      ...(type && ['in', 'out', 'waste'].includes(type) ? { type } : {}),
    }

    const transactions = await db.inventoryTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    const userIds = [...new Set(transactions.map((tx) => tx.createdBy).filter(Boolean))]
    const users =
      userIds.length > 0
        ? await db.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true },
          })
        : []
    const userNameById = new Map(users.map((user) => [user.id, user.name]))

    const history = transactions.map((tx) => ({
      id: tx.id,
      type: tx.type,
      quantity: tx.quantity,
      notes: tx.notes,
      createdBy: tx.createdBy,
      createdByName: userNameById.get(tx.createdBy) ?? null,
      createdAt: tx.createdAt.toISOString(),
    }))

    const summary = {
      stockIn: history
        .filter((row) => row.type === 'in')
        .reduce((sum, row) => sum + row.quantity, 0),
      stockOut: history
        .filter((row) => row.type === 'out')
        .reduce((sum, row) => sum + row.quantity, 0),
      waste: history
        .filter((row) => row.type === 'waste')
        .reduce((sum, row) => sum + row.quantity, 0),
      movementCount: history.length,
    }

    return successResponse({
      item,
      history,
      summary,
    })
  } catch (error) {
    console.error('Inventory item history error:', error)
    return errorResponse('Failed to fetch inventory history', 500)
  }
}
