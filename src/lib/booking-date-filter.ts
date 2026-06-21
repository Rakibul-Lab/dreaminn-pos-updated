import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
} from 'date-fns'

export type BookingDatePreset =
  | 'all'
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | 'this_year'
  | 'custom'

export const BOOKING_DATE_PRESET_OPTIONS: { value: BookingDatePreset; label: string }[] = [
  { value: 'today', label: 'Business today (in-house + arrivals)' },
  { value: 'all', label: 'All dates' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'this_year', label: 'This year' },
  { value: 'custom', label: 'Custom range' },
]

/** Resolve date filters using the hotel business date as "today" when provided. */
export function resolveBookingDateRangeWithBusinessDate(
  preset: BookingDatePreset,
  customFrom?: string,
  customTo?: string,
  businessDate?: string
): { dateFrom?: string; dateTo?: string } {
  if (businessDate) {
    if (preset === 'today') {
      return { dateFrom: businessDate, dateTo: businessDate }
    }
    if (preset === 'yesterday') {
      const prev = format(subDays(parseISO(`${businessDate}T12:00:00`), 1), 'yyyy-MM-dd')
      return { dateFrom: prev, dateTo: prev }
    }
    const now = parseISO(`${businessDate}T12:00:00`)
    return resolveBookingDateRange(preset, customFrom, customTo, now)
  }
  return resolveBookingDateRange(preset, customFrom, customTo)
}

export function resolveBookingDateRange(
  preset: BookingDatePreset,
  customFrom?: string,
  customTo?: string,
  now: Date = new Date()
): { dateFrom?: string; dateTo?: string } {
  if (preset === 'all') return {}

  const toDateStr = (d: Date) => format(d, 'yyyy-MM-dd')

  switch (preset) {
    case 'today':
      return { dateFrom: toDateStr(startOfDay(now)), dateTo: toDateStr(endOfDay(now)) }
    case 'yesterday': {
      const day = subDays(now, 1)
      return { dateFrom: toDateStr(startOfDay(day)), dateTo: toDateStr(endOfDay(day)) }
    }
    case 'this_week':
      return {
        dateFrom: toDateStr(startOfWeek(now, { weekStartsOn: 1 })),
        dateTo: toDateStr(endOfWeek(now, { weekStartsOn: 1 })),
      }
    case 'this_month':
      return { dateFrom: toDateStr(startOfMonth(now)), dateTo: toDateStr(endOfMonth(now)) }
    case 'this_year':
      return { dateFrom: toDateStr(startOfYear(now)), dateTo: toDateStr(endOfYear(now)) }
    case 'custom':
      if (!customFrom && !customTo) return {}
      return {
        ...(customFrom ? { dateFrom: customFrom } : {}),
        ...(customTo ? { dateTo: customTo } : {}),
      }
    default:
      return {}
  }
}

function formatFilterDate(value: string): string {
  const parsed = new Date(`${value.trim()}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return format(parsed, 'dd MMM yyyy')
}

export function formatBookingDateFilterLabel(
  preset: BookingDatePreset,
  customFrom?: string,
  customTo?: string
): string {
  if (preset === 'all') return 'All dates'

  if (preset === 'custom') {
    if (customFrom || customTo) {
      const from = customFrom ? formatFilterDate(customFrom) : '…'
      const to = customTo ? formatFilterDate(customTo) : '…'
      return `Custom range (${from} to ${to})`
    }
    return 'Custom range'
  }

  return BOOKING_DATE_PRESET_OPTIONS.find((o) => o.value === preset)?.label ?? 'All dates'
}

const BOOKING_STATUS_FILTER_LABELS: Record<string, string> = {
  RESERVED: 'Reserved',
  CHECKED_IN: 'Checked In',
  CHECKED_OUT: 'Checked Out',
  CANCELLED: 'Cancelled',
  COMPANY: 'Company',
}

export function formatBookingStatusFilterLabel(status: string): string {
  if (!status || status === 'all') return 'All status'
  return BOOKING_STATUS_FILTER_LABELS[status] ?? status.replace(/_/g, ' ')
}

export type BookingsExportFilterLabels = {
  date: string
  status: string
  search: string
}

export function buildBookingsExportFilterLabels(input: {
  datePreset: BookingDatePreset
  customDateFrom?: string
  customDateTo?: string
  status?: string
  search?: string
}): BookingsExportFilterLabels {
  return {
    date: formatBookingDateFilterLabel(
      input.datePreset,
      input.customDateFrom,
      input.customDateTo
    ),
    status: formatBookingStatusFilterLabel(input.status ?? 'all'),
    search: input.search?.trim() ? input.search.trim() : '—',
  }
}

export function formatGuestListReportTitle(
  preset: BookingDatePreset,
  customFrom?: string,
  customTo?: string
): string {
  if (preset === 'all') return 'Guest List Report'

  if (preset === 'custom') {
    const range = formatBookingDateFilterLabel(preset, customFrom, customTo)
    return `${range} Guest List Report`
  }

  const label = BOOKING_DATE_PRESET_OPTIONS.find((o) => o.value === preset)?.label ?? ''
  return `${label} Guest List Report`
}

export type GuestsExportFilterLabels = {
  date: string
  search: string
  reportTitle: string
}

export function buildGuestsExportFilterLabels(input: {
  datePreset: BookingDatePreset
  customDateFrom?: string
  customDateTo?: string
  search?: string
}): GuestsExportFilterLabels {
  return {
    date: formatBookingDateFilterLabel(
      input.datePreset,
      input.customDateFrom,
      input.customDateTo
    ),
    search: input.search?.trim() ? input.search.trim() : '—',
    reportTitle: formatGuestListReportTitle(
      input.datePreset,
      input.customDateFrom,
      input.customDateTo
    ),
  }
}
