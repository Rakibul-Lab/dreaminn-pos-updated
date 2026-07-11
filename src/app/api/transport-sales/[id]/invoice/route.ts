import { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'
import { successResponse, errorResponse, notFoundResponse } from '@/lib/api-utils'
import { RoleType } from '@prisma/client'
import { buildTransportInvoiceDocument } from '../route'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireRole(
      request,
      'ADMIN' as RoleType,
      'HOTEL_STAFF' as RoleType,
      'HOTEL_FD' as RoleType
    )
    if (authResult instanceof Response) return authResult

    const { id } = await context.params
    const document = await buildTransportInvoiceDocument(id)
    if (!document) return notFoundResponse('Transport invoice not found')

    return successResponse(document)
  } catch (error) {
    console.error('Transport invoice document error:', error)
    return errorResponse('Failed to load transport invoice', 500)
  }
}
