import type { PrismaClient } from '@prisma/client'
import { parseBookingDiscountType, taxableHotelAfterRoomDiscount } from '@/lib/booking-discount'
import { bookingVatOptions, computeRoomBookingTotals, sumBookingNetPaid } from '@/lib/booking-totals'
import { getRoomNightlyTotal } from '@/lib/room-pricing'
import {
  computeCheckoutSettlement,
  type CheckoutSettlementParams,
  type CheckoutSettlementResult,
} from '@/lib/checkout-settlement'
import type { InvoiceLineItemInput } from '@/lib/invoice-line-items'
import {
  buildInvoiceChargeLinesOnly,
  type BuildInvoiceLineItemsInput,
} from '@/lib/invoice-line-items'
import { recomputeCompanyLedgerTotals } from '@/lib/company-ledger-billing'

export type CreditTransferBookingRow = {
  id: string
  status: string
  billTransferredToBookingId?: string | null
  roomId: string
  checkIn: Date
  checkOut: Date
  actualCheckIn: Date | null
  totalRoomCharge: number
  adults?: number
  dueAmount?: number
  vatApplied?: boolean | null
  vatPercent?: number | null
  discountEnabled?: boolean | null
  discountType?: string | null
  discountValue?: number | null
  notes?: string | null
  customer: {
    name: string
    phone?: string | null
    email?: string | null
    nationality?: string | null
    idType?: string | null
    idNumber?: string | null
    company?: string | null
    designation?: string | null
    address?: string | null
    registrationNumber?: string | null
  }
  room: { id: string; roomNumber: string; totalPrice: number; type: { name: string } }
  charges: Array<{
    id: string
    chargeType: string
    description: string
    amount: number
    quantity: number
  }>
}

export type CreditTransferPreviewLine = {
  bookingId: string
  roomNumber: string
  roomTypeName: string
  customerName: string
  /** Paying room folio vs bill transferred in from another stay. */
  kind: 'primary' | 'transferred'
  checkIn: string | Date
  checkOut: string | Date
  nights: number
  nightlyRate: number
  roomCharges: number
  foodCharges: number
  extraCharges: number
  discount: number
  discountEnabled: boolean
  discountType: 'PERCENTAGE' | 'FIXED' | null
  discountValue: number
  discountLabel: string
  hotelVat: number
  restaurantVat: number
  vatAmount: number
  /** Room + extras + food (before hotel discount / hotel VAT). */
  subtotal: number
  /** Folio total for this room after its own discount + VAT. */
  roomTotal: number
  totalPaid: number
  /** @deprecated use roomTotal — kept for older checkout UI */
  transferTotal: number
}

export type PreparedCreditTransfer = {
  booking: CreditTransferBookingRow
  settlement: CheckoutSettlementResult
  restaurantOrders: CheckoutSettlementParams['restaurantOrders']
  restaurantOrdersWithItems: BuildInvoiceLineItemsInput['restaurantOrders']
  payments: { amount: number; paymentType: string }[]
}

function discountMetaFromBooking(booking: {
  discountEnabled?: boolean | null
  discountType?: string | null
  discountValue?: number | null
}): {
  discountEnabled: boolean
  discountType: 'PERCENTAGE' | 'FIXED' | null
  discountValue: number
  discountLabel: string
  discount: number
} {
  const discountEnabled = booking.discountEnabled === true
  const discountType = discountEnabled
    ? parseBookingDiscountType(booking.discountType)
    : null
  const discountValue = discountEnabled ? Math.max(0, Number(booking.discountValue) || 0) : 0
  return {
    discountEnabled,
    discountType,
    discountValue,
    discountLabel: '',
    discount: 0,
  }
}

