import { bookingVatOptions, computeRoomBookingTotals, sumBookingNetPaid } from '@/lib/booking-totals'
import {
  computeAdjustedRoomCharge,
  countActualStayNights,
  countBookedNights,
  chargeableNightsForDepartureDate,
  chargeableNightsForExtendedCheckout,
  getStayAdjustmentAvailability,
  maxEarlyDepartureDate,
  minEarlyDepartureDate,
  minExtendedCheckoutDate,
  parseDateInputValue,
  toDateInputValue,
  type StayAdjustmentMode,
} from '@/lib/booking-stay'
import { isBefore, startOfDay } from 'date-fns'

export type EarlyCheckoutFeeMode = 'percent' | 'amount'

export type StayAdjustmentInput = {
  stayMode: StayAdjustmentMode
  /** yyyy-MM-dd — departure date (early) or extended checkout date (extend) */
  chargeableUntilDate: string
  earlyCheckoutEnabled: boolean
  earlyCheckoutMode: EarlyCheckoutFeeMode
  earlyCheckoutPercent: number
  earlyCheckoutAmount: number
}

export function computeEarlyCheckoutFee(
  waivedNights: number,
  nightlyRate: number,
  mode: EarlyCheckoutFeeMode,
  percent: number,
  amount: number
): number {
  if (waivedNights <= 0) return 0
  if (mode === 'percent') {
    const base = waivedNights * nightlyRate
    const pct = Math.min(100, Math.max(0, percent))
    return Math.round(((base * pct) / 100) * 100) / 100
  }
  return Math.max(0, amount)
}

export type StayAdjustmentPreviewParams = {
  checkIn: Date
  checkOut: Date
  actualCheckIn: Date | null
  vatApplied?: boolean | null
  vatPercent?: number | null
  nightlyRate: number
  payments: { amount: number; paymentType: string }[]
  settings: StayAdjustmentInput
  asOf?: Date
}

export type StayAdjustmentPreview = {
  bookedNights: number
  actualStayNights: number
  chargeableNights: number
  waivedNights: number
  stayMode: StayAdjustmentMode
  chargeableUntilDate: string
  scheduledCheckIn: string
  scheduledCheckOut: string
  canEarlyDeparture: boolean
  earlyDepartureDisabledReason: string | null
  canExtend: boolean
  extendDisabledReason: string | null
  minDepartureDate: string
  maxDepartureDate: string
  minExtendDate: string
  nightlyRate: number
  bookedRoomCharge: number
  roomCharge: number
  earlyCheckoutFee: number
  roomSubtotal: number
  vatPercent: number
  vatApplied: boolean
  vatAmount: number
  totalWithVat: number
  totalPaid: number
  dueAmount: number
  isEarlyDeparture: boolean
}

function resolveChargeableNightsFromDate(
  checkIn: Date,
  checkOut: Date,
  actualCheckIn: Date,
  settings: StayAdjustmentInput
): { nights: number; until: Date } | { error: string } {
  const until = parseDateInputValue(settings.chargeableUntilDate)
  if (!until) return { error: 'Invalid date' }

  if (settings.stayMode === 'shrink') {
    const min = minEarlyDepartureDate(actualCheckIn, checkIn)
    const max = maxEarlyDepartureDate(checkOut)
    if (isBefore(until, min) || isBefore(max, until)) {
      return { error: 'Departure date must be within the early-checkout window' }
    }
    return {
      nights: chargeableNightsForDepartureDate(actualCheckIn, until, checkIn),
      until,
    }
  }

  const minExtend = minExtendedCheckoutDate(checkOut)
  if (isBefore(until, minExtend)) {
    return { error: 'Extended checkout must be after the reserved checkout date' }
  }
  return {
    nights: chargeableNightsForExtendedCheckout(checkIn, until),
    until,
  }
}

export function defaultChargeableUntilDate(
  checkIn: Date,
  checkOut: Date,
  actualCheckIn: Date | null,
  mode: StayAdjustmentMode,
  asOf: Date = new Date()
): string {
  const actual = actualCheckIn ?? checkIn
  if (mode === 'extend') {
    return toDateInputValue(minExtendedCheckoutDate(checkOut))
  }
  const today = startOfDay(asOf)
  const max = maxEarlyDepartureDate(checkOut)
  const min = minEarlyDepartureDate(actual, checkIn)
  if (!isBefore(asOf, checkOut) || isBefore(max, min)) {
    return toDateInputValue(max)
  }
  if (!isBefore(today, min) && !isBefore(max, today)) {
    return toDateInputValue(today)
  }
  return toDateInputValue(max)
}

