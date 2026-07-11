import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { successResponse, errorResponse, logActivity } from '@/lib/api-utils'
import { RoleType } from '@prisma/client'
import { ensureDefaultTransportServices } from '@/lib/transport-sales'

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(
      request,
      'ADMIN' as RoleType,
      'HOTEL_STAFF' as RoleType,
      'HOTEL_FD' as RoleType
    )
    if (authResult instanceof Response) return authResult

    await ensureDefaultTransportServices(db)

    const includeInactive = request.nextUrl.searchParams.get('includeInactive') === '1'
    const services = await db.transportService.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })

    return successResponse(services)
  } catch (error) {
    console.error('Transport services list error:', error)
    return errorResponse('Failed to fetch transport services', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType)
    if (authResult instanceof Response) return authResult

    const body = await request.json()
    const name = String(body.name || '').trim()
    const description = body.description ? String(body.description).trim() : null
    const defaultPrice = Math.max(0, Number(body.defaultPrice) || 0)
    const sortOrder = Math.max(0, parseInt(String(body.sortOrder ?? 0), 10) || 0)

    if (!name) return errorResponse('Service name is required')

    const service = await db.transportService.create({
      data: {
        name,
        description,
        defaultPrice,
        sortOrder,
        isActive: true,
      },
    })

    await logActivity(
      authResult.id,
      'CREATE_TRANSPORT_SERVICE',
      'hotel',
      JSON.stringify({ serviceId: service.id, name: service.name })
    )

    return successResponse(service, 201)
  } catch (error) {
    console.error('Transport service create error:', error)
    return errorResponse('Failed to create transport service', 500)
  }
}