function buildRoomFolioPreviewLine(params: {
  bookingId: string
  roomNumber: string
  roomTypeName: string
  customerName: string
  kind: 'primary' | 'transferred'
  checkIn: Date
  checkOut: Date
  settlement: CheckoutSettlementResult
  booking: {
    discountEnabled?: boolean | null
    discountType?: string | null
    discountValue?: number | null
  }
  payments: { amount: number; paymentType: string }[]
}): CreditTransferPreviewLine {
  const meta = discountMetaFromBooking(params.booking)
  const discount = Math.max(0, params.settlement.discount)
  const discountLabel =
    discount > 0 && meta.discountType
      ? meta.discountType === 'PERCENTAGE' && meta.discountValue > 0
        ? `${meta.discountValue}%`
        : 'Fixed'
      : discount > 0
        ? 'Discount'
        : '—'
  const subtotal =
    params.settlement.roomCharges +
    params.settlement.extraCharges +
    params.settlement.foodCharges
  const roomTotal = Math.max(0, params.settlement.totalAmount)
  const totalPaid = sumBookingNetPaid(params.payments)

  return {
    bookingId: params.bookingId,
    roomNumber: params.roomNumber,
    roomTypeName: params.roomTypeName,
    customerName: params.customerName,
    kind: params.kind,
    checkIn: params.checkIn,
    checkOut: params.checkOut,
    nights: params.settlement.chargeableNights,
    nightlyRate: params.settlement.nightlyRate,
    roomCharges: params.settlement.roomCharges,
    foodCharges: params.settlement.foodCharges,
    extraCharges: params.settlement.extraCharges,
    discount,
    discountEnabled: meta.discountEnabled,
    discountType: meta.discountType,
    discountValue: meta.discountValue,
    discountLabel,
    hotelVat: params.settlement.hotelVat,
    restaurantVat: params.settlement.restaurantVat,
    vatAmount: params.settlement.vatAmount,
    subtotal,
    roomTotal,
    totalPaid,
    transferTotal: roomTotal,
  }
}

export function parseCreditTransferBookingIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  }
  return []
}

export function validateBillTransferTargets(
  sourceBookingId: string,
  targets: CreditTransferBookingRow[],
  sourceAlreadyTransferred?: boolean
): string | null {
  if (targets.length === 0) return 'Select a checked-in room to receive this bill'
  if (targets.length > 1) return 'Select only one room to receive the transferred bill'
  if (sourceAlreadyTransferred) return 'This room bill was already transferred'
  const target = targets[0]
  if (target.id === sourceBookingId) {
    return 'Cannot transfer the bill to the same room'
  }
  if (target.status !== 'CHECKED_IN') {
    return `Room ${target.room.roomNumber} is not checked in`
  }
  return null
}

export function validateInboundBillTransfers(
  payingBookingId: string,
  sources: CreditTransferBookingRow[]
): string | null {
  for (const source of sources) {
    if (source.billTransferredToBookingId !== payingBookingId) {
      return `Room ${source.room.roomNumber} is not billed to this room`
    }
    if (source.status !== 'CHECKED_OUT') {
      return `Room ${source.room.roomNumber} must be checked out before its bill can be settled here`
    }
  }
  return null
}

export function computeTransferSourceSettlement(
  source: CreditTransferBookingRow,
  restaurantOrders: CheckoutSettlementParams['restaurantOrders'],
  payments: { amount: number; paymentType: string }[],
  asOf: Date
): CheckoutSettlementResult {
  return computeCheckoutSettlement({
    booking: source,
    nightlyRate: getRoomNightlyTotal(source.room),
    restaurantOrders,
    lateCheckoutCharge: 0,
    payments,
    discountEnabled: source.discountEnabled === true,
    discountType: source.discountType,
    discountValue: Number(source.discountValue) || 0,
    includeExtraCharges: true,
    damageChargeAmount: 0,
    asOf,
  })
}

