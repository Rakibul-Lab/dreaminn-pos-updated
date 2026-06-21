import type { Prisma } from '@prisma/client'
import {
  formatBookingDateFilterLabel,
  resolveBookingDateRangeWithBusinessDate,
  type BookingDatePreset,
} from '@/lib/booking-date-filter'

export type BeverageSalesListFilters = {
  saleType?: string | null
  search?: string | null
  dateFrom?: string | null
  dateTo?: string | null
}

/** Sale type + search only — date filtering uses business day windows on the API. */
export function buildHotelBeverageSalesWhere(
  filters: Omit<BeverageSalesListFilters, 'dateFrom' | 'dateTo'>
): Prisma.HotelBeverageSaleWhereInput {
  const and: Prisma.HotelBeverageSaleWhereInput[] = []

  if (filters.saleType === 'WALK_IN' || filters.saleType === 'ROOM') {
    and.push({ saleType: filters.saleType })
  }

  const search = filters.search?.trim()
  if (search) {
    and.push({
      OR: [
        { saleNumber: { contains: search } },
        { customerName: { contains: search } },
        { customerPhone: { contains: search } },
        { notes: { contains: search } },
        { room: { roomNumber: { contains: search } } },
        { creator: { name: { contains: search } } },
        { items: { some: { itemName: { contains: search } } } },
      ],
    })
  }

  return and.length ? { AND: and } : {}
}

export function resolveBeverageSalesDateRange(
  preset: BookingDatePreset,
  customFrom?: string,
  customTo?: string,
  businessDate?: string
): { dateFrom?: string; dateTo?: string } {
  return resolveBookingDateRangeWithBusinessDate(preset, customFrom, customTo, businessDate)
}

export function buildBeverageSalesFilterLabels(input: {
  datePreset: BookingDatePreset
  customDateFrom?: string
  customDateTo?: string
  saleType?: string
  search?: string
  businessDate?: string
}): {
  date: string
  type: string
  search: string
} {
  const date =
    input.datePreset === 'today' && input.businessDate
      ? `Business today (${input.businessDate})`
      : input.datePreset === 'yesterday' && input.businessDate
        ? (() => {
            const range = resolveBeverageSalesDateRange(
              'yesterday',
              undefined,
              undefined,
              input.businessDate
            )
            return range.dateFrom ? `Yesterday (${range.dateFrom})` : 'Yesterday'
          })()
        : formatBookingDateFilterLabel(
            input.datePreset,
            input.customDateFrom,
            input.customDateTo
          )

  return {
    date,
    type:
      input.saleType === 'WALK_IN'
        ? 'Walk-in only'
        : input.saleType === 'ROOM'
          ? 'Room charge only'
          : 'All types',
    search: input.search?.trim() || '—',
  }
}

export function buildBeverageSalesListQuery(
  filters: BeverageSalesListFilters & { page?: number; limit?: number }
): string {
  const params = new URLSearchParams()
  params.set('page', String(filters.page ?? 1))
  params.set('limit', String(filters.limit ?? 25))
  if (filters.saleType && filters.saleType !== 'all') {
    params.set('saleType', filters.saleType)
  }
  if (filters.search?.trim()) params.set('search', filters.search.trim())
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  return `/hotel-beverage-sales?${params.toString()}`
}

export function buildBeverageSalesExportQuery(filters: BeverageSalesListFilters): string {
  return buildBeverageSalesListQuery({ ...filters, page: 1, limit: 5000 })
}
