import type { PrismaClient } from '@prisma/client'
import { db } from '@/lib/db'
import { computeRoomBookingTotals } from '@/lib/booking-totals'
import { getRoomNightlyTotal } from '@/lib/room-pricing'
import { ensureCustomerRegistrationNumber, generateGuestRegistrationNumber } from '@/lib/guest-registration-number'
import { ensureReservationEntryNumbers } from '@/lib/reservation-entry-document'
import {
  ensureCompanyLedgerGuestFromCustomer,
  postCompanyLedgerBill,
  resolveCompanyLedgerBooking,
} from '@/lib/company-ledger-billing'
import { readCurrentBusinessDateString } from '@/lib/business-date'
import { isArrivalOnOrBeforeBusinessDate } from '@/lib/room-effective-status'
import {
  assertRoomAvailableForBooking,
  buildReservationEntryOverlapWhere,
  countLineSlots,
  countUnfulfilledSlots,
  entryInclude,
  mapReservationEntryToListRow,
} from '@/lib/reservation-entry'

export type ConvertAssignmentInput = {
  lineId: string
  roomIds: string[]
  /** Advance allocated to each room (same order as roomIds). Optional — defaults to proportional split. */
  advanceShares?: number[]
}

type BillingDb = Pick<
  PrismaClient,
  | 'companyLedger'
  | 'companyLedgerBill'
  | 'companyLedgerGuest'
  | 'payment'
  | 'invoice'
  | 'booking'
>

async function upsertEntryCustomer(entry: {
  guestName: string | null
  guestPhone: string | null
  guestEmail: string | null
  guestAddress: string | null
  guestNationality?: string | null
  guestIdType?: string | null
  guestIdNumber?: string | null
  company: string | null
  registrationNumber?: string | null
}) {
  const phone = entry.guestPhone?.trim()
  const name = entry.guestName?.trim()
  if (!phone || !name) {
    throw new Error('Guest name and phone are required on the reservation entry')
  }

  let customer = await db.customer.findFirst({ where: { phone } })
  const customerData = {
    name,
    phone,
    email: entry.guestEmail?.trim() || null,
    address: entry.guestAddress?.trim() || null,
    company: entry.company?.trim() || null,
    nationality: entry.guestNationality?.trim() || 'Bangladesh',
    idType: entry.guestIdType?.trim() || null,
    idNumber: entry.guestIdNumber?.trim() || null,
  }

  if (customer) {
    customer = await db.customer.update({
      where: { id: customer.id },
      data: {
        ...customerData,
        ...(entry.registrationNumber?.trim() && !customer.registrationNumber?.trim()
          ? { registrationNumber: entry.registrationNumber.trim() }
          : {}),
      },
    })
  } else {
    customer = await db.customer.create({
      data: {
        ...customerData,
        ...(entry.registrationNumber?.trim()
          ? { registrationNumber: entry.registrationNumber.trim() }
          : {}),
      },
    })
  }

  await ensureCustomerRegistrationNumber(customer.id)
  return db.customer.findUniqueOrThrow({ where: { id: customer.id } })
}

function countEntryRoomSlots(
  lines: Array<{ roomId: string | null; quantity: number; lineBookings: unknown[] }>
): number {
  return lines.reduce((sum, line) => sum + countLineSlots(line), 0)
}

function buildConvertedBookingNotes(entry: {
  notes: string | null
}): string | null {
  return entry.notes?.trim() || null
}

/** Separate guest profile per room when entry holds multiple rooms (group block). */
async function createIndividualGuestForConvertedRoom(input: {
  roomNumber: string
  company: string | null
}) {
  const customer = await db.customer.create({
    data: {
      name: `Guest – Room ${input.roomNumber}`,
      phone: null,
      company: input.company?.trim() || null,
      nationality: 'Bangladesh',
      notes: 'Placeholder guest — complete details at check-in.',
    },
  })
  await ensureCustomerRegistrationNumber(customer.id)
  return db.customer.findUniqueOrThrow({ where: { id: customer.id } })
}