export function mergeCreditTransferSettlements(
  primary: CheckoutSettlementResult,
  transfers: PreparedCreditTransfer[],
  options: {
    payingBooking: {
      id?: string
      vatApplied?: boolean | null
      vatPercent?: number | null
      discountEnabled?: boolean | null
      discountType?: string | null
      discountValue?: number | null
      checkIn?: Date
      checkOut?: Date
      customer?: { name?: string }
      room?: { roomNumber?: string; type?: { name?: string } }
    }
    discountEnabled: boolean
    discountType: string | null | undefined
    discountValue: number
    primaryPayments: { amount: number; paymentType: string }[]
  }
): CheckoutSettlementResult & {
  creditTransfers: CreditTransferPreviewLine[]
  roomFolios: CreditTransferPreviewLine[]
} {
  const allSettlements = [primary, ...transfers.map((t) => t.settlement)]

  const roomCharges = allSettlements.reduce((sum, s) => sum + s.roomCharges, 0)
  const extraCharges = allSettlements.reduce((sum, s) => sum + s.extraCharges, 0)
  const foodCharges = allSettlements.reduce((sum, s) => sum + s.foodCharges, 0)
  const damageCharge = primary.damageCharge
  const hotelBase = roomCharges + extraCharges
  const subtotal = hotelBase + foodCharges

  const vatOpts = bookingVatOptions(options.payingBooking)
  const vatApplied = vatOpts.vatApplied !== false
  const hotelVatRate = vatApplied ? Math.max(0, vatOpts.vatPercent ?? 0) : 0

  // Keep each room's own discount (source stay discount is not rewritten by the
  // paying room). Combined hotel VAT is the sum of each folio's hotel VAT.
  const discount = allSettlements.reduce((sum, s) => sum + Math.max(0, s.discount), 0)
  const restaurantVat = allSettlements.reduce((sum, s) => sum + s.restaurantVat, 0)
  const restaurantTotal = foodCharges + restaurantVat
  const taxableHotel = allSettlements.reduce(
    (sum, s) =>
      sum + taxableHotelAfterRoomDiscount(s.roomCharges, s.discount, s.extraCharges),
    0
  )
  const hotelVat = allSettlements.reduce((sum, s) => sum + s.hotelVat, 0)
  const vatAmount = hotelVat + restaurantVat
  const totalAmount = taxableHotel + hotelVat + restaurantTotal

  const allPayments = [
    ...options.primaryPayments,
    ...transfers.flatMap((t) => t.payments),
  ]
  const totalPaid = sumBookingNetPaid(allPayments)
  const dueBeforeSettlement = totalAmount - totalPaid
  const creditAmount = dueBeforeSettlement < 0 ? Math.abs(dueBeforeSettlement) : 0

  const primaryFolio = buildRoomFolioPreviewLine({
    bookingId: options.payingBooking.id ?? 'primary',
    roomNumber: options.payingBooking.room?.roomNumber ?? '—',
    roomTypeName: options.payingBooking.room?.type?.name ?? '—',
    customerName: options.payingBooking.customer?.name ?? '—',
    kind: 'primary',
    checkIn: options.payingBooking.checkIn ?? new Date(),
    checkOut: options.payingBooking.checkOut ?? new Date(),
    settlement: primary,
    booking: {
      discountEnabled: options.discountEnabled,
      discountType: options.discountType,
      discountValue: options.discountValue,
    },
    payments: options.primaryPayments,
  })

  const creditTransfers: CreditTransferPreviewLine[] = transfers.map((t) =>
    buildRoomFolioPreviewLine({
      bookingId: t.booking.id,
      roomNumber: t.booking.room.roomNumber,
      roomTypeName: t.booking.room.type.name,
      customerName: t.booking.customer.name,
      kind: 'transferred',
      checkIn: t.booking.checkIn,
      checkOut: t.booking.checkOut,
      settlement: t.settlement,
      booking: t.booking,
      payments: t.payments,
    })
  )

  return {
    ...primary,
    roomCharges,
    extraCharges,
    damageCharge,
    foodCharges,
    subtotal,
    discount,
    vatApplied,
    vatPercent: hotelVatRate,
    vatAmount,
    restaurantVat,
    hotelVat,
    totalAmount,
    totalPaid,
    dueBeforeSettlement: Math.max(0, dueBeforeSettlement),
    creditAmount,
    creditTransfers,
    roomFolios: [primaryFolio, ...creditTransfers],
  }
}

function roomDiscountLineDescription(
  roomNumber: string,
  discountLabel: string,
  transferred: boolean
): string {
  const body =
    discountLabel && discountLabel !== '—'
      ? `Hotel discount — Room ${roomNumber} (${discountLabel})`
      : `Hotel discount — Room ${roomNumber}`
  return transferred ? `Transferred — Room ${roomNumber}: ${body}` : body
}

