import { addDays, differenceInCalendarDays, format, isAfter, startOfDay } from 'date-fns'

export const DEFAULT_CHECK_IN_TIME = '14:00'
export const DEFAULT_CHECK_OUT_TIME = '12:00'

export type HotelTimes = {
  checkInTime: string
  checkOutTime: string
}

export const DEFAULT_HOTEL_TIMES: HotelTimes = {
  checkInTime: DEFAULT_CHECK_IN_TIME,
  checkOutTime: DEFAULT_CHECK_OUT_TIME,
}

/** Parse HH:mm or HH:mm:ss (24h). Returns null if invalid. */
export function parseTimeHHmm(value: string | null | undefined): { hours: number; minutes: number } | null {
  if (!value || typeof value !== 'string') return null
  const trimmed = value.trim()
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(trimmed)
  if (!match) return null
  const hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return { hours, minutes }
}

/** Value for HTML &lt;input type="time" /&gt; (always HH:mm). */
export function toTimeInputValue(
  value: string | null | undefined,
  fallback: string = DEFAULT_CHECK_IN_TIME
): string {
  return normalizeTimeHHmm(value, fallback)
}

export function normalizeTimeHHmm(
  value: string | null | undefined,
  fallback: string = DEFAULT_CHECK_IN_TIME
): string {
  const parsed = parseTimeHHmm(value)
  if (!parsed) return fallback
  return `${String(parsed.hours).padStart(2, '0')}:${String(parsed.minutes).padStart(2, '0')}`
}

/** Apply HH:mm to a calendar date (local timezone). */
export function applyHotelTimeToDate(date: Date, timeHHmm: string): Date {
  const parsed = parseTimeHHmm(timeHHmm) ?? parseTimeHHmm(DEFAULT_CHECK_IN_TIME)!
  const result = new Date(date)
  result.setHours(parsed.hours, parsed.minutes, 0, 0)
  return result
}

export function isDateOnlyInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
}

/** True when stored datetime has no meaningful time (legacy date-only rows). */
export function isDateOnlyBookingDatetime(date: Date): boolean {
  return date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0
}

/**
 * Normalize booking check-in/out from API input (yyyy-MM-dd or ISO) using hotel times.
 */
export function applyHotelTimeToBookingInput(
  input: string | Date,
  timeHHmm: string
): Date {
  if (typeof input === 'string' && isDateOnlyInput(input)) {
    const base = new Date(`${input.trim()}T12:00:00`)
    return applyHotelTimeToDate(startOfDay(base), timeHHmm)
  }

  const date = typeof input === 'string' ? new Date(input) : new Date(input.getTime())
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date')
  }

  if (isDateOnlyBookingDatetime(date)) {
    return applyHotelTimeToDate(startOfDay(date), timeHHmm)
  }

  return date
}

/**
 * Hotel nights: arrival day (check-in time) → departure day (check-out time).
 * Example: May 19 @ 2:00 PM → May 20 @ 12:00 PM = 1 night.
 */
export function countHotelStayNights(checkIn: Date, checkOut: Date): number {
  if (checkOut <= checkIn) return 0
  const nights = differenceInCalendarDays(startOfDay(checkOut), startOfDay(checkIn))
  return Math.max(1, nights)
}

/** @deprecated Use countHotelStayNights */
export function countBookedNightsWithTimes(checkIn: Date, checkOut: Date): number {
  return countHotelStayNights(checkIn, checkOut)
}

export function datePickerValue(date: Date): string {
  return format(startOfDay(date), 'yyyy-MM-dd')
}

/** Checkout date picker must be at least the day after check-in date. */
export function minCheckoutDatePickerValue(checkInDate: string): string | undefined {
  if (!isDateOnlyInput(checkInDate)) return undefined
  const base = new Date(`${checkInDate.trim()}T12:00:00`)
  if (Number.isNaN(base.getTime())) return undefined
  return datePickerValue(addDays(startOfDay(base), 1))
}

export function isStayDatePickerRangeValid(checkInDate: string, checkOutDate: string): boolean {
  if (!isDateOnlyInput(checkInDate) || !isDateOnlyInput(checkOutDate)) return false
  const inDay = startOfDay(new Date(`${checkInDate.trim()}T12:00:00`))
  const outDay = startOfDay(new Date(`${checkOutDate.trim()}T12:00:00`))
  return isAfter(outDay, inDay)
}

export type ResolvedHotelStay = {
  checkInDate: string
  checkOutDate: string
  checkIn: Date
  checkOut: Date
  nights: number
}