async function resolveCustomerForConvertedSlot(input: {
  entry: {
    id: string
    guestName: string | null
    guestPhone: string | null
    guestEmail: string | null
    guestAddress: string | null
    guestNationality?: string | null
    guestIdType?: string | null
    guestIdNumber?: string | null
    company: string | null
    registrationNumber?: string | null
    lines: Array<{ roomId: string | null; quantity: number; lineBookings: unknown[] }>
  }
  roomNumber: string
  useIndividualGuests: boolean
}) {
  if (!input.useIndividualGuests) {
    return upsertEntryCustomer(input.entry)
  }
  return createIndividualGuestForConvertedRoom({
    roomNumber: input.roomNumber,
    company: input.entry.company,
  })
}

async function reduceReservationEntryLedgerBill(
  billingDb: BillingDb,
  bill: {
    id: string
    companyLedgerId: string
    totalAmount: number
    paidAmount: number
    dueAmount: number
  },
  reduceBy: { totalAmount: number; paidAmount: number; dueAmount: number },
  deleteWhenEmpty: boolean
) {
  const nextTotal = Math.max(0, bill.totalAmount - reduceBy.totalAmount)
  const nextPaid = Math.max(0, bill.paidAmount - reduceBy.paidAmount)
  const nextDue = Math.max(0, bill.dueAmount - reduceBy.dueAmount)

  const totalDelta = nextTotal - bill.totalAmount
  const paidDelta = nextPaid - bill.paidAmount
  const dueDelta = nextDue - bill.dueAmount

  if (deleteWhenEmpty && nextTotal <= 0.009 && nextDue <= 0.009) {
    await billingDb.companyLedgerBill.delete({ where: { id: bill.id } })
  } else {
    await billingDb.companyLedgerBill.update({
      where: { id: bill.id },
      data: {
        totalAmount: nextTotal,
        paidAmount: nextPaid,
        dueAmount: nextDue,
      },
    })
  }

  if (totalDelta !== 0 || paidDelta !== 0 || dueDelta !== 0) {
    await billingDb.companyLedger.update({
      where: { id: bill.companyLedgerId },
      data: {
        totalBilled: { increment: totalDelta },
        totalPaid: { increment: paidDelta },
        dueAmount: { increment: dueDelta },
      },
    })
  }
}

async function splitEntryPaymentsToBookings(
  entryId: string,
  bookingShares: Array<{ bookingId: string; advanceShare: number }>,
  receivedBy: string
) {
  const payments = await db.payment.findMany({
    where: { reservationEntryId: entryId },
    orderBy: { createdAt: 'asc' },
  })
  if (!payments.length) return

  const totalShare = bookingShares.reduce((sum, row) => sum + row.advanceShare, 0)
  if (totalShare <= 0) return

  let paymentIndex = 0
  let paymentRemaining = payments[0]?.amount ?? 0

  for (const share of bookingShares) {
    let remaining = share.advanceShare
    while (remaining > 0.009 && paymentIndex < payments.length) {
      const payment = payments[paymentIndex]
      const take = Math.min(remaining, paymentRemaining)
      if (take <= 0) {
        paymentIndex += 1
        paymentRemaining = payments[paymentIndex]?.amount ?? 0
        continue
      }

      await db.payment.create({
        data: {
          amount: take,
          method: payment.method,
          paymentType: payment.paymentType,
          bookingId: share.bookingId,
          receivedBy,
          businessDate: payment.businessDate,
          notes: 'Transferred from reservation entry advance',
        },
      })

      remaining -= take
      paymentRemaining -= take

      const newPaymentAmount = payment.amount - take
      if (newPaymentAmount <= 0.009) {
        await db.payment.delete({ where: { id: payment.id } })
        paymentIndex += 1
        paymentRemaining = payments[paymentIndex]?.amount ?? 0
      } else {
        await db.payment.update({
          where: { id: payment.id },
          data: { amount: newPaymentAmount },
        })
      }
    }
  }
}