export function buildCheckoutInvoiceLineItems(
  primary: {
    roomNumber: string
    roomTypeName: string
    checkIn: Date
    checkOut: Date
    charges: BuildInvoiceLineItemsInput['charges']
    restaurantOrders: BuildInvoiceLineItemsInput['restaurantOrders']
    roomCharges: number
    chargeableNights?: number
    nightlyRate?: number
    stayAdjusted?: boolean
    includeExtraCharges?: boolean
    discount: number
    discountLabel?: string
    hotelVat: number
  },
  transfers: PreparedCreditTransfer[],
  /** Combined hotel VAT (sum of room folios) — one summary line after all rooms. */
  combinedHotelVat: number,
  vatPercent: number,
  vatApplied: boolean
): InvoiceLineItemInput[] {
  const items: InvoiceLineItemInput[] = []

  items.push(
    ...buildInvoiceChargeLinesOnly({
      ...primary,
      hotelVatPercent: vatPercent,
      vatApplied,
    })
  )

  if (primary.discount > 0) {
    items.push({
      itemType: 'discount',
      description: roomDiscountLineDescription(
        primary.roomNumber,
        primary.discountLabel ?? '',
        false
      ),
      quantity: 1,
      unitPrice: -primary.discount,
      total: -primary.discount,
    })
  }

  for (const transfer of transfers) {
    const roomNumber = transfer.booking.room.roomNumber
    const prefix = `Transferred — Room ${roomNumber}`
    const nights = Math.max(1, transfer.settlement.chargeableNights || 1)
    const transferLines = buildInvoiceChargeLinesOnly({
      roomNumber,
      roomTypeName: transfer.booking.room.type.name,
      checkIn: transfer.booking.checkIn,
      checkOut: transfer.booking.checkOut,
      charges: transfer.booking.charges,
      restaurantOrders: transfer.restaurantOrdersWithItems,
      roomCharges: transfer.settlement.roomCharges,
      chargeableNights: transfer.settlement.chargeableNights,
      nightlyRate: transfer.settlement.nightlyRate,
      stayAdjusted: transfer.settlement.stayAdjusted,
      includeExtraCharges: true,
      hotelVatPercent: vatPercent,
      vatApplied,
    }).map((line) => {
      if (line.itemType === 'room_charge') {
        return {
          ...line,
          description: `Room ${roomNumber} (transferred)-${nights} nights`,
          quantity: nights,
        }
      }
      return {
        ...line,
        description: `${prefix}: ${line.description}`,
      }
    })
    items.push(...transferLines)

    const transferDiscount = Math.max(0, transfer.settlement.discount)
    if (transferDiscount > 0) {
      const meta = discountMetaFromBooking(transfer.booking)
      const discountLabel =
        meta.discountType === 'PERCENTAGE' && meta.discountValue > 0
          ? `${meta.discountValue}%`
          : meta.discountType === 'FIXED'
            ? 'Fixed'
            : 'Discount'
      items.push({
        itemType: 'discount',
        description: roomDiscountLineDescription(roomNumber, discountLabel, true),
        quantity: 1,
        unitPrice: -transferDiscount,
        total: -transferDiscount,
      })
    }
  }

  if (combinedHotelVat > 0) {
    const rateLabel = vatApplied ? ` (${vatPercent}%)` : ''
    items.push({
      itemType: 'vat_hotel',
      description: `Hotel VAT${rateLabel}`,
      quantity: 1,
      unitPrice: combinedHotelVat,
      total: combinedHotelVat,
    })
  }

  return items
}

type TransferDb = Pick<
  PrismaClient,
  | 'booking'
  | 'restaurantOrder'
  | 'payment'
  | 'room'
  | 'housekeepingTask'
  | 'roomCharge'
  | 'bookingCompanion'
  | 'invoice'
  | 'companyLedgerBill'
>

/** Prefix for placeholder charges posted on the receiving room until it checks out. */
export const BILL_TRANSFER_CHARGE_PREFIX = 'Bill transferred from Room '

export function isBillTransferPlaceholderCharge(description: string): boolean {
  return description.startsWith(BILL_TRANSFER_CHARGE_PREFIX)
}

export function buildBillTransferChargeDescription(
  sourceRoomNumber: string,
  guestName: string
): string {
  return `${BILL_TRANSFER_CHARGE_PREFIX}${sourceRoomNumber} — ${guestName}`
}

/**
 * Remove placeholder transfer charges before the receiving room's real checkout
 * settlement merges the source folios line-by-line (avoids double counting).
 */
export async function clearBillTransferPlaceholderCharges(
  db: TransferDb,
  payingBookingId: string
): Promise<void> {
  const charges = await db.roomCharge.findMany({
    where: { bookingId: payingBookingId, chargeType: 'EXTRA_SERVICE' },
    select: { id: true, description: true },
  })
  const ids = charges
    .filter((c) => isBillTransferPlaceholderCharge(c.description))
    .map((c) => c.id)
  if (ids.length === 0) return
  await db.roomCharge.deleteMany({ where: { id: { in: ids } } })
}