export function computeStayAdjustmentPreview(
  params: StayAdjustmentPreviewParams
): StayAdjustmentPreview | { error: string } {
  const asOf = params.asOf ?? new Date()
  const bookedNights = countBookedNights(params.checkIn, params.checkOut)
  const actualCheckIn = params.actualCheckIn ?? params.checkIn
  const actualStayNights = countActualStayNights(
    actualCheckIn,
    asOf,
    params.checkIn
  )
  const nightlyRate = params.nightlyRate
  const availability = getStayAdjustmentAvailability(
    params.checkIn,
    params.checkOut,
    asOf,
    params.actualCheckIn
  )

  if (params.settings.stayMode === 'shrink' && !availability.canEarlyDeparture) {
    return { error: availability.earlyDepartureDisabledReason ?? 'Early departure not available' }
  }

  if (params.settings.stayMode === 'extend' && !availability.canExtend) {
    return { error: availability.extendDisabledReason ?? 'Extend stay not available' }
  }

  const resolved = resolveChargeableNightsFromDate(
    params.checkIn,
    params.checkOut,
    actualCheckIn,
    params.settings
  )
  if ('error' in resolved) return { error: resolved.error }

  const chargeableNights = resolved.nights
  const waivedNights = Math.max(0, bookedNights - chargeableNights)
  const isEarlyDeparture = params.settings.stayMode === 'shrink' && waivedNights > 0

  const roomCharge = computeAdjustedRoomCharge(nightlyRate, chargeableNights)
  const bookedRoomCharge = computeAdjustedRoomCharge(nightlyRate, bookedNights)

  const earlyCheckoutFee =
    isEarlyDeparture && params.settings.earlyCheckoutEnabled
      ? computeEarlyCheckoutFee(
          waivedNights,
          nightlyRate,
          params.settings.earlyCheckoutMode,
          params.settings.earlyCheckoutPercent,
          params.settings.earlyCheckoutAmount
        )
      : 0

  const roomSubtotal = roomCharge + earlyCheckoutFee
  const vatOpts = bookingVatOptions({
    vatApplied: params.vatApplied,
    vatPercent: params.vatPercent,
  })
  const totals = computeRoomBookingTotals(roomSubtotal, 0, vatOpts)
  const totalPaid = sumBookingNetPaid(params.payments)
  const dueAmount = Math.max(0, totals.totalWithVat - totalPaid)

  return {
    bookedNights,
    actualStayNights,
    chargeableNights,
    waivedNights,
    stayMode: params.settings.stayMode,
    chargeableUntilDate: settingsChargeableDate(params.settings.chargeableUntilDate),
    scheduledCheckIn: toDateInputValue(params.checkIn),
    scheduledCheckOut: toDateInputValue(params.checkOut),
    canEarlyDeparture: availability.canEarlyDeparture,
    earlyDepartureDisabledReason: availability.earlyDepartureDisabledReason,
    canExtend: availability.canExtend,
    extendDisabledReason: availability.extendDisabledReason,
    minDepartureDate: toDateInputValue(minEarlyDepartureDate(actualCheckIn, params.checkIn)),
    maxDepartureDate: toDateInputValue(maxEarlyDepartureDate(params.checkOut)),
    minExtendDate: toDateInputValue(minExtendedCheckoutDate(params.checkOut)),
    nightlyRate,
    bookedRoomCharge,
    roomCharge,
    earlyCheckoutFee,
    roomSubtotal,
    vatPercent: totals.vatPercent,
    vatApplied: totals.vatApplied,
    vatAmount: totals.vatAmount,
    totalWithVat: totals.totalWithVat,
    totalPaid,
    dueAmount,
    isEarlyDeparture,
  }
}

function settingsChargeableDate(value: string): string {
  const parsed = parseDateInputValue(value)
  return parsed ? toDateInputValue(parsed) : value
}

export function parseStayAdjustmentBody(body: Record<string, unknown>): StayAdjustmentInput {
  const stayMode = body?.stayMode === 'extend' ? 'extend' : 'shrink'
  const rawDate = String(body?.chargeableUntilDate ?? body?.chargeableUntil ?? '')
  return {
    stayMode,
    chargeableUntilDate: rawDate,
    earlyCheckoutEnabled: Boolean(body?.earlyCheckoutEnabled),
    earlyCheckoutMode: body?.earlyCheckoutMode === 'amount' ? 'amount' : 'percent',
    earlyCheckoutPercent: parseFloat(String(body?.earlyCheckoutPercent ?? 0)) || 0,
    earlyCheckoutAmount: parseFloat(String(body?.earlyCheckoutAmount ?? 0)) || 0,
  }
}