export async function convertReservationEntry(input: {
  entryId: string
  assignments: ConvertAssignmentInput[]
  createdBy: string
  receivedBy: string
  checkInNow?: boolean
}) {
  const entry = await db.reservationEntry.findUnique({
    where: { id: input.entryId },
    include: {
      ...entryInclude,
      companyLedgerBill: true,
      payments: true,
      lines: {
        include: {
          roomType: { select: { id: true, name: true } },
          room: { select: { id: true, roomNumber: true, typeId: true, totalPrice: true } },
          lineBookings: { select: { id: true } },
        },
      },
    },
  })

  if (!entry) throw new Error('Reservation entry not found')
  if (entry.status === 'CANCELLED') throw new Error('Cancelled reservation entry cannot be converted')
  if (entry.status === 'FULFILLED') throw new Error('Reservation entry is already fulfilled')

  const assignmentMap = new Map(input.assignments.map((row) => [row.lineId, row]))

  type PlannedSlot = {
    lineId: string
    roomId: string
    roomTypeId: string
    assignmentIndex: number
  }

  const planned: PlannedSlot[] = []

  for (const line of entry.lines) {
    const unfulfilled = countUnfulfilledSlots(line)
    if (unfulfilled <= 0) continue

    const requested = assignmentMap.get(line.id)?.roomIds ?? []
    const presetRoomId = line.roomId && line.lineBookings.length === 0 ? line.roomId : null
    const roomIds =
      requested.length > 0
        ? requested
        : presetRoomId
          ? [presetRoomId]
          : []

    if (roomIds.length !== unfulfilled) {
      const label = line.room?.roomNumber ?? line.roomType.name
      throw new Error(
        `Assign ${unfulfilled} room(s) for ${label} (${roomIds.length} provided)`
      )
    }

    for (let assignmentIndex = 0; assignmentIndex < roomIds.length; assignmentIndex++) {
      planned.push({
        lineId: line.id,
        roomId: roomIds[assignmentIndex]!,
        roomTypeId: line.roomTypeId,
        assignmentIndex,
      })
    }
  }

  if (!planned.length) {
    throw new Error('No unfulfilled rooms to convert')
  }

  const msPerDay = 24 * 60 * 60 * 1000
  const nights = Math.max(
    1,
    Math.round((entry.checkOut.getTime() - entry.checkIn.getTime()) / msPerDay)
  )

  const roomRows = await db.room.findMany({
    where: { id: { in: planned.map((row) => row.roomId) } },
    include: { type: true },
  })
  const roomById = new Map(roomRows.map((room) => [room.id, room]))

  for (const slot of planned) {
    const room = roomById.get(slot.roomId)
    if (!room) throw new Error('Selected room not found')
    if (room.typeId !== slot.roomTypeId) {
      throw new Error(`Room ${room.roomNumber} is not in the expected category`)
    }
    if (room.status === 'MAINTENANCE' || room.status === 'CLEANING') {
      throw new Error(
        `Room ${room.roomNumber} is not available (${room.status === 'MAINTENANCE' ? 'maintenance' : 'cleaning'})`
      )
    }

    const overlap = await db.booking.count({
      where: {
        roomId: slot.roomId,
        status: { in: ['RESERVED', 'CHECKED_IN'] },
        checkIn: { lt: entry.checkOut },
        checkOut: { gt: entry.checkIn },
      },
    })
    if (overlap > 0) {
      throw new Error(`Room ${room.roomNumber} already has a booking for these dates`)
    }

    const blockError = await assertRoomAvailableForBooking(
      slot.roomId,
      slot.roomTypeId,
      entry.checkIn,
      entry.checkOut,
      entry.id
    )
    if (blockError) throw new Error(blockError)
  }

  const totalEntryRoomSlots = countEntryRoomSlots(entry.lines)
  const useIndividualGuests = totalEntryRoomSlots > 1

  let resolvedCompanyLedgerId: string | null = entry.companyLedgerId
  let resolvedCompany = entry.company

  if (resolvedCompanyLedgerId) {
    const ledgerResult = await resolveCompanyLedgerBooking(db, resolvedCompanyLedgerId, null)
    if ('error' in ledgerResult) throw new Error(ledgerResult.error)
    resolvedCompanyLedgerId = ledgerResult.companyLedgerId
    resolvedCompany = ledgerResult.companyName
  }

  const applyDiscount = entry.discountEnabled
  const resolvedDiscountType = entry.discountType === 'FIXED' ? 'FIXED' : 'PERCENTAGE'
  const resolvedDiscountValue = applyDiscount ? entry.discountValue : 0

  const { confirmationNumber: entryConfirmationNumber } = await ensureReservationEntryNumbers(
    entry.id
  )

  const slotCharges = planned.map((slot) => {
    const room = roomById.get(slot.roomId)!
    return getRoomNightlyTotal(room) * nights
  })
  const originalRoomCharge = slotCharges.reduce((sum, charge) => sum + charge, 0)

  const defaultAdvanceShares = planned.map((slot, index) => {
    const totalRoomCharge = slotCharges[index]!
    const shareRatio =
      originalRoomCharge > 0 ? totalRoomCharge / originalRoomCharge : 1 / planned.length
    return entry.advancePayment * shareRatio
  })

  const resolvedAdvanceShares = planned.map((slot, index) => {
    const assignment = assignmentMap.get(slot.lineId)
    const fromBody = assignment?.advanceShares?.[slot.assignmentIndex]
    if (fromBody !== undefined && fromBody !== null && !Number.isNaN(Number(fromBody))) {
      return Math.max(0, Number(fromBody))
    }
    return defaultAdvanceShares[index] ?? 0
  })

  const allocatedAdvance = resolvedAdvanceShares.reduce((sum, value) => sum + value, 0)
  if (allocatedAdvance - entry.advancePayment > 0.009) {
    throw new Error(
      `Allocated advance (${allocatedAdvance.toFixed(2)} BDT) exceeds available advance on this entry (${entry.advancePayment.toFixed(2)} BDT)`
    )
  }

  const createdBookings: Array<{
    bookingId: string
    roomId: string
    lineId: string
    confirmationNumber: string | null
    roomNumber: string
    guestName: string
    totalWithVat: number
    advanceShare: number
    dueAmount: number
  }> = []

  const businessDate = await readCurrentBusinessDateString()

  for (let slotIndex = 0; slotIndex < planned.length; slotIndex++) {
    const slot = planned[slotIndex]!
    const room = roomById.get(slot.roomId)!
    const totalRoomCharge = slotCharges[slotIndex]!
    const advanceShare = resolvedAdvanceShares[slotIndex] ?? 0

    const { totalWithVat, dueAmount } = computeRoomBookingTotals(
      totalRoomCharge,
      advanceShare,
      { vatApplied: false, vatPercent: 15 },
      {
        discountEnabled: applyDiscount,
        discountType: resolvedDiscountType,
        discountValue: resolvedDiscountValue,
        nights,
      }
    )

    const customer = await resolveCustomerForConvertedSlot({
      entry,
      roomNumber: room.roomNumber,
      useIndividualGuests,
    })

    let companyLedgerGuestId: string | null = null
    let stayRegistrationNumber: string
    const entryRegNo = entry.registrationNumber?.trim()
    if (slotIndex === 0 && entryRegNo) {
      const taken = await db.booking.findFirst({
        where: { registrationNumber: entryRegNo },
        select: { id: true },
      })
      stayRegistrationNumber = taken ? await generateGuestRegistrationNumber() : entryRegNo
    } else {
      stayRegistrationNumber = await generateGuestRegistrationNumber()
    }

    if (resolvedCompanyLedgerId) {
      companyLedgerGuestId = await ensureCompanyLedgerGuestFromCustomer(
        db,
        resolvedCompanyLedgerId,
        {
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          nationality: customer.nationality,
          registrationNumber: stayRegistrationNumber,
          address: customer.address,
          idType: customer.idType,
          idNumber: customer.idNumber,
        }
      )
    }

    const confirmationNumber = entryConfirmationNumber
    const booking = await db.booking.create({
      data: {
        confirmationNumber,
        registrationNumber: stayRegistrationNumber,
        customerId: customer.id,
        roomId: slot.roomId,
        company: resolvedCompany,
        companyLedgerId: resolvedCompanyLedgerId,
        companyLedgerGuestId,
        checkIn: entry.checkIn,
        checkOut: entry.checkOut,
        adults: 1,
        children: 0,
        totalRoomCharge,
        advancePayment: advanceShare,
        dueAmount,
        vatApplied: false,
        vatPercent: 15,
        serviceChargePercent: 10,
        isInitialReservation: true,
        nidPhysicallyReceived: useIndividualGuests
          ? false
          : entry.nidPhysicallyReceived === true,
        discountEnabled: applyDiscount,
        discountType: applyDiscount ? resolvedDiscountType : null,
        discountValue: applyDiscount ? resolvedDiscountValue : 0,
        notes: buildConvertedBookingNotes({
          notes: entry.notes,
        }),
        sourceReservationEntryId: entry.id,
        createdBy: input.createdBy,
      },
    })

    await db.reservationEntryLineBooking.create({
      data: {
        reservationEntryLineId: slot.lineId,
        bookingId: booking.id,
        roomId: slot.roomId,
      },
    })

    if (input.checkInNow) {
      await db.room.update({ where: { id: slot.roomId }, data: { status: 'OCCUPIED' } })
      await db.booking.update({
        where: { id: booking.id },
        data: { status: 'CHECKED_IN', actualCheckIn: new Date() },
      })
    } else if (isArrivalOnOrBeforeBusinessDate(entry.checkIn, businessDate)) {
      await db.room.update({ where: { id: slot.roomId }, data: { status: 'RESERVED' } })
    }

    createdBookings.push({
      bookingId: booking.id,
      roomId: slot.roomId,
      lineId: slot.lineId,
      confirmationNumber,
      roomNumber: room.roomNumber,
      guestName: customer.name,
      totalWithVat,
      advanceShare,
      dueAmount,
    })
  }

  await splitEntryPaymentsToBookings(
    entry.id,
    createdBookings.map((row) => ({ bookingId: row.bookingId, advanceShare: row.advanceShare })),
    input.receivedBy
  )

  // Every converted room on a company ledger gets its own ledger bill. This must not
  // depend on the entry still holding a bill of its own, or the stay never reaches
  // the ledger at all.
  if (resolvedCompanyLedgerId) {
    for (const row of createdBookings) {
      await postCompanyLedgerBill(db, {
        companyLedgerId: resolvedCompanyLedgerId,
        bookingId: row.bookingId,
        invoiceId: null,
        guestName: row.guestName,
        roomNumber: row.roomNumber,
        totalAmount: row.totalWithVat,
        paidAmount: row.advanceShare,
        dueAmount: row.dueAmount,
        notes: entry.notes,
      })
    }

    if (entry.companyLedgerBill) {
      const convertedTotal = createdBookings.reduce((sum, row) => sum + row.totalWithVat, 0)
      const convertedPaid = createdBookings.reduce((sum, row) => sum + row.advanceShare, 0)
      const convertedDue = createdBookings.reduce((sum, row) => sum + row.dueAmount, 0)

      const refreshed = await db.reservationEntry.findUnique({
        where: { id: entry.id },
        include: {
          lines: { include: { lineBookings: { select: { id: true } } } },
          companyLedgerBill: true,
        },
      })

      const stillUnfulfilled =
        refreshed?.lines.some((line) => countUnfulfilledSlots(line) > 0) ?? false

      await reduceReservationEntryLedgerBill(
        db,
        entry.companyLedgerBill,
        {
          totalAmount: convertedTotal,
          paidAmount: convertedPaid,
          dueAmount: convertedDue,
        },
        !stillUnfulfilled
      )
    }
  }

  const refreshedEntry = await db.reservationEntry.findUnique({
    where: { id: entry.id },
    include: {
      lines: { include: { lineBookings: { select: { id: true } } } },
      payments: true,
    },
  })

  const remainingSlots =
    refreshedEntry?.lines.reduce((sum, line) => sum + countUnfulfilledSlots(line), 0) ?? 0

  const convertedTotal = createdBookings.reduce((sum, row) => sum + row.totalWithVat, 0)
  const convertedAdvance = createdBookings.reduce((sum, row) => sum + row.advanceShare, 0)
  const convertedDue = createdBookings.reduce((sum, row) => sum + row.dueAmount, 0)

  const nextStatus =
    remainingSlots > 0 ? ('PARTIALLY_FULFILLED' as const) : ('FULFILLED' as const)

  await db.reservationEntry.update({
    where: { id: entry.id },
    data: {
      status: nextStatus,
      fulfilledAt: remainingSlots > 0 ? null : new Date(),
      totalAmount: Math.max(0, entry.totalAmount - convertedTotal),
      advancePayment: Math.max(0, entry.advancePayment - convertedAdvance),
      dueAmount: Math.max(0, entry.dueAmount - convertedDue),
    },
  })

  const finalEntry = await db.reservationEntry.findUniqueOrThrow({
    where: { id: entry.id },
    include: entryInclude,
  })

  return {
    entry: mapReservationEntryToListRow(finalEntry),
    bookings: createdBookings,
  }
}

