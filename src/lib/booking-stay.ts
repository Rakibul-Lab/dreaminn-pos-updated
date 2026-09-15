import {
  addDays,
  differenceInCalendarDays,
  isAfter,
  isBefore,
  isSameDay,
  startOfDay,
} from 'date-fns'
import {
  countHotelStayNights,
  resolveEffectiveStayArrivalDay,
  resolveEffectiveStayArrivalForNights,
} from '@/lib/hotel-times'

/** Nights between reservation check-in and check-out (hotel departure − arrival days). */
export function countBookedNights(checkIn: Date, checkOut: Date): number {
  return countHotelStayNights(checkIn, checkOut)
}

/**
 * Nights from effective arrival through as-of date (minimum 1).
 * Extra nights beyond the reserved stay are added on business-day close.
 */
export function countActualStayNights(
  actualCheckIn: Date,
  checkoutAt: Date = new Date(),
  scheduledCheckIn?: Date | null
): number {
  const arrival = resolveEffectiveStayArrivalForNights(
    scheduledCheckIn ?? actualCheckIn,
    actualCheckIn
  )
  return countHotelStayNights(arrival, checkoutAt)
}

export type StayAdjustmentMode = 'shrink' | 'extend'

/**
 * Chargeable nights when adjusting stay at checkout.
 * Shrink: fewer nights than booked (early departure). Extend: more nights than booked.
 */
export function resolveChargeableNights(
  bookedNights: number,
  requestedNights: number,
  mode: StayAdjustmentMode = 'shrink'
): number {
  const booked = Math.max(1, bookedNights)
  const requested = Math.max(1, Math.round(requestedNights))
  if (!Number.isFinite(requested)) return booked
  if (mode === 'extend') return Math.max(requested, booked)
  return Math.min(requested, booked)
}

export function defaultChargeableNightsForMode(
  bookedNights: number,
  actualStayNights: number,
  mode: StayAdjustmentMode
): number {
  const booked = Math.max(1, bookedNights)
  const actual = Math.max(1, actualStayNights)
  if (mode === 'extend') return Math.max(booked, actual)
  return Math.min(booked, actual)
}

export function computeAdjustedRoomCharge(nightlyRate: number, chargeableNights: number): number {
  return Math.max(0, nightlyRate) * Math.max(1, chargeableNights)
}

/** yyyy-MM-dd for &lt;input type="date" /&gt; */
export function toDateInputValue(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseDateInputValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed)
}

/** Whether guest can still leave before the scheduled checkout day. */
export function getStayAdjustmentAvailability(
  checkIn: Date,
  checkOut: Date,
  asOf: Date = new Date(),
  actualCheckIn?: Date | null
) {
  const today = startOfDay(asOf)
  const scheduledOutDay = startOfDay(checkOut)
  const actual = actualCheckIn ?? checkIn

  const minDeparture = minEarlyDepartureDate(actual, checkIn)
  const maxDeparture = maxEarlyDepartureDate(checkOut)
  const hasEarlyDepartureWindow = !isBefore(maxDeparture, minDeparture)

  let canEarlyDeparture = isBefore(asOf, checkOut) && hasEarlyDepartureWindow
  let earlyDepartureDisabledReason: string | null = null

  if (!hasEarlyDepartureWindow) {
    canEarlyDeparture = false
    earlyDepartureDisabledReason =
      'Early departure is not available for a one-night (or same-day) reservation.'
  } else if (!canEarlyDeparture) {
    if (isSameDay(today, scheduledOutDay)) {
      earlyDepartureDisabledReason =
        'Guest is on the scheduled checkout day — use Check-out instead of early departure.'
    } else if (isAfter(today, scheduledOutDay)) {
      earlyDepartureDisabledReason = 'The reserved stay period has already ended.'
    } else {
      earlyDepartureDisabledReason = 'Early departure is not available for this stay.'
    }
  }

  const canExtend = !isAfter(asOf, checkOut)
  let extendDisabledReason: string | null = null
  if (!canExtend) {
    extendDisabledReason =
      'The reserved stay period has ended — extend stay is no longer available. Use Check-out if the guest has left.'
  }

  return { canEarlyDeparture, earlyDepartureDisabledReason, canExtend, extendDisabledReason }
}

/** Latest calendar date for early departure (day before scheduled checkout). */
export function maxEarlyDepartureDate(checkOut: Date): Date {
  return addDays(startOfDay(checkOut), -1)
}

/** Earliest departure date that charges at least one night after actual check-in. */
export function minEarlyDepartureDate(actualCheckIn: Date, checkIn: Date): Date {
  const base = resolveEffectiveStayArrivalDay(checkIn, actualCheckIn)
  return addDays(base, 1)
}

/** First checkout date that extends beyond the reservation. */
export function minExtendedCheckoutDate(checkOut: Date): Date {
  return addDays(startOfDay(checkOut), 1)
}

export function chargeableNightsForDepartureDate(
  actualCheckIn: Date,
  departureDate: Date,
  scheduledCheckIn?: Date | null
): number {
  const arrivalDay = resolveEffectiveStayArrivalDay(
    scheduledCheckIn ?? actualCheckIn,
    actualCheckIn
  )
  return Math.max(1, differenceInCalendarDays(startOfDay(departureDate), arrivalDay))
}

export function chargeableNightsForExtendedCheckout(
  checkIn: Date,
  extendedCheckOut: Date
): number {
  return countBookedNights(checkIn, extendedCheckOut)
}
