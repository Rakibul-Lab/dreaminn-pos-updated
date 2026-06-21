import type { CompanionType, PrismaClient } from '@prisma/client'
import { getPhoneValidationMessage } from '@/lib/phone'

export type CompanionInput = {
  companionType: 'ADULT' | 'CHILD'
  sortOrder?: number
  name: string
  company?: string | null
  designation?: string | null
  phone?: string | null
  nationality?: string | null
  idType?: string | null
  idNumber?: string | null
  visaExpiryDate?: string | null
  registrationNumber?: string | null
  email?: string | null
  address?: string | null
}

export type CorporatePersonInput = {
  name: string
  company: string
  phone: string
  designation: string
  address: string
}

/** Additional adults beyond the primary guest who need profile details. Children are count-only. */
export function expectedCompanionCount(adults: number, _children = 0): number {
  return Math.max(0, adults - 1)
}

export function buildAdultCompanionSlots(
  adults: number
): Array<{ companionType: 'ADULT'; label: string }> {
  const slots: Array<{ companionType: 'ADULT'; label: string }> = []
  for (let i = 2; i <= adults; i += 1) {
    slots.push({ companionType: 'ADULT', label: `Person ${i}` })
  }
  return slots
}

/** @deprecated Use buildAdultCompanionSlots — children are stored as a count only. */
export function buildCompanionSlots(adults: number, children: number): Array<{ companionType: 'ADULT' | 'CHILD'; label: string }> {
  return buildAdultCompanionSlots(adults)
}

export function validateCompanionInputs(
  adults: number,
  _children = 0,
  companions: CompanionInput[],
  options?: { requireIdFields?: boolean }
): string | null {
  const requireIdFields = options?.requireIdFields !== false
  const expected = expectedCompanionCount(adults)
  const adultCompanions = companions.filter((c) => c.companionType !== 'CHILD')
  if (adultCompanions.length !== expected) {
    return `Provide details for all ${expected} additional adult guest(s)`
  }
  for (let index = 0; index < adultCompanions.length; index += 1) {
    const companion = adultCompanions[index]
    const label = `Person ${index + 2}`
    if (!companion.name?.trim()) return `${label}: full name is required`
    if (!companion.phone?.trim()) return `${label}: phone is required`
    const phoneError = getPhoneValidationMessage(companion.phone, `${label} phone`)
    if (phoneError) return phoneError
    if (!companion.nationality?.trim()) return `${label}: nationality is required`
    if (requireIdFields && !companion.idNumber?.trim()) {
      return `${label}: NID / passport number is required`
    }
  }
  return null
}

export function validateCorporateCompanionInputs(
  adults: number,
  companions: CorporatePersonInput[]
): string | null {
  const expected = expectedCompanionCount(adults)
  if (companions.length !== expected) {
    return `Provide corporate details for all ${expected} additional adult guest(s)`
  }
  for (let index = 0; index < companions.length; index += 1) {
    const person = companions[index]
    if (!person.name?.trim()) return `Person ${index + 2}: full name is required`
    if (!person.company?.trim()) return `Person ${index + 2}: company name is required`
    if (!person.phone?.trim()) return `Person ${index + 2}: phone is required`
    const phoneError = getPhoneValidationMessage(person.phone, `Person ${index + 2} phone`)
    if (phoneError) return phoneError
    if (!person.designation?.trim()) return `Person ${index + 2}: designation is required`
    if (!person.address?.trim()) return `Person ${index + 2}: address is required`
  }
  return null
}

type CompanionDb = Pick<PrismaClient, 'bookingCompanion'>

export async function replaceBookingCompanions(
  db: CompanionDb,
  bookingId: string,
  companions: CompanionInput[] | undefined | null
): Promise<void> {
  await db.bookingCompanion.deleteMany({ where: { bookingId } })
  if (!companions?.length) return

  await db.bookingCompanion.createMany({
    data: companions.map((c, index) => ({
      bookingId,
      sortOrder: c.sortOrder ?? index,
      companionType: c.companionType as CompanionType,
      name: c.name.trim(),
      company: c.company?.trim() || null,
      designation: c.designation?.trim() || null,
      phone: c.phone?.trim() || null,
      nationality: c.nationality?.trim() || null,
      idType: c.idType?.trim() || null,
      idNumber: c.idNumber?.trim() || null,
      visaExpiryDate: c.visaExpiryDate?.trim() || null,
      registrationNumber: c.registrationNumber?.trim() || null,
      email: c.email?.trim() || null,
      address: c.address?.trim() || null,
    })),
  })
}
