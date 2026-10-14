export type GuestIdTypeOption = {
  value: 'national_id' | 'passport' | 'driving_license'
  label: string
}

const ID_TYPE_OPTIONS_ALL: GuestIdTypeOption[] = [
  { value: 'national_id', label: 'NID' },
  { value: 'passport', label: 'Passport' },
  { value: 'driving_license', label: 'Driving License' },
]

const ID_TYPE_OPTIONS_FOREIGN: GuestIdTypeOption[] = [
  { value: 'passport', label: 'Passport' },
  { value: 'driving_license', label: 'Driving License' },
]

export function isBangladeshNationality(nationality?: string | null): boolean {
  return nationality?.trim().toLowerCase() === 'bangladesh'
}

export const DEFAULT_NATIONALITY = 'Bangladesh'

export function getIdTypeOptionsForNationality(nationality?: string | null): GuestIdTypeOption[] {
  if (isBangladeshNationality(nationality)) return ID_TYPE_OPTIONS_ALL
  if (nationality?.trim()) return ID_TYPE_OPTIONS_FOREIGN
  return ID_TYPE_OPTIONS_ALL
}

export function defaultIdTypeForNationality(
  nationality?: string | null
): GuestIdTypeOption['value'] {
  if (isBangladeshNationality(nationality)) return 'national_id'
  if (nationality?.trim()) return 'passport'
  return 'national_id'
}

export function resolveIdTypeForNationality(
  nationality: string | null | undefined,
  currentIdType: GuestIdTypeOption['value']
): GuestIdTypeOption['value'] {
  const options = getIdTypeOptionsForNationality(nationality)
  if (options.some((opt) => opt.value === currentIdType)) return currentIdType
  return defaultIdTypeForNationality(nationality)
}

export function idTypeLabel(type?: string | null): string {
  if (type === 'passport') return 'Passport'
  if (type === 'driving_license') return 'Driving License'
  if (type === 'national_id') return 'NID'
  return type || '—'
}

export function formatGuestId(type?: string | null, number?: string | null): string {
  const num = number?.trim()
  const rawLabel = type ? idTypeLabel(type) : ''
  const label = rawLabel && rawLabel !== '—' ? rawLabel : 'NID'
  if (!num) return type ? label : '—'
  return `${label} · ${num}`
}
