import { hasBookingCompany } from '@/lib/booking-company'
import { isKnownNationality } from '@/lib/nationalities'

/** ID/passport is required only for direct/walk-in guests when ID is physically received. */
export function requiresIdPassportFields(input: {
  isCorporateGuest?: boolean | null
  hasCompanySelected?: boolean | null
  nidPhysicallyReceived?: boolean | null
  requireForCompleteReservation?: boolean
}): boolean {
  if (input.isCorporateGuest === true) return false
  if (input.hasCompanySelected === true) return false
  if (input.nidPhysicallyReceived === true) return true
  return input.requireForCompleteReservation !== false
}

/** Fields required when ID documents are physically received at the front desk. */
export function getPhysicalIdMissingFields(guest: {
  idNumber: string
}): string[] {
  const missing: string[] = []
  if (!guest.idNumber.trim()) missing.push('ID / Passport number')
  return missing
}

/** Fields required for one corporate guest person (primary or companion). */
export function getCorporatePersonMissingFields(person: {
  name: string
  company: string
  phone: string
  designation: string
  address: string
}): string[] {
  const missing: string[] = []
  if (!person.name.trim()) missing.push('Full name')
  if (!person.company.trim()) missing.push('Company name')
  if (!person.phone.trim()) missing.push('Phone')
  if (!person.designation.trim()) missing.push('Designation')
  if (!person.address.trim()) missing.push('Address')
  return missing
}

/** Fields required for a corporate guest reservation primary guest. */
export function getCorporateGuestMissingFields(guest: {
  guestName: string
  guestCompany: string
  guestPhone: string
  guestDesignation: string
  guestAddress: string
}): string[] {
  return getCorporatePersonMissingFields({
    name: guest.guestName,
    company: guest.guestCompany,
    phone: guest.guestPhone,
    designation: guest.guestDesignation,
    address: guest.guestAddress,
  })
}

/** Fields required when completing an initial reservation or checking in. */
export function getCompleteReservationMissingFields(guest: {
  nationality: string
  idNumber: string
  email: string
  address: string
  idDocumentCount: number
  nidPhysicallyReceived?: boolean
  hasCompanySelected?: boolean
}): string[] {
  const missing: string[] = []
  if (!isKnownNationality(guest.nationality)) missing.push('Nationality')
  const requireId = requiresIdPassportFields({
    hasCompanySelected: guest.hasCompanySelected,
    nidPhysicallyReceived: guest.nidPhysicallyReceived,
    requireForCompleteReservation: true,
  })
  if (requireId && !guest.idNumber.trim()) missing.push('ID / Passport number')
  if (guest.nidPhysicallyReceived !== true && !guest.hasCompanySelected) {
    if (!guest.email.trim()) missing.push('Email')
    if (!guest.address.trim()) missing.push('Address')
  }
  if (guest.idDocumentCount === 0 && guest.nidPhysicallyReceived !== true) {
    missing.push('ID document image')
  }
  return missing
}

/** Fields required for an initial reservation (name, phone, nationality). */
export function getInitialReservationMissingFields(guest: {
  guestName: string
  guestPhone: string
  guestNationality: string
}): string[] {
  const missing: string[] = []
  if (!guest.guestName.trim()) missing.push('Full name')
  if (!guest.guestPhone.trim()) missing.push('Phone')
  if (!isKnownNationality(guest.guestNationality)) missing.push('Nationality')
  return missing
}

export function canBookingCheckIn(booking: {
  isInitialReservation?: boolean | null
  nidPhysicallyReceived?: boolean | null
  isCorporateGuest?: boolean | null
}): boolean {
  if (booking.isCorporateGuest === true) return true
  if (booking.nidPhysicallyReceived === true) return true
  return booking.isInitialReservation !== true
}

export function isReservationGuestProfileComplete(
  customer: {
    name?: string | null
    company?: string | null
    phone?: string | null
    designation?: string | null
    nationality?: string | null
    idNumber?: string | null
    email?: string | null
    address?: string | null
    registrationNumber?: string | null
    idType?: string | null
    visaExpiryDate?: string | null
  },
  idDocumentCount: number,
  options?: {
    nidPhysicallyReceived?: boolean
    isCorporateGuest?: boolean
    company?: string | null
    companyLedgerId?: string | null
  }
): boolean {
  if (options?.isCorporateGuest === true) {
    return (
      getCorporateGuestMissingFields({
        guestName: customer.name ?? '',
        guestCompany: customer.company ?? '',
        guestPhone: customer.phone ?? '',
        guestDesignation: customer.designation ?? '',
        guestAddress: customer.address ?? '',
      }).length === 0
    )
  }

  const hasCompanySelected = hasBookingCompany({
    company: options?.company,
    companyLedgerId: options?.companyLedgerId,
  })

  return (
    getCompleteReservationMissingFields({
      nationality: customer.nationality ?? '',
      idNumber: customer.idNumber ?? '',
      email: customer.email ?? '',
      address: customer.address ?? '',
      idDocumentCount,
      nidPhysicallyReceived: options?.nidPhysicallyReceived,
      hasCompanySelected,
    }).length === 0 && Boolean(customer.registrationNumber?.trim())
  )
}
