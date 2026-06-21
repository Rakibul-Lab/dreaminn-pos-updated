import { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'
import { successResponse, errorResponse } from '@/lib/api-utils'
import { getHotelServiceChargePercent, getHotelVatPercent } from '@/lib/app-settings'
import { RoleType } from '@prisma/client'

/** Billing defaults for reservations (hotel staff). */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType)
    if (authResult instanceof Response) return authResult

    const [vatPercent, serviceChargePercent] = await Promise.all([
      getHotelVatPercent(),
      getHotelServiceChargePercent(),
    ])

    return successResponse({
      vatPercent,
      serviceChargePercent,
      vatAppliedByDefault: true,
    })
  } catch (error) {
    console.error('Billing settings error:', error)
    return errorResponse('Failed to load billing settings', 500)
  }
}