export async function loadBillTransferTargets(
  db: TransferDb,
  sourceBookingId: string,
  targetBookingIds: string[],
  sourceAlreadyTransferred = false
): Promise<{ targets: CreditTransferBookingRow[]; error: string | null }> {
  const uniqueIds = [...new Set(targetBookingIds.filter(Boolean))]
  if (uniqueIds.length === 0) {
    return { targets: [], error: null }
  }

  const targets = await db.booking.findMany({
    where: { id: { in: uniqueIds } },
    include: {
      customer: true,
      room: { include: { type: true } },
      charges: true,
    },
  })

  if (targets.length !== uniqueIds.length) {
    return { targets: [], error: 'Selected billing room was not found' }
  }

  const validationError = validateBillTransferTargets(
    sourceBookingId,
    targets as CreditTransferBookingRow[],
    sourceAlreadyTransferred
  )
  if (validationError) {
    return { targets: [], error: validationError }
  }

  return { targets: targets as CreditTransferBookingRow[], error: null }
}

export async function loadInboundBillTransfers(
  db: TransferDb,
  payingBookingId: string
): Promise<CreditTransferBookingRow[]> {
  const sources = await db.booking.findMany({
    where: {
      billTransferredToBookingId: payingBookingId,
      status: 'CHECKED_OUT',
    },
    include: {
      customer: true,
      room: { include: { type: true } },
      charges: true,
    },
  })

  return sources as CreditTransferBookingRow[]
}

export async function prepareCreditTransfers(
  db: TransferDb,
  sources: CreditTransferBookingRow[],
  asOf: Date
): Promise<PreparedCreditTransfer[]> {
  const prepared: PreparedCreditTransfer[] = []

  for (const source of sources) {
    const restaurantOrders = await db.restaurantOrder.findMany({
      where: { bookingId: source.id, status: { not: 'CANCELLED' } },
      include: {
        payments: { select: { amount: true, paymentType: true } },
      },
    })
    const restaurantOrdersWithItems = await db.restaurantOrder.findMany({
      where: { bookingId: source.id, status: { not: 'CANCELLED' } },
      include: {
        payments: { select: { amount: true, paymentType: true } },
        items: {
          include: { menuItem: { select: { name: true } } },
        },
      },
    })
    const payments = await db.payment.findMany({
      where: { bookingId: source.id },
      select: { amount: true, paymentType: true },
    })

    prepared.push({
      booking: source,
      settlement: computeTransferSourceSettlement(source, restaurantOrders, payments, asOf),
      restaurantOrders,
      restaurantOrdersWithItems,
      payments,
    })
  }

  return prepared
}

