import { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'
import { successResponse, errorResponse, logActivity } from '@/lib/api-utils'
import { RoleType } from '@prisma/client'
import {
  createBookingRestaurantBill,
  listBookingRestaurantBills,
} from '@/lib/booking-restaurant-bill'
import { parsePaymentMethod } from '@/lib/payment-method'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireRole(
      _request,
      'ADMIN' as RoleType,
      'HOTEL_STAFF' as RoleType,
      'HOTEL_FD' as RoleType
    )
    if (authResult instanceof Response) return authResult

    const { id } = await context.params
    const bills = await listBookingRestaurantBills(id)
    return successResponse(bills)
  } catch (error) {
    console.error('List booking restaurant bills error:', error)
    return errorResponse('Failed to fetch restaurant bills', 500)
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireRole(
      request,
      'ADMIN' as RoleType,
      'HOTEL_STAFF' as RoleType,
      'HOTEL_FD' as RoleType
    )
    if (authResult instanceof Response) return authResult

    const { id } = await context.params
    const body = await request.json()

    const result = await createBookingRestaurantBill(
      id,
      {
        billNo: String(body.billNo ?? ''),
        paymentMethod: parsePaymentMethod(body.paymentMethod),
        amount: Number(body.amount),
        discount: body.discount !== undefined ? Number(body.discount) : 0,
        vatPercent: body.vatPercent !== undefined ? Number(body.vatPercent) : undefined,
        vatApplied: body.vatApplied !== false,
        notes: body.notes ? String(body.notes) : undefined,
      },
      authResult.id
    )

    await logActivity(
      authResult.id,
      'BOOKING_RESTAURANT_BILL',
      'hotel',
      JSON.stringify({
        bookingId: id,
        orderId: result.order.id,
        orderNumber: result.order.orderNumber,
        totalAmount: result.order.totalAmount,
      })
    )

    return successResponse(result, 'Restaurant bill added to guest folio', 201)
  } catch (error) {
    console.error('Create booking restaurant bill error:', error)
    const message = error instanceof Error ? error.message : 'Failed to add restaurant bill'
    return errorResponse(message, 400)
  }
}
