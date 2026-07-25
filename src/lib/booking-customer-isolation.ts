import { db } from '@/lib/db'

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
