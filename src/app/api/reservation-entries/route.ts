import { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'
import { successResponse, errorResponse, paginatedResponse, logActivity } from '@/lib/api-utils'
import { RoleType } from '@prisma/client'
import { db } from '@/lib/db'
import {
  createReservationEntry,
  listReservationEntries,
  mapReservationEntryToListRow,
  summarizeReservationEntries,
  type ReservationEntryLineInput,
  type ReservationEntryPaymentInput,
} from '@/lib/reservation-entry'
import { readCurrentBusinessDateString } from '@/lib/business-date'

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(
      request,
      'ADMIN' as RoleType,
      'HOTEL_STAFF' as RoleType,
      'HOTEL_FD' as RoleType
    )
    if (authResult instanceof Response) return authResult

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const limit = Math.max(1, Math.min(500, parseInt(searchParams.get('limit') || '20', 10) || 20))
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const search = searchParams.get('search')
    const summary = searchParams.get('summary') === 'true'
    const businessDate = searchParams.get('businessDate')
    const scopeParam = searchParams.get('scope')
    const scope =
      scopeParam === 'all' || scopeParam === 'business_day' ? scopeParam : 'business_day'

    if (summary) {
      const date =
        businessDate && businessDate.trim()
          ? businessDate.trim()
          : await readCurrentBusinessDateString()

      const useBusinessDayScope = scope === 'business_day' && !dateFrom && !dateTo

      const data = await summarizeReservationEntries({
        dateFrom,
        dateTo,
        search,
        scope: useBusinessDayScope ? 'business_day' : 'all',
        businessDate: useBusinessDayScope ? date : null,
      })

      return successResponse({ businessDate: date, byType: data })
    }

    const resolvedBusinessDate =
      businessDate && businessDate.trim()
        ? businessDate.trim()
        : scope === 'business_day'
          ? await readCurrentBusinessDateString()
          : null

    const { rows, total } = await listReservationEntries({
      page,
      limit,
      dateFrom,
      dateTo,
      search,
      scope,
      businessDate: resolvedBusinessDate,
    })

    return paginatedResponse(rows, total, page, limit)
  } catch (error) {
    console.error('Reservation entries list error:', error)
    return errorResponse('Failed to fetch reservation entries', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(
      request,
      'ADMIN' as RoleType,
      'HOTEL_STAFF' as RoleType,
      'HOTEL_FD' as RoleType
    )
    if (authResult instanceof Response) return authResult

    const authUser = await db.user.findUnique({
      where: { id: authResult.id },
      select: { id: true, active: true },
    })
    if (!authUser?.active) {
      return errorResponse('Session expired. Please log out and log in again.', 401)
    }

    const body = await request.json()
    const {
      checkIn,
      checkOut,
      notes,
      lines,
      guestName,
      guestPhone,
      guestEmail,
      guestAddress,
      company,
      companyLedgerId,
      discountEnabled,
      discountType,
      discountValue,
      entryPayments,
    } = body as {
      checkIn?: string
      checkOut?: string
      notes?: string
      lines?: ReservationEntryLineInput[]
      guestName?: string
      guestPhone?: string
      guestEmail?: string
      guestAddress?: string
      company?: string
      companyLedgerId?: string | null
      discountEnabled?: boolean
      discountType?: string | null
      discountValue?: number
      entryPayments?: Array<{ amount: number; method: string }>
    }

    if (!checkIn || !checkOut) {
      return errorResponse('Check-in and check-out dates are required')
    }
    if (!Array.isArray(lines) || !lines.length) {
      return errorResponse('At least one room line is required')
    }

    const entry = await createReservationEntry({
      checkIn,
      checkOut,
      notes,
      lines,
      guestName,
      guestPhone,
      guestEmail,
      guestAddress,
      company,
      companyLedgerId,
      discountEnabled,
      discountType,
      discountValue,
      entryPayments,
      createdBy: authUser.id,
      receivedBy: authResult.id,
    })

    await logActivity(
      authUser.id,
      'CREATE_RESERVATION_ENTRY',
      'hotel',
      `Created reservation entry (${entry.lines.length} line(s))`
    )

    return successResponse(mapReservationEntryToListRow(entry), 201)
  } catch (error) {
    console.error('Reservation entry create error:', error)
    const message = error instanceof Error ? error.message : 'Failed to create reservation entry'
    return errorResponse(message, 400)
  }
}