export async function completeOutboundBillTransfer(
  db: TransferDb,
  source: CreditTransferBookingRow,
  target: CreditTransferBookingRow,
  transferAmount: number,
  now: Date
): Promise<void> {
  const amount = Math.max(0, Number(transferAmount) || 0)
  const targetRoomNumber = target.room.roomNumber
  const sourceRoomNumber = source.room.roomNumber
  const guestName = source.customer.name.trim() || 'Guest'

  await db.booking.update({
    where: { id: source.id },
    data: {
      status: 'CHECKED_OUT',
      actualCheckOut: now,
      dueAmount: 0,
      billTransferredToBookingId: target.id,
      notes: source.notes
        ? `${source.notes}\nBill transferred to Room ${targetRoomNumber} at checkout`
        : `Bill transferred to Room ${targetRoomNumber} at checkout`,
    },
  })

  // Any folio invoice / company bill on the source stay would double-count on the
  // sales report once the receiving room settles the combined bill.
  await db.invoice.updateMany({
    where: {
      bookingId: source.id,
      status: { not: 'CANCELLED' },
    },
    data: {
      status: 'CANCELLED',
      dueAmount: 0,
    },
  })
  const sourceCompanyBills = await db.companyLedgerBill.findMany({
    where: { bookingId: source.id },
    select: { companyLedgerId: true },
  })
  await db.companyLedgerBill.updateMany({
    where: { bookingId: source.id },
    data: {
      // Drop bill totals so company ledger aggregates do not keep a phantom due
      // after the stay balance moves to the receiving room.
      totalAmount: 0,
      dueAmount: 0,
      paidAmount: 0,
      settlementStage: 'HOTEL_CLEARED',
      hotelClearedAt: now,
      notes: `Cleared — bill transferred to Room ${targetRoomNumber}`,
    },
  })
  const ledgerIds = [
    ...new Set(sourceCompanyBills.map((b) => b.companyLedgerId).filter(Boolean)),
  ]
  for (const companyLedgerId of ledgerIds) {
    await recomputeCompanyLedgerTotals(db, companyLedgerId)
  }

  await db.room.update({
    where: { id: source.roomId },
    data: { status: 'CLEANING' },
  })

  await db.housekeepingTask.create({
    data: {
      roomId: source.roomId,
      taskType: 'cleaning',
      status: 'PENDING',
      notes: `Post-checkout cleaning for room ${sourceRoomNumber} (bill transferred to Room ${targetRoomNumber})`,
    },
  })

  if (amount > 0.005) {
    await db.roomCharge.create({
      data: {
        bookingId: target.id,
        chargeType: 'EXTRA_SERVICE',
        description: buildBillTransferChargeDescription(sourceRoomNumber, guestName),
        amount,
        quantity: 1,
        chargeDate: now,
      },
    })
  }

  const existingCompanions = await db.bookingCompanion.count({
    where: { bookingId: target.id },
  })
  const sourcePhone = source.customer.phone?.trim() || null
  const alreadyListed = await db.bookingCompanion.findFirst({
    where: {
      bookingId: target.id,
      name: guestName,
      ...(sourcePhone ? { phone: sourcePhone } : {}),
    },
    select: { id: true },
  })

  if (!alreadyListed && guestName) {
    await db.bookingCompanion.create({
      data: {
        bookingId: target.id,
        sortOrder: existingCompanions,
        companionType: 'ADULT',
        name: guestName,
        company: source.customer.company?.trim() || null,
        designation: source.customer.designation?.trim() || null,
        phone: sourcePhone,
        nationality: source.customer.nationality?.trim() || null,
        idType: source.customer.idType?.trim() || null,
        idNumber: source.customer.idNumber?.trim() || null,
        registrationNumber: source.customer.registrationNumber?.trim() || null,
        email: source.customer.email?.trim() || null,
        address: source.customer.address?.trim() || null,
      },
    })
  }

  const targetAdults = Math.max(1, Number(target.adults) || 1)
  const nextAdults = alreadyListed ? targetAdults : Math.max(targetAdults + 1, 2)
  const transferNote = `Received bill from Room ${sourceRoomNumber} (${guestName}) — ৳${amount.toFixed(2)}`

  // Recompute due from discounted room + all posted extras (incl. this transfer).
  // Adding transferAmount onto a stale undiscounted dueAmount caused 18000+12600=30600.
  const targetPayments = await db.payment.findMany({
    where: { bookingId: target.id },
    select: { amount: true, paymentType: true },
  })
  const targetCharges = await db.roomCharge.findMany({
    where: { bookingId: target.id },
    select: { chargeType: true, amount: true, quantity: true },
  })
  const roomDue = computeRoomBookingTotals(
    Number(target.totalRoomCharge) || 0,
    sumBookingNetPaid(targetPayments),
    bookingVatOptions(target),
    {
      discountEnabled: target.discountEnabled === true,
      discountType: target.discountType ?? undefined,
      discountValue: target.discountValue ?? 0,
      checkIn: target.checkIn,
      checkOut: target.checkOut,
      totalRoomCharge: target.totalRoomCharge,
    }
  ).dueAmount
  const extrasTotal = targetCharges
    .filter((c) => c.chargeType !== 'ROOM_RATE')
    .reduce((sum, c) => sum + c.amount * (c.quantity || 1), 0)
  const nextDue = Math.max(0, roomDue + extrasTotal)

  await db.booking.update({
    where: { id: target.id },
    data: {
      adults: nextAdults,
      dueAmount: nextDue,
      notes: target.notes ? `${target.notes}\n${transferNote}` : transferNote,
    },
  })
}

export type BillTransferOutPreview = {
  billTransferOut: true
  billTransferTarget: {
    bookingId: string
    roomNumber: string
    roomTypeName: string
    customerName: string
  }
  transferAmount: number
}
