import { DEFAULT_GUEST_COMPANY } from '@/lib/reservation-terms'

export const BOOKING_COMPANY_FILTER = 'COMPANY' as const
export const WALK_IN_LABEL = 'Walk-in'

export function isCompanyLedgerBooking(booking: { companyLedgerId?: string | null }): boolean {
  return Boolean(booking.companyLedgerId)
}

export function getBookingCompanyName(booking: {
  company?: string | null
  companyLedger?: { name: string } | null
}): string {
  if (booking.companyLedger?.name?.trim()) return booking.companyLedger.name.trim()
  const company = booking.company?.trim()
  if (company && company !== DEFAULT_GUEST_COMPANY) return company
  return ''
}

/** Company ledger/name for list & export, or Walk-in for direct guests. */
export function getBookingSourceLabel(booking: {
  company?: string | null
  companyLedgerId?: string | null
  companyLedger?: { name: string } | null
}): string {
  const companyName = getBookingCompanyName(booking)
  if (companyName) return companyName
  if (isCompanyLedgerBooking(booking)) return 'Company ledger'
  return WALK_IN_LABEL
}

export function isWalkInBooking(booking: {
  company?: string | null
  companyLedgerId?: string | null
  companyLedger?: { name: string } | null
}): boolean {
  return getBookingSourceLabel(booking) === WALK_IN_LABEL
}

/** True when a company ledger or non-walk-in company name is set on the booking. */
export function hasBookingCompany(booking: {
  company?: string | null
  companyLedgerId?: string | null
  companyLedger?: { name: string } | null
}): boolean {
  if (booking.companyLedgerId) return true
  return Boolean(getBookingCompanyName(booking))
}