export async function fetchActiveEntryHoldsForRooms(
  roomIds: string[],
  businessDate: string
): Promise<
  Map<
    string,
    {
      entryId: string
      guestName: string | null
      checkIn: Date
      lineId: string
    }
  >
> {
  const result = new Map<
    string,
    { entryId: string; guestName: string | null; checkIn: Date; lineId: string }
  >()
  if (!roomIds.length) return result

  const lines = await db.reservationEntryLine.findMany({
    where: {
      roomId: { in: roomIds },
      reservationEntry: {
        status: { in: ['ACTIVE', 'PARTIALLY_FULFILLED'] },
      },
      lineBookings: { none: {} },
    },
    include: {
      reservationEntry: {
        select: { id: true, guestName: true, checkIn: true, status: true },
      },
    },
  })

  for (const line of lines) {
    if (!line.roomId) continue
    if (!isArrivalOnOrBeforeBusinessDate(line.reservationEntry.checkIn, businessDate)) continue
    result.set(line.roomId, {
      entryId: line.reservationEntry.id,
      guestName: line.reservationEntry.guestName,
      checkIn: line.reservationEntry.checkIn,
      lineId: line.id,
    })
  }

  return result
}

export async function syncArrivalEntryHoldRoomStatuses(
  dbClient: Pick<PrismaClient, 'reservationEntryLine' | 'room'>,
  businessDate: string
): Promise<void> {
  const { start, end } = await import('@/lib/business-date').then((m) =>
    m.getCalendarDayBounds(businessDate)
  )

  const lines = await dbClient.reservationEntryLine.findMany({
    where: {
      roomId: { not: null },
      lineBookings: { none: {} },
      reservationEntry: {
        ...buildReservationEntryOverlapWhere(start, end),
        checkIn: { gte: start, lte: end },
      },
    },
    select: { roomId: true },
  })

  const roomIds = lines.map((line) => line.roomId!).filter(Boolean)
  if (!roomIds.length) return

  await dbClient.room.updateMany({
    where: { id: { in: roomIds }, status: 'AVAILABLE' },
    data: { status: 'RESERVED' },
  })
}
