import { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'
import { successResponse, errorResponse, notFoundResponse } from '@/lib/api-utils'
import { getCustomerIdDocumentPaths } from '@/lib/customer-id-documents'
import { db } from '@/lib/db'
import { RoleType } from '@prisma/client'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
 authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType)
    if (authResult instanceof Response) return authResult

    const { id } = await params

    const exists = await db.customer.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!exists) return notFoundResponse('Customer')

    const paths = await getCustomerIdDocumentPaths(id)
    return successResponse({ paths })
  } catch (error) {
    console.error('Customer ID documents error:', error)
    return errorResponse('Failed to fetch guest ID documents', 500)
  }
}
