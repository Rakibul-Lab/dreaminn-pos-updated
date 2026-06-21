/** Placeholder shown on reservation documents when a required field is missing (initial reservations). */
export const RESERVATION_REQUIRED_PLACEHOLDER = '[Required — not provided]'

export function reservationDocValue(
  value: string | null | undefined,
  required = false
): string {
  const trimmed = value?.trim()
  if (trimmed) return trimmed
  return required ? RESERVATION_REQUIRED_PLACEHOLDER : '—'
}

export function reservationIdLabel(
  idType: string | null | undefined,
  idNumber: string | null | undefined,
  options?: {
    requiredWhenMissing?: boolean
  }
): string {
  const typeLabel =
    idType === 'passport'
      ? 'Passport'
      : idType === 'driving_license'
        ? 'Driving License'
        : idType === 'national_id'
          ? 'National ID (NID)'
          : idType || null

  const number = idNumber?.trim()
  let base: string
  if (typeLabel && number) base = `${typeLabel} — ${number}`
  else if (number) base = number
  else if (typeLabel && options?.requiredWhenMissing) {
    base = `${typeLabel} — ${RESERVATION_REQUIRED_PLACEHOLDER}`
  } else if (options?.requiredWhenMissing) base = RESERVATION_REQUIRED_PLACEHOLDER
  else base = '—'

  return base
}

/** @deprecated Passport expiry is no longer collected or shown. */
export function reservationVisaExpiryLabel(): null {
  return null
}

/** @deprecated Passport expiry is no longer collected or shown. */
export function formatVisaExpiryForDocument(): string {
  return ''
}
