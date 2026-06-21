import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { successResponse, errorResponse } from '@/lib/api-utils'
import {
  getOpenBusinessDayWindow,
  readCurrentBusinessDateString,
  getDayCloseGate,
  getCalendarDateString,
} from '@/lib/business-date'
import { buildOpenDayPreviewSnapshot } from '@/lib/day-close-snapshot'

/** Current business date + open-day preview for all authenticated staff. */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request)
    if (authResult instanceof Response) return authResult

    const [businessDate, window, preview, dayCloseGate] = await Promise.all([
      readCurrentBusinessDateString(),
      getOpenBusinessDayWindow(),
      buildOpenDayPreviewSnapshot(),
      getDayCloseGate(),
    ])

    return successResponse({
      businessDate,
      calendarDate: getCalendarDateString(),
      openedAt: window.openedAt.toISOString(),
      preview,
      dayCloseRequired: dayCloseGate.warning,
      daysBehind: dayCloseGate.daysBehind,
      dayCloseMessage: dayCloseGate.message ?? null,
    })
  } catch (error) {
    console.error('Business date error:', error)
    return errorResponse('Failed to load business date', 500)
  }
}