/** Apply configured check-in / check-out times to reservation date pickers. */
export function resolveStayFromDatePickers(
  checkInDate: string,
  checkOutDate: string,
  times: HotelTimes = DEFAULT_HOTEL_TIMES
): ResolvedHotelStay {
  if (!isStayDatePickerRangeValid(checkInDate, checkOutDate)) {
    throw new Error('Check-out date must be at least the day after check-in')
  }

  const checkIn = applyHotelTimeToBookingInput(checkInDate, times.checkInTime)
  const checkOut = applyHotelTimeToBookingInput(checkOutDate, times.checkOutTime)

  if (checkOut <= checkIn) {
    throw new Error('Check-out must be after check-in (see hotel check-in/out times in settings)')
  }

  return {
    checkInDate: checkInDate.trim(),
    checkOutDate: checkOutDate.trim(),
    checkIn,
    checkOut,
    nights: countHotelStayNights(checkIn, checkOut),
  }
}

/**
 * Walk-in / check-in now: guest stays until tomorrow at configured checkout time.
 * Stored check-in is the current moment; checkout is next calendar day at checkout time.
 */
export function buildWalkInStay(
  now: Date = new Date(),
  times: HotelTimes = DEFAULT_HOTEL_TIMES
): ResolvedHotelStay {
  const arrivalDay = startOfDay(now)
  const departureDay = addDays(arrivalDay, 1)
  const checkOut = applyHotelTimeToDate(departureDay, times.checkOutTime)

  return {
    checkInDate: datePickerValue(arrivalDay),
    checkOutDate: datePickerValue(departureDay),
    checkIn: now,
    checkOut,
    nights: countHotelStayNights(now, checkOut),
  }
}

export function describeStayPeriod(times: HotelTimes = DEFAULT_HOTEL_TIMES): string {
  return `Arrival day from ${formatTime12h(times.checkInTime)}; departure day by ${formatTime12h(times.checkOutTime)} (e.g. check in today → check out tomorrow at ${formatTime12h(times.checkOutTime)}).`
}

export function formatTime12h(timeHHmm: string): string {
  const parsed = parseTimeHHmm(timeHHmm)
  if (!parsed) return timeHHmm
  const period = parsed.hours >= 12 ? 'PM' : 'AM'
  const hour12 = parsed.hours % 12 || 12
  const minutes = parsed.minutes > 0 ? `:${String(parsed.minutes).padStart(2, '0')}` : ''
  return `${hour12}${minutes} ${period}`
}

export function buildCheckInOutPolicyText(times: HotelTimes = DEFAULT_HOTEL_TIMES): string {
  return `Check-in ${formatTime12h(times.checkInTime)}, check-out ${formatTime12h(times.checkOutTime)}. Early/late times subject to availability and extra charges.`
}

function displayDatetime(value: string | Date, timeHHmm: string): Date {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return date
  if (isDateOnlyBookingDatetime(date)) {
    return applyHotelTimeToDate(startOfDay(date), timeHHmm)
  }
  return date
}

/** Date-only label for reservation confirm step and similar (no check-in/out time). */
export function formatBookingDateOnly(value: string | Date): string {
  let date: Date
  if (typeof value === 'string') {
    const trimmed = value.trim()
    date = trimmed.includes('T') ? new Date(trimmed) : new Date(`${trimmed}T12:00:00`)
  } else {
    date = value
  }
  if (Number.isNaN(date.getTime())) return '—'
  return format(date, 'MMM dd, yyyy')
}

/** Format stored datetime; applies hotel policy time only for legacy date-only (midnight) values. */
export function formatBookingDatetime(
  value: string | Date,
  fallbackTimeHHmm?: string,
  compact = false
): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  const d =
    fallbackTimeHHmm && isDateOnlyBookingDatetime(date)
      ? applyHotelTimeToDate(startOfDay(date), fallbackTimeHHmm)
      : date
  return format(d, compact ? 'dd/MM/yy · h:mm a' : 'MMM dd, yyyy · h:mm a')
}

export type BookingListDatetimeFields = {
  checkIn: string | Date
  checkOut: string | Date
  actualCheckIn?: string | Date | null
  actualCheckOut?: string | Date | null
  status: string
}

export function formatListBookingCheckIn(
  booking: BookingListDatetimeFields,
  times: HotelTimes = DEFAULT_HOTEL_TIMES,
  compact = false
): string {
  if (
    booking.actualCheckIn &&
    (booking.status === 'CHECKED_IN' || booking.status === 'CHECKED_OUT')
  ) {
    return formatBookingDatetime(booking.actualCheckIn, undefined, compact)
  }
  return formatBookingDatetime(booking.checkIn, times.checkInTime, compact)
}

export function formatListBookingCheckOut(
  booking: BookingListDatetimeFields,
  times: HotelTimes = DEFAULT_HOTEL_TIMES,
  compact = false
): string {
  if (booking.actualCheckOut && booking.status === 'CHECKED_OUT') {
    return formatBookingDatetime(booking.actualCheckOut, undefined, compact)
  }
  return formatBookingDatetime(booking.checkOut, times.checkOutTime, compact)
}

