import { format, parseISO, startOfDay } from 'date-fns'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export function formatBusinessDate(date: Date = new Date()): string {
  return format(startOfDay(date), 'yyyy-MM-dd')
}

export function isValidBusinessDateString(value: string | null | undefined): boolean {
  if (!value || !DATE_ONLY.test(value.trim())) return false
  const parsed = parseISO(`${value.trim()}T12:00:00`)
  return !Number.isNaN(parsed.getTime())
}

export function parseBusinessDateString(value: string): Date {
  if (!isValidBusinessDateString(value)) {
    throw new Error('Invalid business date')
  }
  return parseISO(`${value.trim()}T12:00:00`)
}

export function formatBusinessDateDisplay(value: string): string {
  try {
    return format(parseBusinessDateString(value), 'dd/MM/yyyy')
  } catch {
    return value
  }
}
