import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { successResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils'
import { RoleType } from '@prisma/client'
import { getEarlyCheckoutSettings } from '@/lib/app-settings'
import { getRoomNightlyTotal } from '@/lib/room-pricing'
import { sumBookingNetPaid } from '@/lib/booking-totals'
import {
  computeStayAdjustmentPreview,
  defaultChargeableUntilDate,
  parseStayAdjustmentBody,
  type StayAdjustmentInput,
  type StayAdjustmentPreview,
} from '@/lib/stay-adjustment'
import {
  countActualStayNights,
  countBookedNights,
  getStayAdjustmentAvailability,
} from '@/lib/booking-stay'
import { buildInvoiceLineItems, replaceInvoiceLineItems } from '@/lib/invoice-line-items'
import { computeCheckoutSettlement } from '@/lib/checkout-settlement'

async function loadBooking(id: string) {
  return db.booking.findUnique({
    where: { id },
    include: {
      room: { include: { type: true } },
      customer: true,
      charges: true,
      payments: { select: { amount: true, paymentType: true } },
    },
  })
}

async function previewForBooking(
  booking: NonNullable<Awaited<ReturnType<typeof loadBooking>>>,
  settings: StayAdjustmentInput
) {
  const defaults = await getEarlyCheckoutSettings()
  const merged: StayAdjustmentInput = {
    ...settings,
    earlyCheckoutPercent:
      settings.earlyCheckoutPercent > 0 ? settings.earlyCheckoutPercent : defaults.feePercent,
    earlyCheckoutAmount:
      settings.earlyCheckoutAmount > 0 ? settings.earlyCheckoutAmount : defaults.feeAmount,
  }

  const previewResult = computeStayAdjustmentPreview({
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    actualCheckIn: booking.actualCheckIn,
    vatApplied: booking.vatApplied,
    vatPercent: booking.vatPercent,
    nightlyRate: getRoomNightlyTotal(booking.room),
    payments: booking.payments,
    settings: merged,
  })

  return { preview: previewResult, defaults, settings: merged }
}

function parseSettingsFromRequest(
  searchParams: URLSearchParams | null,
  body: Record<string, unknown> | null,
  defaults: { feePercent: number; feeAmount: number }
): StayAdjustmentInput {
  const src = body ?? Object.fromEntries(searchParams?.entries() ?? [])
  const parsed = parseStayAdjustmentBody(src as Record<string, unknown>)
  return {
    ...parsed,
    earlyCheckoutPercent:
      parsed.earlyCheckoutPercent > 0 ? parsed.earlyCheckoutPercent : defaults.feePercent,
    earlyCheckoutAmount:
      parsed.earlyCheckoutAmount > 0 ? parsed.earlyCheckoutAmount : defaults.feeAmount,
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
 authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType)
    if (authResult instanceof Response) return authResult

    const { id } = await params
    const booking = await loadBooking(id)
    if (!booking) return notFoundResponse('Booking')
    if (booking.status !== 'CHECKED_IN') {
      return errorResponse('Stay adjustment is only available for checked-in guests')
    }

    const defaults = await getEarlyCheckoutSettings()
    const settings = parseSettingsFromRequest(new URL(request.url).searchParams, null, defaults)
    const searchParams = new URL(request.url).searchParams
    const availability = getStayAdjustmentAvailability(
      booking.checkIn,
      booking.checkOut,
      new Date(),
      booking.actualCheckIn
    )

    if (!searchParams.has('chargeableUntilDate')) {
      let mode = settings.stayMode
      if (mode === 'shrink' && !availability.canEarlyDeparture) {
        mode = availability.canExtend ? 'extend' : 'shrink'
      }
      if (mode === 'extend' && !availability.canExtend) {
        mode = availability.canEarlyDeparture ? 'shrink' : 'extend'
      }
      settings.stayMode = mode
      settings.chargeableUntilDate = defaultChargeableUntilDate(
        booking.checkIn,
        booking.checkOut,
        booking.actualCheckIn,
        mode
      )
    }

    if (!availability.canEarlyDeparture && !availability.canExtend) {
      return successResponse({
        bookingId: id,
        customerName: booking.customer.name,
        roomNumber: booking.room.roomNumber,
        roomTypeName: booking.room.type.name,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        scheduledCheckIn: booking.checkIn,
        scheduledCheckOut: booking.checkOut,
        defaultEarlyCheckoutPercent: defaults.feePercent,
        defaultEarlyCheckoutAmount: defaults.feeAmount,
        canEarlyDeparture: false,
        canExtend: false,
        earlyDepartureDisabledReason: availability.earlyDepartureDisabledReason,
        extendDisabledReason: availability.extendDisabledReason,
        adjustmentUnavailable: true,
        bookedNights: countBookedNights(booking.checkIn, booking.checkOut),
        actualStayNights: countActualStayNights(booking.actualCheckIn ?? booking.checkIn),
        chargeableNights: 0,
        waivedNights: 0,
        chargeableUntilDate: '',
        minDepartureDate: '',
        maxDepartureDate: '',
        minExtendDate: '',
        nightlyRate: getRoomNightlyTotal(booking.room),
        bookedRoomCharge: booking.totalRoomCharge,
        roomCharge: 0,
        earlyCheckoutFee: 0,
        roomSubtotal: 0,
        vatPercent: booking.vatPercent ?? 0,
        vatApplied: booking.vatApplied,
        vatAmount: 0,
        totalWithVat: 0,
        totalPaid: sumBookingNetPaid(booking.payments),
        dueAmount: booking.dueAmount,
        isEarlyDeparture: false,
      })
    }

    const result = await previewForBooking(booking, settings)
    if ('error' in result.preview) {
      return errorResponse(result.preview.error)
    }

    const preview = result.preview as StayAdjustmentPreview

    return successResponse({
      bookingId: id,
      customerName: booking.customer.name,
      roomNumber: booking.room.roomNumber,
      roomTypeName: booking.room.type.name,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      defaultEarlyCheckoutPercent: defaults.feePercent,
      defaultEarlyCheckoutAmount: defaults.feeAmount,
      ...preview,
    })
  } catch (error) {
    console.error('Adjust-stay preview error:', error)
    return errorResponse('Failed to load stay adjustment preview', 500)
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
 authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType)
    if (authResult instanceof Response) return authResult

    const { id } = await params
    const body = await request.json()
    const defaults = await getEarlyCheckoutSettings()
    const settings = parseSettingsFromRequest(null, body, defaults)

    const booking = await loadBooking(id)
    if (!booking) return notFoundResponse('Booking')
    if (booking.status !== 'CHECKED_IN') {
      return errorResponse('Stay adjustment is only available for checked-in guests')
    }

    const availability = getStayAdjustmentAvailability(
      booking.checkIn,
      booking.checkOut,
      new Date(),
      booking.actualCheckIn
    )
    if (!availability.canEarlyDeparture && !availability.canExtend) {
      return errorResponse(
        availability.extendDisabledReason ??
          availability.earlyDepartureDisabledReason ??
          'Stay adjustment is not available for this reservation'
      )
    }

    const result = await previewForBooking(booking, settings)
    if ('error' in result.preview) {
      return errorResponse(result.preview.error)
    }
    const preview = result.preview as StayAdjustmentPreview
    const nightlyRate = getRoomNightlyTotal(booking.room)
    const now = new Date()

    const roomDateLabel =
      preview.stayMode === 'shrink'
        ? `departure ${preview.chargeableUntilDate}`
        : `checkout through ${preview.chargeableUntilDate}`

    await db.$transaction(async (tx) => {
      await tx.roomCharge.deleteMany({
        where: {
          bookingId: id,
          chargeType: { in: ['ROOM_RATE', 'EARLY_CHECKOUT'] },
        },
      })

      await tx.roomCharge.create({
        data: {
          bookingId: id,
          chargeType: 'ROOM_RATE',
          description: `Room ${booking.room.roomNumber} (${booking.room.type.name}) – ${preview.chargeableNights} night(s), ${roomDateLabel}`,
          amount: nightlyRate,
          quantity: preview.chargeableNights,
          chargeDate: now,
        },
      })

      if (preview.earlyCheckoutFee > 0) {
        await tx.roomCharge.create({
          data: {
            bookingId: id,
            chargeType: 'EARLY_CHECKOUT',
            description: `Early checkout fee (${preview.waivedNights} waived night${preview.waivedNights > 1 ? 's' : ''})`,
            amount: preview.earlyCheckoutFee,
            quantity: 1,
            chargeDate: now,
          },
        })
      }

      await tx.booking.update({
        where: { id },
        data: {
          totalRoomCharge: preview.roomCharge,
          dueAmount: preview.dueAmount,
        },
      })
    })

    const updatedBooking = await loadBooking(id)
    if (!updatedBooking) return notFoundResponse('Booking')

    const existingInvoice = await db.invoice.findFirst({
      where: { bookingId: id, status: { not: 'CANCELLED' } },
    })

    let invoiceId: string | null = null
    if (existingInvoice) {
      const restaurantOrders = await db.restaurantOrder.findMany({
        where: { bookingId: id, status: { not: 'CANCELLED' } },
      })
      const restaurantOrdersWithItems = await db.restaurantOrder.findMany({
        where: { bookingId: id, status: { not: 'CANCELLED' } },
        include: { items: { include: { menuItem: { select: { name: true } } } } },
      })

      const settlement = computeCheckoutSettlement({
        booking: { ...updatedBooking, charges: updatedBooking.charges },
        nightlyRate,
        restaurantOrders,
        lateCheckoutCharge: 0,
        payments: updatedBooking.payments,
        discountEnabled: updatedBooking.discountEnabled === true,
        discountType: updatedBooking.discountType,
        discountValue: updatedBooking.discountValue,
        includeExtraCharges: true,
        asOf: now,
      })

      const paidAmount = sumBookingNetPaid(updatedBooking.payments)
      const invoiceDue = Math.max(0, settlement.totalAmount - paidAmount)

      const lineItems = buildInvoiceLineItems({
        roomNumber: updatedBooking.room.roomNumber,
        roomTypeName: updatedBooking.room.type.name,
        checkIn: updatedBooking.checkIn,
        checkOut: updatedBooking.checkOut,
        charges: updatedBooking.charges,
        restaurantOrders: restaurantOrdersWithItems,
        roomCharges: settlement.roomCharges,
        chargeableNights: preview.chargeableNights,
        nightlyRate,
        stayAdjusted: preview.chargeableNights !== preview.bookedNights,
        includeExtraCharges: true,
        discount: settlement.discount,
        hotelVat: settlement.hotelVat,
        hotelVatPercent: settlement.vatPercent,
        vatApplied: settlement.vatApplied,
        restaurantVat: settlement.restaurantVat,
      })

      await db.$transaction(async (tx) => {
        await tx.invoice.update({
          where: { id: existingInvoice.id },
          data: {
            roomCharges: settlement.roomCharges,
            foodCharges: settlement.foodCharges,
            extraCharges: settlement.extraCharges,
            subtotal: settlement.subtotal,
            discount: settlement.discount,
            vatAmount: settlement.vatAmount,
            totalAmount: settlement.totalAmount,
            paidAmount,
            dueAmount: invoiceDue,
          },
        })
        await replaceInvoiceLineItems(tx, existingInvoice.id, lineItems)
      })
      invoiceId = existingInvoice.id
    }

    await logActivity(
      authResult.id,
      'STAY_ADJUSTED',
      'hotel',
      JSON.stringify({
        bookingId: id,
        chargeableNights: preview.chargeableNights,
        earlyCheckoutFee: preview.earlyCheckoutFee,
        dueAmount: preview.dueAmount,
        invoiceId,
      })
    )

    return successResponse(
      {
        booking: updatedBooking,
        preview,
        invoiceId,
      },
      'Stay and charges updated'
    )
  } catch (error) {
    console.error('Adjust-stay apply error:', error)
    return errorResponse('Failed to apply stay adjustment', 500)
  }
}
