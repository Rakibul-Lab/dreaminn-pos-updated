import type { PrismaClient } from '@prisma/client'
import { computeHotelDiscountAmount, parseBookingDiscountType, taxableHotelAfterRoomDiscount } from '@/lib/booking-discount'
import { bookingVatOptions, sumBookingNetPaid } from '@/lib/booking-totals'
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

export type CreditTransferBookingRow = {
  id: string
  status: string
  billTransferredToBookingId?: string | null
  roomId: string
  checkIn: Date
  checkOut: Date
  actualCheckIn: Date | null
  totalRoomCharge: number
  vatApplied?: boolean | null
  vatPercent?: number | null
  discountEnabled?: boolean | null
  discountType?: string | null
  discountValue?: number | null
  notes?: string | null
  customer: { name: string }
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
  roomCharges: number
  foodCharges: number
  extraCharges: number
  transferTotal: number
}

export type PreparedCreditTransfer = {
  booking: CreditTransferBookingRow
  settlement: CheckoutSettlementResult
  restaurantOrders: CheckoutSettlementParams['restaurantOrders']
  restaurantOrdersWithItems: BuildInvoiceLineItemsInput['restaurantOrders']
  payments: { amount: number; paymentType: string }[]
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
    payingBooking: { vatApplied?: boolean | null; vatPercent?: number | null }
    discountEnabled: boolean
    discountType: string | null | undefined
    discountValue: number
    primaryPayments: { amount: number; paymentType: string }[]
  }
): CheckoutSettlementResult & { creditTransfers: CreditTransferPreviewLine[] } {
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
  // Paying-room discount applies to combined room charges only — not damage/extras.
  // A fixed discount repeats over the paying room's own billed nights.
  const discount = computeHotelDiscountAmount(
    roomCharges,
    options.discountEnabled,
    parseBookingDiscountType(options.discountType),
    options.discountValue,
    primary.chargeableNights
  )
  const restaurantVat = allSettlements.reduce((sum, s) => sum + s.restaurantVat, 0)
  const restaurantTotal = foodCharges + restaurantVat
  const taxableHotel = taxableHotelAfterRoomDiscount(roomCharges, discount, extraCharges)
  const hotelVat = hotelVatRate > 0 ? (taxableHotel * hotelVatRate) / 100 : 0
  const vatAmount = hotelVat + restaurantVat
  const totalAmount = taxableHotel + hotelVat + restaurantTotal

  const allPayments = [
    ...options.primaryPayments,
    ...transfers.flatMap((t) => t.payments),
  ]
  const totalPaid = sumBookingNetPaid(allPayments)
  const dueBeforeSettlement = totalAmount - totalPaid
  const creditAmount = dueBeforeSettlement < 0 ? Math.abs(dueBeforeSettlement) : 0

  const creditTransfers: CreditTransferPreviewLine[] = transfers.map((t) => ({
    bookingId: t.booking.id,
    roomNumber: t.booking.room.roomNumber,
    roomTypeName: t.booking.room.type.name,
    customerName: t.booking.customer.name,
    roomCharges: t.settlement.roomCharges,
    foodCharges: t.settlement.foodCharges,
    extraCharges: t.settlement.extraCharges,
    transferTotal:
      t.settlement.roomCharges +
      t.settlement.extraCharges +
      t.settlement.foodCharges +
      t.settlement.restaurantVat,
  }))

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
  }
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
  },
  transfers: PreparedCreditTransfer[],
  discount: number,
  hotelVat: number,
  vatPercent: number,
  vatApplied: boolean
): InvoiceLineItemInput[] {
  const items: InvoiceLineItemInput[] = buildInvoiceChargeLinesOnly({
    ...primary,
    hotelVatPercent: vatPercent,
    vatApplied,
  })

  for (const transfer of transfers) {
    const prefix = `Transferred — Room ${transfer.booking.room.roomNumber}`
    const transferLines = buildInvoiceChargeLinesOnly({
      roomNumber: transfer.booking.room.roomNumber,
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
    }).map((line) => ({
      ...line,
      description: `${prefix}: ${line.description}`,
    }))
    items.push(...transferLines)
  }

  if (discount > 0) {
    items.push({
      itemType: 'discount',
      description: 'Hotel discount',
      quantity: 1,
      unitPrice: -discount,
      total: -discount,
    })
  }

  if (hotelVat > 0) {
    const rateLabel = vatApplied ? ` (${vatPercent}%)` : ''
    items.push({
      itemType: 'vat_hotel',
      description: `Hotel VAT${rateLabel}`,
      quantity: 1,
      unitPrice: hotelVat,
      total: hotelVat,
    })
  }

  return items
}

type TransferDb = Pick<
  PrismaClient,
  'booking' | 'restaurantOrder' | 'payment' | 'room' | 'housekeepingTask'
>

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
  targetBookingId: string,
  targetRoomNumber: string,
  now: Date
): Promise<void> {
  await db.booking.update({
    where: { id: source.id },
    data: {
      status: 'CHECKED_OUT',
      actualCheckOut: now,
      dueAmount: 0,
      billTransferredToBookingId: targetBookingId,
      notes: source.notes
        ? `${source.notes}\nBill transferred to Room ${targetRoomNumber} at checkout`
        : `Bill transferred to Room ${targetRoomNumber} at checkout`,
    },
  })

  await db.room.update({
    where: { id: source.roomId },
    data: { status: 'CLEANING' },
  })

  await db.housekeepingTask.create({
    data: {
      roomId: source.roomId,
      taskType: 'cleaning',
      status: 'PENDING',
      notes: `Post-checkout cleaning for room ${source.room.roomNumber} (bill transferred to Room ${targetRoomNumber})`,
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
