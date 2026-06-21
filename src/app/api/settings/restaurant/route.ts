import { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'
import { successResponse, errorResponse } from '@/lib/api-utils'
import { getRestaurantName, getRestaurantVatPercent } from '@/lib/app-settings'
import { RoleType } from '@prisma/client'

/** Restaurant operational settings for POS and orders. */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(
      request,
      'ADMIN' as RoleType,
      'HOTEL_STAFF' as RoleType,
      'HOTEL_FD' as RoleType,
      'RESTAURANT_STAFF' as RoleType
    )
    if (authResult instanceof Response) return authResult

    const [restaurantName, vatPercent] = await Promise.all([
      getRestaurantName(),
      getRestaurantVatPercent(),
    ])

    return successResponse({
      restaurantName,
      vatPercent,
    })
  } catch (error) {
    console.error('Restaurant settings error:', error)
    return errorResponse('Failed to load restaurant settings', 500)
  }
}
