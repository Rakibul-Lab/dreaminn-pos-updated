import type { PaymentMethod, PrismaClient } from '@prisma/client'
import {
  bookingVatOptions,
  computeRoomBookingTotals,
  sumBookingNetPaid,
} from '@/lib/booking-totals'

type BillingDb = Pick<
  PrismaClient,
  'companyLedger' | 'companyLedgerBill' | 'companyLedgerGuest' | 'payment' | 'invoice' | 'booking'
>

export type PostCompanyLedgerBillInput = {
  companyLedgerId: string
  bookingId: string
  invoiceId: string | null
  guestName: string
  roomNumber: string
  totalAmount: number
  paidAmount: number
  dueAmount: number
  notes?: string | null
}

export type PostReservationEntryCompanyLedgerBillInput = {
  companyLedgerId: string
  reservationEntryId: string
  guestName: string
  roomSummary: string
  totalAmount: number
  paidAmount: number
  dueAmount: number
  notes?: string | null
}

/**
 * Sync stored company totals from bill rows. Authoritative due is sum(bill.dueAmount),
 * not billed − paid (cleared/transferred bills can keep historical totals with due 0).
 * Bills cleared by room bill-transfer are excluded so they cannot leave a phantom due/billed.
 */
export async function recomputeCompanyLedgerTotals(
  db: Pick<PrismaClient, 'companyLedger' | 'companyLedgerBill'>,
  companyLedgerId: string
): Promise<{ totalBilled: number; totalPaid: number; dueAmount: number }> {
  const bills = await db.companyLedgerBill.findMany({
    where: { companyLedgerId },
    select: {
      id: true,
      totalAmount: true,
      paidAmount: true,
      dueAmount: true,
      settlementStage: true,
      notes: true,
    },
  })

  const transferClearedIds: string[] = []
  let totalBilled = 0
  let totalPaid = 0
  let dueAmount = 0

  for (const bill of bills) {
    const transferCleared =
      bill.settlementStage === 'HOTEL_CLEARED' &&
      Boolean(bill.notes?.includes('Cleared — bill transferred'))
    if (transferCleared) {
      if (bill.totalAmount !== 0 || bill.paidAmount !== 0 || bill.dueAmount !== 0) {
        transferClearedIds.push(bill.id)
      }
      continue
    }
    totalBilled += Math.max(0, bill.totalAmount)
    totalPaid += Math.max(0, bill.paidAmount)
    dueAmount += Math.max(0, bill.dueAmount)
  }

  if (transferClearedIds.length > 0) {
    await db.companyLedgerBill.updateMany({
      where: { id: { in: transferClearedIds } },
      data: { totalAmount: 0, paidAmount: 0, dueAmount: 0 },
    })
  }

  totalBilled = Math.max(0, totalBilled)
  totalPaid = Math.max(0, totalPaid)
  dueAmount = Math.max(0, dueAmount)

  await db.companyLedger.update({
    where: { id: companyLedgerId },
    data: { totalBilled, totalPaid, dueAmount },
  })

  return { totalBilled, totalPaid, dueAmount }
}

export async function recomputeCompanyLedgerTotalsForIds(
  db: Pick<PrismaClient, 'companyLedger' | 'companyLedgerBill'>,
  companyLedgerIds: string[]
): Promise<Map<string, { totalBilled: number; totalPaid: number; dueAmount: number }>> {
  const uniqueIds = [...new Set(companyLedgerIds.filter(Boolean))]
  const result = new Map<string, { totalBilled: number; totalPaid: number; dueAmount: number }>()
  if (uniqueIds.length === 0) return result

  for (const id of uniqueIds) {
    result.set(id, await recomputeCompanyLedgerTotals(db, id))
  }

  return result
}

export async function postCompanyLedgerBill(
  db: BillingDb,
  input: PostCompanyLedgerBillInput
): Promise<void> {
  const dueAmount = Math.max(0, input.dueAmount)
  const paidAmount = Math.max(0, input.paidAmount)
  const totalAmount = Math.max(0, input.totalAmount)

  const existing = await db.companyLedgerBill.findUnique({
    where: { bookingId: input.bookingId },
  })

  if (existing) {
    const totalDelta = totalAmount - existing.totalAmount
    const paidDelta = paidAmount - existing.paidAmount
    const dueDelta = dueAmount - existing.dueAmount

    await db.companyLedgerBill.update({
      where: { id: existing.id },
      data: {
        invoiceId: input.invoiceId ?? existing.invoiceId,
        guestName: input.guestName,
        roomNumber: input.roomNumber,
        totalAmount,
        paidAmount,
        dueAmount,
        notes: input.notes ?? existing.notes,
      },
    })

    if (totalDelta !== 0 || paidDelta !== 0 || dueDelta !== 0) {
      await db.companyLedger.update({
        where: { id: input.companyLedgerId },
        data: {
          totalBilled: { increment: totalDelta },
          totalPaid: { increment: paidDelta },
          dueAmount: { increment: dueDelta },
        },
      })
    }
    return
  }

  await db.companyLedgerBill.create({
    data: {
      companyLedgerId: input.companyLedgerId,
      bookingId: input.bookingId,
      invoiceId: input.invoiceId,
      guestName: input.guestName,
      roomNumber: input.roomNumber,
      totalAmount,
      paidAmount,
      dueAmount,
      notes: input.notes ?? null,
    },
  })

  await db.companyLedger.update({
    where: { id: input.companyLedgerId },
    data: {
      totalBilled: { increment: totalAmount },
      totalPaid: { increment: paidAmount },
      dueAmount: { increment: dueAmount },
    },
  })
}

