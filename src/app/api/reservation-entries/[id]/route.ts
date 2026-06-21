import { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'
import { successResponse, errorResponse, logActivity } from '@/lib/api-utils'
import { RoleType } from '@prisma/client'
import { db } from '@/lib/db'
import {
  cancelReservationEntry,
  mapReservationEntryToListRow,
} from '@/lib/reservation-entry'
import { buildReservationEntryDocumentData } from '@/lib/reservation-entry-document'
import {
  convertReservationEntry,
  type ConvertAssignmentInput,
} from '@/lib/reservation-entry-convert'

type RouteContext = { params: Promise<{ id: string }> }

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
    const body = await request.json().catch(() => ({}))
    const action = (body as { action?: string }).action

    if (action === 'cancel') {
      const entry = await cancelReservationEntry(id)

      await logActivity(
        authResult.id,
        'CANCEL_RESERVATION_ENTRY',
        'hotel',
        `Cancelled reservation entry ${id}`
      )

      return successResponse(mapReservationEntryToListRow(entry))
    }

    if (action === 'convert') {
      const assignments = (body as { assignments?: ConvertAssignmentInput[] }).assignments ?? []
      const checkInNow = (body as { checkInNow?: boolean }).checkInNow === true

      const result = await convertReservationEntry({
        entryId: id,
        assignments,
        createdBy: authResult.id,
        receivedBy: authResult.id,
        checkInNow,
      })

      await logActivity(
        authResult.id,
        'CONVERT_RESERVATION_ENTRY',
        'hotel',
        JSON.stringify({
          entryId: id,
          bookingIds: result.bookings.map((row) => row.bookingId),
        })
      )

      return successResponse(result)
    }

    return errorResponse('Invalid action', 400)
  } catch (error) {
    console.error('Reservation entry action error:', error)
    const message = error instanceof Error ? error.message : 'Failed to update reservation entry'
    return errorResponse(message, 400)
  }
}

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
    const view = request.nextUrl.searchParams.get('view')

    if (view === 'document') {
      const document = await buildReservationEntryDocumentData(id)
      return successResponse(document)
    }

    const entry = await db.reservationEntry.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, name: true } },
        companyLedger: { select: { id: true, name: true } },
        lines: {
          include: {
            roomType: { select: { id: true, name: true } },
            room: { select: { id: true, roomNumber: true } },
            lineBookings: {
              select: {
                id: true,
                bookingId: true,
                booking: { select: { id: true, confirmationNumber: true } },
                room: { select: { roomNumber: true } },
              },
            },
          },
        },
      },
    })

    if (!entry) return errorResponse('Reservation entry not found', 404)
    return successResponse(mapReservationEntryToListRow(entry))
  } catch (error) {
    console.error('Reservation entry fetch error:', error)
    return errorResponse('Failed to fetch reservation entry', 500)
  }
}
