import { hasBookingCompany } from '@/lib/booking-company'
import { isKnownNationality } from '@/lib/nationalities'
import { getIdTypeOptionsForNationality } from '@/lib/id-type-label'

/** ID/passport is required for walk-in guests, or whenever ID is physically received (including company ledger guests). */
export function requiresIdPassportFields(input: {
  isCorporateGuest?: boolean | null
  hasCompanySelected?: boolean | null
  nidPhysicallyReceived?: boolean | null
  requireForCompleteReservation?: boolean
}): boolean {
  if (input.isCorporateGuest === true) return false
  if (input.nidPhysicallyReceived === true) return true
  if (input.hasCompanySelected === true) return false
  return input.requireForCompleteReservation !== false
}

/** Document type required when ID is physically received (entry flow may omit ID number). */
export function getPhysicalIdTypeMissingFields(guest: {
  idType?: string | null
  nationality?: string | null
}): string[] {
  const missing: string[] = []
  const options = getIdTypeOptionsForNationality(guest.nationality)
  const type = guest.idType?.trim()
  if (!type || !options.some((opt) => opt.value === type)) {
    missing.push('ID document type')
  }
  return missing
}

/** Fields required when ID documents are physically received at the front desk. */
export function getPhysicalIdMissingFields(guest: {
  idNumber: string
  idType?: string | null
  nationality?: string | null
}): string[] {
  const missing = getPhysicalIdTypeMissingFields(guest)
  if (!guest.idNumber.trim()) missing.push('ID / Passport number')
  return missing
}

/** Fields required for one corporate guest person (primary or companion). */
export function getCorporatePersonMissingFields(person: {
  name: string | null | undefined
  company: string | null | undefined
  phone: string | null | undefined
  designation: string | null | undefined
  address: string | null | undefined
}): string[] {
  const missing: string[] = []
  if (!person.name?.trim()) missing.push('Full name')
  if (!person.company?.trim()) missing.push('Company name')
  if (!person.phone?.trim()) missing.push('Phone')
  if (!person.designation?.trim()) missing.push('Designation')
  if (!person.address?.trim()) missing.push('Address')
  return missing
}

/** Fields required for a corporate guest reservation primary guest. */
export function getCorporateGuestMissingFields(guest: {
  guestName: string | null | undefined
  guestCompany: string | null | undefined
  guestPhone: string | null | undefined
  guestDesignation: string | null | undefined
  guestAddress: string | null | undefined
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
  idType?: string | null
  email: string
  address: string
  idDocumentCount: number
  nidPhysicallyReceived?: boolean
  hasCompanySelected?: boolean
}): string[] {
  const missing: string[] = []
  if (!isKnownNationality(guest.nationality)) missing.push('Nationality')

  if (guest.nidPhysicallyReceived === true) {
    missing.push(
      ...getPhysicalIdMissingFields({
        idNumber: guest.idNumber,
        idType: guest.idType,
        nationality: guest.nationality,
      })
    )
  } else {
    const requireId = requiresIdPassportFields({
      hasCompanySelected: guest.hasCompanySelected,
      nidPhysicallyReceived: guest.nidPhysicallyReceived,
      requireForCompleteReservation: true,
    })
    if (requireId && !guest.idNumber.trim()) missing.push('ID / Passport number')
  }

  if (guest.nidPhysicallyReceived !== true && !guest.hasCompanySelected) {
    if (!guest.email.trim()) missing.push('Email')
    if (!guest.address.trim()) missing.push('Address')
  }
  if (
    guest.idDocumentCount === 0 &&
    guest.nidPhysicallyReceived !== true &&
    !guest.hasCompanySelected
  ) {
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

export function canBookingCheckIn(
  booking: {
    isInitialReservation?: boolean | null
    nidPhysicallyReceived?: boolean | null
    isCorporateGuest?: boolean | null
    company?: string | null
    companyLedgerId?: string | null
  },
  options?: {
    customer?: Parameters<typeof isReservationGuestProfileComplete>[0]
    idDocumentCount?: number
  }
): boolean {
  if (booking.isInitialReservation === true) return false

  if (options?.customer) {
    return isReservationGuestProfileComplete(
      options.customer,
      options.idDocumentCount ?? 0,
      {
        nidPhysicallyReceived: booking.nidPhysicallyReceived,
        isCorporateGuest: booking.isCorporateGuest,
        company: booking.company,
        companyLedgerId: booking.companyLedgerId,
      }
    )
  }

  // Without guest profile data, only allow check-in when not initial and not physical-ID-only.
  if (booking.isCorporateGuest === true) return true
  if (booking.nidPhysicallyReceived === true) return false
  return true
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
      idType: customer.idType,
      email: customer.email ?? '',
      address: customer.address ?? '',
      idDocumentCount,
      nidPhysicallyReceived: options?.nidPhysicallyReceived,
      hasCompanySelected,
    }).length === 0 && Boolean(customer.registrationNumber?.trim())
  )
}
