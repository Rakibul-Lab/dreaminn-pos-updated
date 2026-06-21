import { addDays, format, parseISO } from 'date-fns'
import { minCheckoutDatePickerValue } from '@/lib/hotel-times'

export type RoomsViewDateScope = 'business_day' | 'all_day' | 'custom'

export const ROOMS_VIEW_DATE_OPTIONS: { value: RoomsViewDateScope; label: string }[] = [
  { value: 'business_day', label: 'Business day' },
  { value: 'all_day', label: 'All day' },
  { value: 'custom', label: 'Custom range' },
]

function formatFilterDate(value: string): string {
  const parsed = parseISO(`${value.trim()}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return format(parsed, 'dd MMM yyyy')
}

export function formatRoomsViewDateLabel(
  scope: RoomsViewDateScope,
  businessDate?: string,
  customFrom?: string,
  customTo?: string
): string {
  if (scope === 'all_day') {
    return `All day (${formatFilterDate(format(new Date(), 'yyyy-MM-dd'))})`
  }
  if (scope === 'custom') {
    if (customFrom || customTo) {
      const from = customFrom ? formatFilterDate(customFrom) : '…'
      const to = customTo ? formatFilterDate(customTo) : '…'
      return `Custom range (${from} to ${to})`
    }
    return 'Custom range'
  }
  return businessDate
    ? `Business day (${formatFilterDate(businessDate)})`
    : 'Business day'
}

export function resolveRoomsViewContext(
  scope: RoomsViewDateScope,
  businessDate: string,
  customFrom?: string,
  customTo?: string
): {
  referenceDate: string
  stayCheckIn: string
  stayCheckOut: string
  arrivalCutoff: string
} {
  if (scope === 'custom') {
    const stayCheckIn = customFrom?.trim() || businessDate
    const rangeEnd = customTo?.trim() || stayCheckIn
    const stayCheckOut =
      rangeEnd === stayCheckIn
        ? minCheckoutDatePickerValue(stayCheckIn) ?? stayCheckIn
        : format(addDays(parseISO(`${rangeEnd}T12:00:00`), 1), 'yyyy-MM-dd')
    return {
      referenceDate: stayCheckIn,
      stayCheckIn,
      stayCheckOut,
      arrivalCutoff: rangeEnd,
    }
  }

  if (scope === 'all_day') {
    const today = format(new Date(), 'yyyy-MM-dd')
    return {
      referenceDate: today,
      stayCheckIn: today,
      stayCheckOut: minCheckoutDatePickerValue(today) ?? today,
      arrivalCutoff: today,
    }
  }

  return {
    referenceDate: businessDate,
    stayCheckIn: businessDate,
    stayCheckOut: minCheckoutDatePickerValue(businessDate) ?? businessDate,
    arrivalCutoff: businessDate,
  }
}
