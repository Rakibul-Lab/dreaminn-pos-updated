import { db } from '@/lib/db'
import {
  ensureBookingRegistrationNumber,
  ensureCustomerRegistrationNumber,
  generateGuestRegistrationNumber,
} from '@/lib/guest-registration-number'
import { generateConfirmationNumber } from '@/lib/confirmation-number.server'

type InvoiceGuestInput = {
  name: string
  phone: string
  email?: string | null
  address?: string | null
  nationality?: string | null
  idNumber?: string | null
  registrationNumber?: string | null
}

const bookingInclude = {
  customer: true,
  room: { include: { type: true } },
  charges: true,
  payments: true,
} as const

export async function upsertInvoiceCustomer(guest: InvoiceGuestInput) {
  const phone = guest.phone.trim()
  const name = guest.name.trim()

  let customer = await db.customer.findFirst({ where: { phone } })

  const customerData = {
    name,
    phone,
    email: guest.email?.trim() || null,
    address: guest.address?.trim() || null,
    nationality: guest.nationality?.trim() || null,
    idNumber: guest.idNumber?.trim() || null,
    registrationNumber: guest.registrationNumber?.trim() || null,
  }

  if (customer) {
    customer = await db.customer.update({
      where: { id: customer.id },
      data: customerData,
    })
  } else {
    customer = await db.customer.create({ data: customerData })
    await ensureCustomerRegistrationNumber(customer.id)
    customer = (await db.customer.findUnique({ where: { id: customer.id } }))!
  }

  if (!customer.registrationNumber && customerData.registrationNumber) {
    await db.customer.update({
      where: { id: customer.id },
      data: { registrationNumber: customerData.registrationNumber },
    })
  } else if (!customer.registrationNumber) {
    await ensureCustomerRegistrationNumber(customer.id)
    customer = (await db.customer.findUnique({ where: { id: customer.id } }))!
  }

  return customer
}

export async function resolveInvoiceBooking(params: {
  roomId: string
  checkIn: Date
  checkOut: Date
  guest: InvoiceGuestInput
  roomCharges: number
  userId: string
}) {
  const room = await db.room.findUnique({ where: { id: params.roomId } })
  if (!room) {
    throw new Error('Room not found')
  }

  const customer = await upsertInvoiceCustomer(params.guest)

  let booking =
    (await db.booking.findFirst({
      where: { roomId: params.roomId, status: 'CHECKED_IN' },
      include: bookingInclude,
      orderBy: { createdAt: 'desc' },
    })) ||
    (await db.booking.findFirst({
      where: {
        roomId: params.roomId,
        customerId: customer.id,
        status: { in: ['CHECKED_OUT', 'RESERVED'] },
      },
      include: bookingInclude,
      orderBy: { createdAt: 'desc' },
    }))

  if (booking) {
    if (!booking.registrationNumber?.trim()) {
      await ensureBookingRegistrationNumber(booking.id)
    }
    booking = await db.booking.update({
      where: { id: booking.id },
      data: {
        checkIn: params.checkIn,
        checkOut: params.checkOut,
        totalRoomCharge: params.roomCharges > 0 ? params.roomCharges : booking.totalRoomCharge,
      },
      include: bookingInclude,
    })
    return booking
  }

  const bookingRegistrationNumber = await generateGuestRegistrationNumber()

  return db.booking.create({
    data: {
      customerId: customer.id,
      roomId: params.roomId,
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      status: 'CHECKED_OUT',
      totalRoomCharge: params.roomCharges,
      dueAmount: params.roomCharges,
      createdBy: params.userId,
      confirmationNumber: await generateConfirmationNumber(),
      registrationNumber: bookingRegistrationNumber,
    },
    include: bookingInclude,
  })
}