export async function postReservationEntryCompanyLedgerBill(
  db: BillingDb,
  input: PostReservationEntryCompanyLedgerBillInput
): Promise<void> {
  const dueAmount = Math.max(0, input.dueAmount)
  const paidAmount = Math.max(0, input.paidAmount)
  const totalAmount = Math.max(0, input.totalAmount)

  const existing = await db.companyLedgerBill.findUnique({
    where: { reservationEntryId: input.reservationEntryId },
  })

  if (existing) {
    const totalDelta = totalAmount - existing.totalAmount
    const paidDelta = paidAmount - existing.paidAmount
    const dueDelta = dueAmount - existing.dueAmount

    await db.companyLedgerBill.update({
      where: { id: existing.id },
      data: {
        guestName: input.guestName,
        roomNumber: input.roomSummary,
        totalAmount,
        paidAmount,
        dueAmount,
        notes: input.notes ?? existing.notes,
      },
    })

    if (totalDelta !== 0 || paidDelta !== 0 || dueDelta !== 0) {
      await db.companyLedger.update({
        where: { id: input.companyLedgerId },
        data: {
          totalBilled: { increment: totalDelta },
          totalPaid: { increment: paidDelta },
          dueAmount: { increment: dueDelta },
        },
      })
    }
    return
  }

  await db.companyLedgerBill.create({
    data: {
      companyLedgerId: input.companyLedgerId,
      reservationEntryId: input.reservationEntryId,
      billType: 'RESERVATION_ENTRY',
      guestName: input.guestName,
      roomNumber: input.roomSummary,
      totalAmount,
      paidAmount,
      dueAmount,
      notes: input.notes ?? null,
    },
  })

  await db.companyLedger.update({
    where: { id: input.companyLedgerId },
    data: {
      totalBilled: { increment: totalAmount },
      totalPaid: { increment: paidAmount },
      dueAmount: { increment: dueAmount },
    },
  })
}

export type CompanyLedgerGuestSource = {
  name: string
  phone?: string | null
  email?: string | null
  nationality?: string | null
  registrationNumber?: string | null
  address?: string | null
  idType?: string | null
  idNumber?: string | null
}

function guestDataFromSource(source: CompanyLedgerGuestSource) {
  return {
    guestName: source.name.trim(),
    phone: source.phone?.trim() || null,
    email: source.email?.trim() || null,
    nationality: source.nationality?.trim() || null,
    registrationNumber: source.registrationNumber?.trim() || null,
    address: source.address?.trim() || null,
    idType: source.idType?.trim() || null,
    idNumber: source.idNumber?.trim() || null,
  }
}

function mergeGuestData(
  existing: {
    registrationNumber?: string | null
  },
  incoming: ReturnType<typeof guestDataFromSource>
) {
  return {
    ...incoming,
    registrationNumber:
      incoming.registrationNumber?.trim() ||
      existing.registrationNumber?.trim() ||
      null,
  }
}

export async function ensureCompanyLedgerGuestFromCustomer(
  db: BillingDb,
  companyLedgerId: string,
  source: CompanyLedgerGuestSource,
  currentGuestId?: string | null
): Promise<string> {
  const data = guestDataFromSource(source)
  if (!data.guestName) {
    throw new Error('Guest name is required for company ledger')
  }

  // A booking already linked to a ledger guest renames that row in place. Otherwise
  // filling in real details on a placeholder guest would strand the original entry.
  if (currentGuestId) {
    const current = await db.companyLedgerGuest.findFirst({
      where: { id: currentGuestId, companyLedgerId },
    })
    if (current) {
      await db.companyLedgerGuest.update({
        where: { id: current.id },
        data: mergeGuestData(current, data),
      })
      return current.id
    }
  }

  if (data.phone) {
    const byPhone = await db.companyLedgerGuest.findFirst({
      where: { companyLedgerId, phone: data.phone },
    })
    if (byPhone) {
      await db.companyLedgerGuest.update({
        where: { id: byPhone.id },
        data: mergeGuestData(byPhone, data),
      })
      return byPhone.id
    }
  }

  const byName = await db.companyLedgerGuest.findFirst({
    where: { companyLedgerId, guestName: data.guestName },
  })
  if (byName) {
    await db.companyLedgerGuest.update({
      where: { id: byName.id },
      data: mergeGuestData(byName, data),
    })
    return byName.id
  }

  const created = await db.companyLedgerGuest.create({
    data: {
      companyLedgerId,
      ...data,
    },
  })
  return created.id
}

