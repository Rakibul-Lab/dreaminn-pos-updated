/** Last 6 alphanumeric chars of payment id — must match slip suffix logic. */
export function paymentSlipSuffixFromId(paymentId: string): string {
  return paymentId.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toLowerCase()
}

/** UTC calendar date used on printed slips (yyyyMMdd). */
export function paymentSlipDatePartUtc(createdAt: Date | string): string {
  const value = typeof createdAt === 'string' ? new Date(createdAt) : createdAt
  return value.toISOString().slice(0, 10).replace(/-/g, '')
}

export function formatPaymentSlipNumber(payment: { id: string; createdAt: Date | string }): string {
  const datePart = paymentSlipDatePartUtc(payment.createdAt)
  const suffix = paymentSlipSuffixFromId(payment.id).toUpperCase()
  return `PS-${datePart}-${suffix}`
}

export function utcDayRangeFromYyyyMmDd(
  yyyyMMdd: string
): { dateFrom: Date; dateTo: Date } | null {
  if (!/^\d{8}$/.test(yyyyMMdd)) return null
  const y = Number(yyyyMMdd.slice(0, 4))
  const m = Number(yyyyMMdd.slice(4, 6))
  const d = Number(yyyyMMdd.slice(6, 8))
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dateFrom = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0))
  const dateTo = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))
  if (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime())) return null
  return { dateFrom, dateTo }
}

export type ParsedSlipSearch = {
  datePart: string
  suffixUpper: string
  normalized: string
}

/** Full slip no. typed in search — PS-YYYYMMDD-SUFFIX (flexible separators). */
export function parseFullSlipSearch(term: string): ParsedSlipSearch | null {
  const compact = term.trim().toUpperCase().replace(/\s+/g, '')
  const match = compact.match(/^PS-?(\d{8})-?([A-Z0-9]{4,})$/)
  if (!match) return null
  const [, datePart, suffixUpper] = match
  return {
    datePart,
    suffixUpper,
    normalized: `PS-${datePart}-${suffixUpper}`,
  }
}

export function paymentMatchesSlipSearch(
  payment: { id: string; createdAt: Date },
  slip: ParsedSlipSearch
): boolean {
  if (formatPaymentSlipNumber(payment).toUpperCase() === slip.normalized) return true
  return (
    paymentSlipSuffixFromId(payment.id) === slip.suffixUpper.toLowerCase() &&
    paymentSlipDatePartUtc(payment.createdAt) === slip.datePart
  )
}