export type BookingDatetimeParts = {
  date: string
  time: string
}

function resolveListBookingDatetime(
  value: string | Date,
  fallbackTimeHHmm?: string
): Date | null {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return null
  if (fallbackTimeHHmm && isDateOnlyBookingDatetime(date)) {
    return applyHotelTimeToDate(startOfDay(date), fallbackTimeHHmm)
  }
  return date
}

function splitBookingDatetimeParts(
  value: string | Date,
  fallbackTimeHHmm?: string,
  compact = false
): BookingDatetimeParts {
  const resolved = resolveListBookingDatetime(value, fallbackTimeHHmm)
  if (!resolved) {
    return { date: '—', time: '—' }
  }
  return {
    date: format(resolved, compact ? 'dd/MM/yyyy' : 'dd MMM yyyy'),
    time: format(resolved, 'h:mm a'),
  }
}

export function getListBookingCheckInParts(
  booking: BookingListDatetimeFields,
  times: HotelTimes = DEFAULT_HOTEL_TIMES,
  compact = false
): BookingDatetimeParts {
  if (
    booking.actualCheckIn &&
    (booking.status === 'CHECKED_IN' || booking.status === 'CHECKED_OUT')
  ) {
    return splitBookingDatetimeParts(booking.actualCheckIn, undefined, compact)
  }
  return splitBookingDatetimeParts(booking.checkIn, times.checkInTime, compact)
}

export function getListBookingCheckOutParts(
  booking: BookingListDatetimeFields,
  times: HotelTimes = DEFAULT_HOTEL_TIMES,
  compact = false
): BookingDatetimeParts {
  if (booking.actualCheckOut && booking.status === 'CHECKED_OUT') {
    return splitBookingDatetimeParts(booking.actualCheckOut, undefined, compact)
  }
  return splitBookingDatetimeParts(booking.checkOut, times.checkOutTime, compact)
}

export function formatBookingCheckIn(
  value: string | Date,
  times: HotelTimes = DEFAULT_HOTEL_TIMES
): string {
  const d = displayDatetime(value, times.checkInTime)
  return format(d, 'MMM dd, yyyy · h:mm a')
}

export function formatBookingCheckOut(
  value: string | Date,
  times: HotelTimes = DEFAULT_HOTEL_TIMES
): string {
  const d = displayDatetime(value, times.checkOutTime)
  return format(d, 'MMM dd, yyyy · h:mm a')
}

export function formatBookingCheckInShort(
  value: string | Date,
  times: HotelTimes = DEFAULT_HOTEL_TIMES
): string {
  const d = displayDatetime(value, times.checkInTime)
  return format(d, 'dd-MMM-yyyy · h:mm a')
}

export function formatBookingCheckOutShort(
  value: string | Date,
  times: HotelTimes = DEFAULT_HOTEL_TIMES
): string {
  const d = displayDatetime(value, times.checkOutTime)
  return format(d, 'dd-MMM-yyyy · h:mm a')
}

export function combineDateAndTime(dateYYYYMMDD: string, timeHHmm: string): Date {
  if (!isDateOnlyInput(dateYYYYMMDD)) {
    throw new Error('Invalid date')
  }
  const parsed = parseTimeHHmm(timeHHmm) ?? parseTimeHHmm(DEFAULT_CHECK_IN_TIME)!
  const base = new Date(`${dateYYYYMMDD.trim()}T12:00:00`)
  if (Number.isNaN(base.getTime())) {
    throw new Error('Invalid date')
  }
  const normalizedTime = `${String(parsed.hours).padStart(2, '0')}:${String(parsed.minutes).padStart(2, '0')}`
  return applyHotelTimeToDate(startOfDay(base), normalizedTime)
}

export function splitDateAndTime(
  value: string | Date,
  fallbackTimeHHmm: string
): { date: string; time: string } {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) {
    return { date: '', time: normalizeTimeHHmm(fallbackTimeHHmm) }
  }
  const resolved =
    isDateOnlyBookingDatetime(date)
      ? applyHotelTimeToDate(startOfDay(date), fallbackTimeHHmm)
      : date
  return {
    date: format(startOfDay(resolved), 'yyyy-MM-dd'),
    time: `${String(resolved.getHours()).padStart(2, '0')}:${String(resolved.getMinutes()).padStart(2, '0')}`,
  }
}

export function isStayDatetimeRangeValid(checkIn: Date, checkOut: Date): boolean {
  return checkOut > checkIn
}

export function checkoutHourFromTime(timeHHmm: string): number {
  const parsed = parseTimeHHmm(timeHHmm)
  return parsed?.hours ?? 12
}
