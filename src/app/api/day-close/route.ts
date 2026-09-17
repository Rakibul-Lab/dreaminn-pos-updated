import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { successResponse, errorResponse, logActivity } from '@/lib/api-utils'
import {
  getOpenBusinessDayWindow,
  nextBusinessDateString,
  readCurrentBusinessDateString,
  formatBusinessDateDisplay,
} from '@/lib/business-date'
import { buildDayCloseSnapshot } from '@/lib/day-close-snapshot'
import { buildDailySalesDetailReport } from '@/lib/daily-sales-report'
import {
  attachBalancesToSnapshot,
  computeDailySalesBalances,
  readDraftOpeningBalance,
  resolveSuggestedOpeningBalance,
  saveDraftOpeningBalance,
} from '@/lib/daily-sales-balance'

/** GET — day-close history or open-day status */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN', 'HOTEL_STAFF', 'HOTEL_FD')
    if (authResult instanceof Response) return authResult

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20')))

    const window = await getOpenBusinessDayWindow()
    const businessDate = window.businessDate
    const preview = await buildDayCloseSnapshot(businessDate, window.openedAt, new Date())
    const openingInfo = await resolveSuggestedOpeningBalance(businessDate)
    const savedOpeningBalance = await readDraftOpeningBalance(businessDate)

    const [history, total] = await Promise.all([
      db.dayClose.findMany({
        include: {
          closer: { select: { id: true, name: true, email: true } },
        },
        orderBy: { closedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.dayClose.count(),
    ])

    return successResponse({
      status: 'OPEN',
      businessDate,
      openedAt: window.openedAt.toISOString(),
      suggestedOpeningBalance: openingInfo.openingBalance,
      carriedOpeningBalance: openingInfo.carriedFromPreviousDay,
      hasOpeningOverride: openingInfo.hasDraftOverride,
      savedOpeningBalance,
      cashClosingBalancePreview: preview.cashClosingBalance ?? null,
      openPreview: preview,
      history,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Day close list error:', error)
    return errorResponse('Failed to load day close data', 500)
  }
}

/** POST — close current business day and advance to next */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN', 'HOTEL_STAFF', 'HOTEL_FD')
    if (authResult instanceof Response) return authResult

    const user = authResult
    const body = await request.json().catch(() => ({}))
    const notes = body.notes ? String(body.notes).trim() : null
    const openingBalanceInput =
      body.openingBalance !== undefined && body.openingBalance !== null
        ? Number(body.openingBalance)
        : null

    const businessDate = await readCurrentBusinessDateString()
    const existing = await db.dayClose.findUnique({ where: { businessDate } })
    if (existing) {
      return errorResponse(`Business day ${businessDate} is already closed`)
    }

    const { openedAt } = await getOpenBusinessDayWindow()
    const closedAt = new Date()
    const baseSnapshot = await buildDayCloseSnapshot(businessDate, openedAt, closedAt)

    const openingBalance =
      openingBalanceInput !== null && Number.isFinite(openingBalanceInput)
        ? Math.max(0, openingBalanceInput)
        : 0

    const dayWindow = {
      businessDate,
      businessDateDisplay: formatBusinessDateDisplay(businessDate),
      openedAt,
      closedAt,
    }
    const salesReport = await buildDailySalesDetailReport(dayWindow)
    const balances = computeDailySalesBalances(
      openingBalance,
      salesReport.balances.salesTotal,
      salesReport.balances.companyBillTotal
    )
    const snapshot = {
      ...attachBalancesToSnapshot(baseSnapshot, balances),
      cashReconciliation: salesReport.cashReconciliation,
      cashClosingBalance: salesReport.cashReconciliation.cashOnHand,
    }
    const nextDate = nextBusinessDateString(businessDate)
    const nextDayOpeningCash = salesReport.cashReconciliation.cashOnHand

    await db.$transaction(async (tx) => {
      await tx.dayClose.create({
        data: {
          businessDate,
          openedAt,
          closedAt,
          closedBy: user.id,
          snapshot,
          notes,
        },
      })
      await tx.setting.upsert({
        where: { key: 'current_business_date' },
        create: { key: 'current_business_date', value: nextDate, group: 'hotel' },
        update: { value: nextDate },
      })
      await tx.setting.deleteMany({
        where: { key: `opening_balance_${businessDate}` },
      })
    })

    await saveDraftOpeningBalance(nextDate, nextDayOpeningCash)

    await logActivity(
      user.id,
      'DAY_CLOSE',
      'billing',
      JSON.stringify({
        closedBusinessDate: businessDate,
        nextBusinessDate: nextDate,
        nextDayOpeningCash,
        snapshot,
      })
    )

    return successResponse(
      {
        closedBusinessDate: businessDate,
        nextBusinessDate: nextDate,
        nextDayOpeningCash,
        snapshot,
      },
      `Business day ${businessDate} closed. Now operating on ${nextDate}. Tomorrow's opening cash: ৳${nextDayOpeningCash.toLocaleString()}.`
    )
  } catch (error) {
    console.error('Day close error:', error)
    return errorResponse('Failed to close business day', 500)
  }
}

/** PATCH — save opening balance for the current open business day */
export async function PATCH(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN', 'HOTEL_STAFF', 'HOTEL_FD')
    if (authResult instanceof Response) return authResult

    const body = await request.json().catch(() => ({}))
    const amount = Math.max(0, Number(body.openingBalance) || 0)
    const businessDate = await readCurrentBusinessDateString()
    const existing = await db.dayClose.findUnique({ where: { businessDate } })
    if (existing) {
      return errorResponse(`Business day ${businessDate} is already closed`)
    }

    const saved = await saveDraftOpeningBalance(businessDate, amount)

    return successResponse(
      { businessDate, openingBalance: saved },
      'Opening balance saved'
    )
  } catch (error) {
    console.error('Opening balance save error:', error)
    return errorResponse('Failed to save opening balance', 500)
  }
}
