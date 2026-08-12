import { db } from '@/lib/db'
import { findCustomerByPhone } from '@/lib/customer-phone'
import { generateGuestRegistrationNumber } from '@/lib/guest-registration-number'

/**
 * Guest profiles (`Customer`) can be shared across bookings (same phone / convert).
 * Editing one booking must not rewrite guest fields on unrelated stays.
 * If other bookings still point at this customer, clone the profile for this booking.
 */
export async function isolateBookingCustomer(
  bookingId: string,
  customerId: string
): Promise<string> {
  const sharedWithOthers = await db.booking.count({
    where: {
      customerId,
      id: { not: bookingId },
    },
  })
  if (sharedWithOthers === 0) return customerId

  const [customer, booking] = await Promise.all([
    db.customer.findUnique({ where: { id: customerId } }),
    db.booking.findUnique({
      where: { id: bookingId },
      select: { registrationNumber: true },
    }),
  ])
  if (!customer) return customerId

  const forked = await db.customer.create({
    data: {
      name: customer.name,
      company: customer.company,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      idType: customer.idType,
      idNumber: customer.idNumber,
      visaExpiryDate: customer.visaExpiryDate,
      registrationNumber: booking?.registrationNumber ?? customer.registrationNumber,
      nationality: customer.nationality,
      designation: customer.designation,
      dateOfBirth: customer.dateOfBirth,
      idDocPath: customer.idDocPath,
      notes: customer.notes,
    },
  })

  await db.booking.update({
    where: { id: bookingId },
    data: { customerId: forked.id },
  })

  return forked.id
}

export type PrimaryGuestProfileInput = {
  name: string
  phone: string
  email?: string | null
  address?: string | null
  company?: string | null
  designation?: string | null
  nationality?: string | null
  idType?: string | null
  idNumber?: string | null
  visaExpiryDate?: string | null
  idDocPath?: string | null
}

/**
 * When the primary guest is removed and Person 2 is promoted, keep the previous
 * primary's Customer row intact for Guests menu / history, and point this booking
 * at a separate customer profile for the new primary.
 */
export async function reassignBookingPrimaryCustomer(
  bookingId: string,
  previousCustomerId: string,
  profile: PrimaryGuestProfileInput
): Promise<string> {
  const name = profile.name.trim()
  const phone = profile.phone.trim()
  if (!name || !phone) {
    throw new Error('New primary guest name and phone are required')
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { registrationNumber: true },
  })

  const matched = await findCustomerByPhone(phone)
  let nextCustomerId: string

  if (matched && matched.id !== previousCustomerId) {
    await db.customer.update({
      where: { id: matched.id },
      data: {
        name,
        phone,
        email: profile.email?.trim() || matched.email,
        address: profile.address?.trim() || matched.address,
        company: profile.company?.trim() || matched.company,
        designation: profile.designation?.trim() || matched.designation,
        nationality: profile.nationality?.trim() || matched.nationality,
        idType: profile.idType ?? matched.idType,
        idNumber: profile.idNumber?.trim() || matched.idNumber,
        visaExpiryDate:
          profile.visaExpiryDate !== undefined
            ? profile.visaExpiryDate?.trim() || null
            : matched.visaExpiryDate,
        idDocPath: profile.idDocPath ?? matched.idDocPath,
      },
    })
    nextCustomerId = matched.id
  } else {
    // New profile, or same phone as previous primary — never overwrite previous primary.
    const created = await db.customer.create({
      data: {
        name,
        phone,
        email: profile.email?.trim() || null,
        address: profile.address?.trim() || null,
        company: profile.company?.trim() || null,
        designation: profile.designation?.trim() || null,
        nationality: profile.nationality?.trim() || null,
        idType: profile.idType ?? null,
        idNumber: profile.idNumber?.trim() || null,
        visaExpiryDate: profile.visaExpiryDate?.trim() || null,
        idDocPath: profile.idDocPath ?? null,
        registrationNumber:
          booking?.registrationNumber ?? (await generateGuestRegistrationNumber()),
      },
    })
    nextCustomerId = created.id
  }

  await db.booking.update({
    where: { id: bookingId },
    data: { customerId: nextCustomerId },
  })

  return nextCustomerId
}