export async function resolveCompanyLedgerBooking(
  db: BillingDb,
  companyLedgerId: unknown,
  companyLedgerGuestId: unknown
): Promise<
  | {
      companyLedgerId: string
      companyLedgerGuestId: string | null
      companyName: string
    }
  | { error: string }
> {
  if (!companyLedgerId || typeof companyLedgerId !== 'string') {
    return { error: 'Invalid company ledger' }
  }

  const ledger = await db.companyLedger.findFirst({
    where: { id: companyLedgerId, active: true },
  })
  if (!ledger) {
    return { error: 'Company ledger not found or inactive' }
  }

  let guestId: string | null = null
  if (companyLedgerGuestId && typeof companyLedgerGuestId === 'string') {
    const guest = await db.companyLedgerGuest.findFirst({
      where: { id: companyLedgerGuestId, companyLedgerId: ledger.id },
    })
    if (!guest) {
      return { error: 'Selected company guest not found' }
    }
    guestId = guest.id
  }

  return {
    companyLedgerId: ledger.id,
    companyLedgerGuestId: guestId,
    companyName: ledger.name,
  }
}

export type RecordCompanyLedgerBillPaymentInput = {
  billId: string
  amount: number
  method: PaymentMethod
  receivedBy: string
  reference?: string | null
  notes?: string | null
}

export async function recordCompanyLedgerBillPayment(
  db: BillingDb,
  input: RecordCompanyLedgerBillPaymentInput
): Promise<{ paymentId: string; billDueAmount: number }> {
  const amount = Math.max(0, input.amount)
  if (amount <= 0) {
    throw new Error('Payment amount must be greater than 0')
  }

  const bill = await db.companyLedgerBill.findUnique({
    where: { id: input.billId },
    include: { booking: true },
  })
  if (!bill) {
    throw new Error('Company ledger bill not found')
  }
  if (bill.billType !== 'BOOKING' || !bill.bookingId) {
    throw new Error('Use restaurant payment route for CloudView restaurant bills')
  }
  if (bill.dueAmount <= 0) {
    throw new Error('This bill has no balance due')
  }
  if (amount > bill.dueAmount + 0.01) {
    throw new Error(`Payment cannot exceed due amount (৳${bill.dueAmount.toFixed(2)})`)
  }

  const payment = await db.payment.create({
    data: {
      amount,
      method: input.method,
      paymentType: 'FINAL',
      bookingId: bill.bookingId,
      invoiceId: bill.invoiceId,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      receivedBy: input.receivedBy,
    },
  })

  const newBillPaid = bill.paidAmount + amount
  const newBillDue = Math.max(0, bill.dueAmount - amount)

  await db.companyLedgerBill.update({
    where: { id: bill.id },
    data: {
      paidAmount: newBillPaid,
      dueAmount: newBillDue,
    },
  })

  await db.companyLedger.update({
    where: { id: bill.companyLedgerId },
    data: {
      totalPaid: { increment: amount },
      dueAmount: { decrement: amount },
    },
  })

  if (bill.invoiceId) {
    const invoice = await db.invoice.findUnique({ where: { id: bill.invoiceId } })
    if (invoice) {
      const invoicePaid = invoice.paidAmount + amount
      const invoiceDue = Math.max(0, invoice.dueAmount - amount)
      await db.invoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: invoicePaid,
          dueAmount: invoiceDue,
          status: invoiceDue <= 0 ? 'PAID' : 'ISSUED',
          paidAt: invoiceDue <= 0 ? new Date() : invoice.paidAt,
        },
      })
    }
  }

  if (bill.booking) {
    const paymentRows = await db.payment.findMany({
      where: { bookingId: bill.bookingId },
      select: { amount: true, paymentType: true },
    })
    const totalPaid = sumBookingNetPaid(paymentRows)
    const { dueAmount } = computeRoomBookingTotals(
      bill.booking.totalRoomCharge,
      totalPaid,
      bookingVatOptions(bill.booking)
    )
    await db.booking.update({
      where: { id: bill.bookingId },
      data: { dueAmount },
    })
  }

  return { paymentId: payment.id, billDueAmount: newBillDue }
}
