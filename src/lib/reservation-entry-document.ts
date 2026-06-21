import { db } from '@/lib/db'
import { generateReservationEntryConfirmationNumber } from '@/lib/confirmation-number.server'
import { generateGuestRegistrationNumber } from '@/lib/guest-registration-number'
import { computeBookingDisplayVat } from '@/lib/booking-totals'
import { formatFormOfPayment, getAdvancePaymentMethod } from '@/lib/payment-method'
import {
  computeReservationEntryRoomCharge,
  formatReservationEntryLineSummary,
} from '@/lib/reservation-entry'

export type ReservationEntryDocumentData = {
  id: string
  confirmationNumber: string | null
  registrationNumber: string | null
  checkIn: string
  checkOut: string
  guestName: string | null
  guestPhone: string | null
  guestEmail: string | null
  guestAddress: string | null
  guestNationality?: string | null
  guestIdType?: string | null
  guestIdNumber?: string | null
  company: string | null
  totalRoomCharge: number
  advancePayment: number
  dueAmount: number
  totalWithVat: number
  vatApplied: boolean
  vatPercent: number
  vatAmount: number
  discountEnabled: boolean
  discountType: string | null
  discountValue: number
  notes: string | null
  entryStatus: string
  status: string
  createdAt: string
  formOfPayment: string
  lineSummary: string
  totalRooms: number
  lines: Array<{
    roomTypeName: string
    roomNumber: string | null
    quantity: number
  }>
  creator?: {
    id: string
    name: string
    email: string
    phone?: string | null
    role: string
  } | null
}

export async function ensureReservationEntryNumbers(entryId: string): Promise<{
  registrationNumber: string
  confirmationNumber: string
}> {
  const entry = await db.reservationEntry.findUnique({
    where: { id: entryId },
    select: { id: true, registrationNumber: true, confirmationNumber: true },
  })
  if (!entry) throw new Error('Reservation entry not found')

  const registrationNumber =
    entry.registrationNumber?.trim() || (await generateGuestRegistrationNumber())
  const confirmationNumber =
    entry.confirmationNumber?.trim() || (await generateReservationEntryConfirmationNumber())

  if (
    entry.registrationNumber?.trim() === registrationNumber &&
    entry.confirmationNumber?.trim() === confirmationNumber
  ) {
    return { registrationNumber, confirmationNumber }
  }

  await db.reservationEntry.update({
    where: { id: entryId },
    data: {
      registrationNumber: entry.registrationNumber?.trim() || registrationNumber,
      confirmationNumber: entry.confirmationNumber?.trim() || confirmationNumber,
    },
  })

  return {
    registrationNumber: entry.registrationNumber?.trim() || registrationNumber,
    confirmationNumber: entry.confirmationNumber?.trim() || confirmationNumber,
  }
}

export async function buildReservationEntryDocumentData(
  entryId: string
): Promise<ReservationEntryDocumentData> {
  await ensureReservationEntryNumbers(entryId)

  const entry = await db.reservationEntry.findUnique({
    where: { id: entryId },
    include: {
      creator: { select: { id: true, name: true, email: true, phone: true, role: true } },
      payments: true,
      lines: {
        include: {
          roomType: { select: { name: true } },
          room: { select: { roomNumber: true } },
        },
      },
    },
  })

  if (!entry) throw new Error('Reservation entry not found')

  const lines = entry.lines.map((line) => ({
    roomTypeName: line.roomType.name,
    roomNumber: line.room?.roomNumber ?? null,
    quantity: line.roomId ? 1 : line.quantity,
  }))

  const totalRooms = lines.reduce((sum, line) => sum + line.quantity, 0)
  const lineSummary = formatReservationEntryLineSummary(
    lines.map((line, index) => ({
      id: entry.lines[index]?.id ?? String(index),
      roomTypeId: entry.lines[index]?.roomTypeId ?? '',
      roomTypeName: line.roomTypeName,
      roomId: entry.lines[index]?.roomId ?? null,
      roomNumber: line.roomNumber,
      quantity: line.quantity,
    }))
  )

  const advanceMethod = getAdvancePaymentMethod(entry.payments)
  const totalRoomCharge = await computeReservationEntryRoomCharge(
    entry.checkIn,
    entry.checkOut,
    entry.lines.map((line) => ({
      roomTypeId: line.roomTypeId,
      roomId: line.roomId,
      quantity: line.quantity,
    }))
  )
  const vatDisplay = computeBookingDisplayVat({
    totalRoomCharge,
    vatApplied: false,
    vatPercent: 15,
    discountEnabled: entry.discountEnabled,
    discountType: entry.discountType,
    discountValue: entry.discountValue,
  })

  const entryStatus = entry.status
  const status =
    entryStatus === 'PARTIALLY_FULFILLED'
      ? 'RESERVED ENTRY PARTIAL'
      : entryStatus === 'FULFILLED'
        ? 'RESERVED ENTRY FULFILLED'
        : entryStatus === 'CANCELLED'
          ? 'CANCELLED'
          : 'RESERVED ENTRY'

  return {
    id: entry.id,
    confirmationNumber: entry.confirmationNumber,
    registrationNumber: entry.registrationNumber,
    checkIn: entry.checkIn.toISOString(),
    checkOut: entry.checkOut.toISOString(),
    guestName: entry.guestName,
    guestPhone: entry.guestPhone,
    guestEmail: entry.guestEmail,
    guestAddress: entry.guestAddress,
    guestNationality: entry.guestNationality,
    guestIdType: entry.guestIdType,
    guestIdNumber: entry.guestIdNumber,
    company: entry.company,
    totalRoomCharge,
    advancePayment: entry.advancePayment,
    dueAmount: entry.dueAmount,
    totalWithVat: entry.totalAmount,
    vatApplied: false,
    vatPercent: vatDisplay.percent,
    vatAmount: vatDisplay.amount,
    discountEnabled: entry.discountEnabled,
    discountType: entry.discountType,
    discountValue: entry.discountValue,
    notes: entry.notes,
    entryStatus,
    status,
    createdAt: entry.createdAt.toISOString(),
    formOfPayment: formatFormOfPayment(entry.advancePayment, advanceMethod),
    lineSummary,
    totalRooms,
    lines,
    creator: entry.creator,
  }
}
