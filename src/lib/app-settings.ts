import { db } from '@/lib/db'
import {
  checkoutHourFromTime,
  resolveStayFromDatePickers,
  buildWalkInStay,
  DEFAULT_CHECK_IN_TIME,
  DEFAULT_CHECK_OUT_TIME,
  normalizeTimeHHmm,
  type HotelTimes,
} from '@/lib/hotel-times'
import {
  SETTING_DEFINITIONS,
  getSettingDefinition,
  guessGroupFromKey,
  type SettingDefinition,
  type SettingGroup,
} from '@/lib/setting-definitions'

export {
  SETTING_DEFINITIONS,
  getSettingDefinition,
  type SettingDefinition,
  type SettingGroup,
}

export type SettingRow = { id: string; key: string; value: string; group: string }

export function mergeSettingsWithDefaults(
  rows: Array<{ id: string; key: string; value: string; group: string | null }>
): SettingRow[] {
  const byKey = new Map(rows.map((r) => [r.key, r]))

  for (const def of SETTING_DEFINITIONS) {
    if (!byKey.has(def.key)) {
      byKey.set(def.key, {
        id: `default-${def.key}`,
        key: def.key,
        value: def.value,
        group: def.group,
      })
    }
  }

  // Drop deprecated restaurant service charge from admin UI merges
  byKey.delete('service_charge_percent')

  return Array.from(byKey.values()).map((r) => ({
    id: r.id,
    key: r.key,
    value: r.value,
    group: r.group || guessGroupFromKey(r.key) || 'general',
  }))
}

export function groupSettings(rows: SettingRow[]): Record<string, SettingRow[]> {
  const grouped: Record<string, SettingRow[]> = {}
  for (const row of rows) {
    const def = DEF_BY_KEY.get(row.key)
    const group = def?.group || guessGroupFromKey(row.key)
    if (!grouped[group]) grouped[group] = []
    grouped[group].push({ ...row, group })
  }

  // Stable order: hotel, restaurant, billing, general, payment, then rest
  const order = ['hotel', 'restaurant', 'billing', 'general', 'payment']
  const sorted: Record<string, SettingRow[]> = {}
  for (const g of order) {
    if (grouped[g]?.length) {
      sorted[g] = grouped[g].sort((a, b) => a.key.localeCompare(b.key))
    }
  }
  for (const g of Object.keys(grouped)) {
    if (!sorted[g]) sorted[g] = grouped[g]
  }
  return sorted
}

const DEF_BY_KEY = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]))

function parsePercent(value: string | null | undefined, fallback: number): number {
  if (value == null || value === '') return fallback
  const parsed = parseFloat(value)
  if (Number.isNaN(parsed) || parsed < 0) return fallback
  return parsed
}

export async function readSettingValue(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } })
  return row?.value ?? null
}

export async function getHotelVatPercent(): Promise<number> {
  const raw = await readSettingValue('vat_percent')
  const def = DEF_BY_KEY.get('vat_percent')
  return parsePercent(raw, parsePercent(def?.value ?? '15', 15))
}

export async function getHotelServiceChargePercent(): Promise<number> {
  const raw = await readSettingValue('hotel_service_charge_percent')
  return parsePercent(raw, 10)
}

export async function getRestaurantVatPercent(): Promise<number> {
  const raw =
    (await readSettingValue('restaurant_vat_percent')) ??
    (await readSettingValue('vat_percent'))
  const def = DEF_BY_KEY.get('restaurant_vat_percent')
  return parsePercent(raw, parsePercent(def?.value ?? '15', 15))
}

export async function getHotelName(): Promise<string> {
  const raw = await readSettingValue('hotel_name')
  return raw?.trim() || DEF_BY_KEY.get('hotel_name')?.value || 'RRP Dream Inn'
}

export async function getRestaurantName(): Promise<string> {
  const raw = await readSettingValue('restaurant_name')
  return raw?.trim() || DEF_BY_KEY.get('restaurant_name')?.value || 'CloudView'
}

export async function computeLateCheckoutFee(
  scheduledCheckOut: Date,
  now: Date = new Date()
): Promise<{ amount: number; hoursLate: number }> {
  if (now <= scheduledCheckOut) {
    return { amount: 0, hoursLate: 0 }
  }
  const diffMs = now.getTime() - scheduledCheckOut.getTime()
  const hoursLate = Math.ceil(diffMs / (1000 * 60 * 60))
  const { charge } = await getLateCheckoutSettings()
  return { amount: Math.max(0, charge), hoursLate }
}

export async function getHotelCheckInOutTimes(): Promise<HotelTimes> {
  const checkInRaw = await readSettingValue('check_in_time')
  const checkOutRaw = await readSettingValue('check_out_time')
  const legacyHourRaw = await readSettingValue('late_checkout_hours')

  let checkOutTime = normalizeTimeHHmm(checkOutRaw, DEFAULT_CHECK_OUT_TIME)

  if (!checkOutRaw && legacyHourRaw != null && legacyHourRaw !== '') {
    const hour = Math.min(23, Math.max(0, Math.floor(parsePercent(legacyHourRaw, 12))))
    checkOutTime = `${String(hour).padStart(2, '0')}:00`
  }

  return {
    checkInTime: normalizeTimeHHmm(checkInRaw, DEFAULT_CHECK_IN_TIME),
    checkOutTime,
  }
}

export async function resolveBookingCheckInOut(
  checkIn: string | Date,
  checkOut: string | Date,
  options?: { walkInNow?: boolean }
): Promise<{ checkIn: Date; checkOut: Date; nights: number }> {
  const times = await getHotelCheckInOutTimes()

  if (options?.walkInNow) {
    const walkIn = buildWalkInStay(new Date(), times)
    return {
      checkIn: walkIn.checkIn,
      checkOut: walkIn.checkOut,
      nights: walkIn.nights,
    }
  }

  const checkInStr = typeof checkIn === 'string' ? checkIn : datePickerValueFromDate(checkIn)
  const checkOutStr = typeof checkOut === 'string' ? checkOut : datePickerValueFromDate(checkOut)
  const resolved = resolveStayFromDatePickers(checkInStr, checkOutStr, times)

  return {
    checkIn: resolved.checkIn,
    checkOut: resolved.checkOut,
    nights: resolved.nights,
  }
}

function datePickerValueFromDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export async function getLateCheckoutSettings(): Promise<{
  charge: number
  checkoutHour: number
}> {
  const chargeRaw = await readSettingValue('late_checkout_charge')
  const times = await getHotelCheckInOutTimes()
  const charge = parsePercent(chargeRaw, parseFloat(DEF_BY_KEY.get('late_checkout_charge')?.value ?? '500'))
  const checkoutHour = checkoutHourFromTime(times.checkOutTime)
  return { charge, checkoutHour }
}

export async function getEarlyCheckoutSettings(): Promise<{
  feePercent: number
  feeAmount: number
}> {
  const percentRaw = await readSettingValue('early_checkout_fee_percent')
  const amountRaw = await readSettingValue('early_checkout_fee_amount')
  const feePercent = parsePercent(
    percentRaw,
    parseFloat(DEF_BY_KEY.get('early_checkout_fee_percent')?.value ?? '50')
  )
  const feeAmount = parsePercent(
    amountRaw,
    parseFloat(DEF_BY_KEY.get('early_checkout_fee_amount')?.value ?? '500')
  )
  return { feePercent, feeAmount }
}
