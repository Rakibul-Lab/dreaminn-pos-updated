import { addDays, format, parseISO } from 'date-fns'
import type { Prisma } from '@prisma/client'
import { isValidBusinessDateString, getCalendarDayBounds } from '@/lib/business-date'
import { resolveBusinessDayReportWindow } from '@/lib/hotel-pms-reports'

/** Filter beverage sales by business day window(s), not calendar midnight bounds. */
export async function buildHotelBeverageSalesBusinessDayWhere(
  dateFrom?: string | null,
  dateTo?: string | null
): Promise<Prisma.HotelBeverageSaleWhereInput | null> {
  if (!dateFrom && !dateTo) return null

  const from = (dateFrom ?? dateTo)!.trim()
  const to = (dateTo ?? dateFrom)!.trim()
  if (!isValidBusinessDateString(from) || !isValidBusinessDateString(to)) {
    return buildCalendarCreatedAtWhere(from, to)
  }

  const clauses: Prisma.HotelBeverageSaleWhereInput[] = []
  let day = from
  while (day <= to) {
    const window = await resolveBusinessDayReportWindow(day)
    clauses.push({
      createdAt: { gte: window.openedAt, lte: window.closedAt },
    })
    if (day === to) break
    day = format(addDays(parseISO(`${day}T12:00:00`), 1), 'yyyy-MM-dd')
  }

  if (clauses.length === 0) return null
  return clauses.length === 1 ? clauses[0]! : { OR: clauses }
}

function buildCalendarCreatedAtWhere(
  dateFrom: string,
  dateTo: string
): Prisma.HotelBeverageSaleWhereInput | null {
  const and: Prisma.HotelBeverageSaleWhereInput[] = []
  if (isValidBusinessDateString(dateFrom)) {
    const { start } = getCalendarDayBounds(dateFrom)
    and.push({ createdAt: { gte: start } })
  }
  if (isValidBusinessDateString(dateTo)) {
    const { end } = getCalendarDayBounds(dateTo)
    and.push({ createdAt: { lte: end } })
  }
  if (!and.length) return null
  return and.length === 1 ? and[0]! : { AND: and }
}
