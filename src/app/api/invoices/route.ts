import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, paginatedResponse, notFoundResponse, logActivity, generateInvoiceNumber } from '@/lib/api-utils';
import { InvoiceStatus } from '@prisma/client';
import { bookingVatOptions, sumBookingNetPaid } from '@/lib/booking-totals';
import {
  buildInvoiceLineItems,
  buildManualInvoiceLineItems,
  replaceInvoiceLineItems,
} from '@/lib/invoice-line-items';
import {
  computeHotelDiscountAmount,
  parseBookingDiscountType,
  resolveBilledDiscountNights,
  resolveDiscountNights,
  taxableHotelAfterRoomDiscount,
} from '@/lib/booking-discount';
import { resolveInvoiceBooking } from '@/lib/invoice-booking-resolve';
import { getRoomNightlyTotal } from '@/lib/room-pricing';
import { isStayDatetimeRangeValid } from '@/lib/hotel-times';
import { stampCurrentBusinessDate } from '@/lib/business-date';
import { filterGuestFolioRestaurantOrders } from '@/lib/restaurant-order-billing';
import { computeCheckoutSettlement } from '@/lib/checkout-settlement';
import {
  buildCheckoutInvoiceLineItems,
  isBillTransferPlaceholderCharge,
  loadInboundBillTransfers,
  mergeCreditTransferSettlements,
  prepareCreditTransfers,
} from '@/lib/room-credit-transfer';

function parseOptionalAmount(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = parseFloat(String(value));
  return Number.isNaN(parsed) ? undefined : Math.max(0, parsed);
}

// GET /api/invoices - List invoices with filters
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN', 'HOTEL_STAFF', 'HOTEL_FD');
    if (authResult instanceof Response) return authResult;

    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const bookingId = searchParams.get('bookingId');
    const status = searchParams.get('status') as InvoiceStatus | null;

    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (bookingId) {
      where.bookingId = bookingId;
    }

    if (status) {
      where.status = status;
    }

    const [invoices, total] = await Promise.all([
      db.invoice.findMany({
        where,
        include: {
          booking: {
            select: {
              id: true,
              checkIn: true,
              checkOut: true,
              status: true,
              customer: {
                select: { id: true, name: true, phone: true, email: true },
              },
              room: {
                select: { id: true, roomNumber: true, type: { select: { name: true } } },
              },
            },
          },
          items: {
            select: {
              id: true,
              itemType: true,
              description: true,
              quantity: true,
              unitPrice: true,
              total: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.invoice.count({ where }),
    ]);

    return paginatedResponse(invoices, total, page, limit);
  } catch (error) {
    console.error('Error listing invoices:', error);
    return errorResponse('Failed to fetch invoices', 500);
  }
}

// POST /api/invoices - Generate invoice (auto or manual amounts / guest fields)
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN', 'HOTEL_STAFF', 'HOTEL_FD');
    if (authResult instanceof Response) return authResult;

    const user = authResult;
    const body = await request.json();
    const { bookingId: bookingIdInput, roomId, guest } = body;

    const roomChargesOverride = parseOptionalAmount(body.roomCharges);
    const foodChargesOverride = parseOptionalAmount(body.foodCharges);
    const serviceChargesOverride = parseOptionalAmount(body.extraCharges ?? body.serviceCharges);
    const discountOverride = parseOptionalAmount(body.discount);
    const vatPercentOverride = parseOptionalAmount(body.vatPercent);
    const paidAmountOverride = parseOptionalAmount(body.paidAmount);

    let stayCheckIn: Date | undefined;
    let stayCheckOut: Date | undefined;
    if (body.checkIn && body.checkOut) {
      stayCheckIn = new Date(body.checkIn);
      stayCheckOut = new Date(body.checkOut);
      if (
        Number.isNaN(stayCheckIn.getTime()) ||
        Number.isNaN(stayCheckOut.getTime()) ||
        !isStayDatetimeRangeValid(stayCheckIn, stayCheckOut)
      ) {
        return errorResponse('Check-out must be after check-in');
      }
    }

    const manualMode =
      roomChargesOverride !== undefined ||
      foodChargesOverride !== undefined ||
      serviceChargesOverride !== undefined ||
      discountOverride !== undefined ||
      vatPercentOverride !== undefined ||
      paidAmountOverride !== undefined ||
      !!guest ||
      !!stayCheckIn;

    let booking;
    if (bookingIdInput) {
      booking = await db.booking.findUnique({
        where: { id: bookingIdInput },
        include: {
          customer: true,
          room: {
            include: { type: true },
          },
          charges: true,
          payments: true,
        },
      });

      if (!booking) {
        return notFoundResponse('Booking');
      }

      if (guest && typeof guest === 'object') {
        const customerUpdate: Record<string, unknown> = {};
        if (guest.name !== undefined) customerUpdate.name = String(guest.name || '').trim();
        if (guest.phone !== undefined) customerUpdate.phone = String(guest.phone || '').trim();
        if (guest.email !== undefined) customerUpdate.email = guest.email?.trim() || null;
        if (guest.address !== undefined) customerUpdate.address = guest.address?.trim() || null;
        if (guest.nationality !== undefined) customerUpdate.nationality = guest.nationality?.trim() || null;
        if (guest.idNumber !== undefined) customerUpdate.idNumber = guest.idNumber?.trim() || null;
        if (guest.registrationNumber !== undefined) {
          customerUpdate.registrationNumber = guest.registrationNumber?.trim() || null;
        }
        if (Object.keys(customerUpdate).length > 0) {
          await db.customer.update({
            where: { id: booking.customerId },
            data: customerUpdate,
          });
          Object.assign(booking.customer, customerUpdate);
        }
      }

      if (stayCheckIn && stayCheckOut) {
        booking = await db.booking.update({
          where: { id: booking.id },
          data: { checkIn: stayCheckIn, checkOut: stayCheckOut },
          include: {
            customer: true,
            room: { include: { type: true } },
            charges: true,
            payments: true,
          },
        });
      }
    } else if (
      roomId &&
      stayCheckIn &&
      stayCheckOut &&
      guest &&
      typeof guest === 'object' &&
      String(guest.name || '').trim() &&
      String(guest.phone || '').trim()
    ) {
      try {
        booking = await resolveInvoiceBooking({
          roomId: String(roomId),
          checkIn: stayCheckIn,
          checkOut: stayCheckOut,
          guest: {
            name: String(guest.name).trim(),
            phone: String(guest.phone).trim(),
            email: guest.email,
            address: guest.address,
            nationality: guest.nationality,
            idNumber: guest.idNumber,
            registrationNumber: guest.registrationNumber,
          },
          roomCharges: roomChargesOverride ?? 0,
          userId: user.id,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to resolve booking';
        return errorResponse(message);
      }
    } else {
      return errorResponse('Room, check-in, check-out, and guest name/phone are required');
    }

    const bookingId = booking.id;
    const invoiceCheckIn = stayCheckIn ?? booking.checkIn;
    const invoiceCheckOut = stayCheckOut ?? booking.checkOut;

    const existingInvoice = await db.invoice.findFirst({
      where: {
        bookingId,
        status: { not: 'CANCELLED' },
      },
    });

    const individualRoomCharges = booking.charges
      .filter((c) => c.chargeType === 'ROOM_RATE')
      .reduce((sum, c) => sum + c.amount * c.quantity, 0);

    // Placeholder "Bill transferred from Room …" rows only keep due visible while
    // in-house. Invoice must expand the real source folio (rent + its discount).
    const chargesForInvoice = booking.charges.filter(
      (c) => !isBillTransferPlaceholderCharge(c.description)
    );

    const autoExtraCharges = chargesForInvoice
      .filter((c) => c.chargeType !== 'ROOM_RATE')
      .reduce((sum, c) => sum + c.amount * c.quantity, 0);

    const autoRoomCharges =
      booking.totalRoomCharge > 0 ? booking.totalRoomCharge : individualRoomCharges;

    const allRestaurantOrders = await db.restaurantOrder.findMany({
      where: {
        bookingId,
        status: { not: 'CANCELLED' },
      },
      include: {
        items: {
          include: {
            menuItem: { select: { name: true } },
          },
        },
        payments: { select: { amount: true, paymentType: true } },
        companyLedgerBill: { select: { id: true } },
      },
    });

    const restaurantOrders = filterGuestFolioRestaurantOrders(allRestaurantOrders);

    const autoRestaurantNet = restaurantOrders.reduce(
      (sum, order) => sum + Math.max(0, order.subtotal - order.discount),
      0
    );
    const restaurantVat = restaurantOrders.reduce((sum, order) => sum + order.vatAmount, 0);
    const restaurantTotal = restaurantOrders.reduce((sum, order) => sum + order.totalAmount, 0);

    const now = new Date();
    const inboundSources = await loadInboundBillTransfers(db, bookingId);
    const inboundTransfers =
      !manualMode && inboundSources.length > 0
        ? await prepareCreditTransfers(db, inboundSources, now)
        : [];
    const hasInboundTransfers = inboundTransfers.length > 0;

    let roomCharges = roomChargesOverride ?? autoRoomCharges;
    let foodCharges = foodChargesOverride ?? autoRestaurantNet;
    let extraCharges = serviceChargesOverride ?? (manualMode ? 0 : autoExtraCharges);

    const vatOpts = bookingVatOptions(booking);
    const vatApplied = vatOpts.vatApplied !== false;
    let vatPercent =
      vatPercentOverride !== undefined
        ? vatPercentOverride
        : vatApplied
          ? Math.max(0, vatOpts.vatPercent ?? 0)
          : 0;

    let discount =
      discountOverride !== undefined
        ? Math.min(Math.max(0, discountOverride), Math.max(0, roomCharges))
        : computeHotelDiscountAmount(
            roomCharges,
            booking.discountEnabled === true,
            parseBookingDiscountType(booking.discountType),
            Number(booking.discountValue) || 0,
            resolveBilledDiscountNights(
              roomCharges,
              getRoomNightlyTotal(booking.room),
              resolveDiscountNights({ checkIn: invoiceCheckIn, checkOut: invoiceCheckOut })
            )
          );

    let hotelVat = 0;
    let vatAmount = 0;
    let subtotal = 0;
    let totalAmount = 0;
    let lineItems;

    if (hasInboundTransfers) {
      const bookingPayments = await db.payment.findMany({
        where: { bookingId },
        select: { amount: true, paymentType: true },
      });
      const primarySettlement = computeCheckoutSettlement({
        booking: { ...booking, charges: chargesForInvoice },
        nightlyRate: getRoomNightlyTotal(booking.room),
        restaurantOrders: allRestaurantOrders,
        lateCheckoutCharge: 0,
        payments: bookingPayments,
        discountEnabled: booking.discountEnabled === true,
        discountType: booking.discountType,
        discountValue: Number(booking.discountValue) || 0,
        includeExtraCharges: true,
        damageChargeAmount: 0,
        roomChargeOverride: roomChargesOverride ?? null,
        asOf: now,
      });
      const settlement = mergeCreditTransferSettlements(primarySettlement, inboundTransfers, {
        payingBooking: booking,
        discountEnabled: booking.discountEnabled === true,
        discountType: booking.discountType,
        discountValue: Number(booking.discountValue) || 0,
        primaryPayments: bookingPayments,
      });

      roomCharges = settlement.roomCharges;
      foodCharges = foodChargesOverride ?? settlement.foodCharges;
      extraCharges = serviceChargesOverride ?? settlement.extraCharges;
      discount = discountOverride !== undefined ? discountOverride : settlement.discount;
      hotelVat = settlement.hotelVat;
      vatAmount = settlement.vatAmount;
      vatPercent = settlement.vatPercent;
      subtotal = settlement.subtotal;
      totalAmount = settlement.totalAmount;

      const primaryDiscountLabel =
        booking.discountEnabled && Number(booking.discountValue) > 0
          ? parseBookingDiscountType(booking.discountType) === 'FIXED'
            ? 'Fixed'
            : `${Number(booking.discountValue)}%`
          : undefined;

      lineItems = buildCheckoutInvoiceLineItems(
        {
          roomNumber: booking.room.roomNumber,
          roomTypeName: booking.room.type?.name || '',
          checkIn: invoiceCheckIn,
          checkOut: invoiceCheckOut,
          charges: chargesForInvoice,
          restaurantOrders: allRestaurantOrders,
          roomCharges: primarySettlement.roomCharges,
          chargeableNights: primarySettlement.chargeableNights,
          nightlyRate: primarySettlement.nightlyRate,
          stayAdjusted: primarySettlement.stayAdjusted,
          includeExtraCharges: true,
          discount: primarySettlement.discount,
          discountLabel: primaryDiscountLabel,
          hotelVat: primarySettlement.hotelVat,
        },
        inboundTransfers,
        hotelVat,
        vatPercent,
        vatPercent > 0
      );
    } else {
      const hotelBase = roomCharges + extraCharges;
      const taxableHotel = taxableHotelAfterRoomDiscount(roomCharges, discount, extraCharges);
      hotelVat = vatPercent > 0 ? (taxableHotel * vatPercent) / 100 : 0;
      vatAmount = manualMode ? hotelVat : hotelVat + restaurantVat;
      subtotal = hotelBase + foodCharges;
      totalAmount = manualMode
        ? taxableHotel + hotelVat + foodCharges
        : taxableHotel + hotelVat + restaurantTotal;

      lineItems = manualMode
        ? buildManualInvoiceLineItems({
            roomNumber: booking.room.roomNumber,
            roomTypeName: booking.room.type?.name || '',
            checkIn: invoiceCheckIn,
            checkOut: invoiceCheckOut,
            roomCharges,
            foodCharges,
            serviceCharges: extraCharges,
            discount,
            hotelVat,
            hotelVatPercent: vatPercent,
            vatApplied: vatPercent > 0,
          })
        : buildInvoiceLineItems({
            roomNumber: booking.room.roomNumber,
            roomTypeName: booking.room.type?.name || '',
            checkIn: invoiceCheckIn,
            checkOut: invoiceCheckOut,
            charges: chargesForInvoice,
            restaurantOrders,
            roomCharges,
            includeExtraCharges: true,
            discount,
            hotelVat,
            hotelVatPercent: vatPercent,
            vatApplied: vatPercent > 0,
            restaurantVat,
          });
    }

    const paidAmount =
      paidAmountOverride !== undefined
        ? paidAmountOverride
        : sumBookingNetPaid(
            hasInboundTransfers
              ? [
                  ...(booking.payments ?? []),
                  ...inboundTransfers.flatMap((t) => t.payments),
                ]
              : booking.payments
          );
    const dueAmount = totalAmount - paidAmount;
    const status: InvoiceStatus = dueAmount <= 0 ? 'PAID' : 'ISSUED';
    const invoiceNumber = generateInvoiceNumber();
    const businessDate = await stampCurrentBusinessDate();

    const invoice = await db.$transaction(async (tx) => {
      const inv = existingInvoice
        ? await tx.invoice.update({
            where: { id: existingInvoice.id },
            data: {
              roomCharges,
              foodCharges,
              extraCharges,
              subtotal,
              discount,
              vatAmount,
              totalAmount,
              paidAmount,
              dueAmount: Math.max(0, dueAmount),
              status,
              businessDate,
              issuedAt: existingInvoice.issuedAt || new Date(),
              paidAt: status === 'PAID' ? new Date() : null,
            },
          })
        : await tx.invoice.create({
            data: {
              invoiceNumber,
              bookingId,
              businessDate,
              roomCharges,
              foodCharges,
              extraCharges,
              subtotal,
              discount,
              vatAmount,
              totalAmount,
              paidAmount,
              dueAmount: Math.max(0, dueAmount),
              status,
              issuedAt: new Date(),
              paidAt: status === 'PAID' ? new Date() : null,
            },
          });

      await replaceInvoiceLineItems(tx, inv.id, lineItems);
      return inv;
    });

    const completeInvoice = await db.invoice.findUnique({
      where: { id: invoice.id },
      include: {
        booking: {
          include: {
            customer: true,
            room: { include: { type: true } },
          },
        },
        items: true,
        payments: true,
      },
    });

    await logActivity(
      user.id,
      'INVOICE_GENERATED',
      'billing',
      JSON.stringify({
        invoiceId: invoice.id,
        invoiceNumber: completeInvoice?.invoiceNumber ?? invoiceNumber,
        bookingId,
        totalAmount,
        dueAmount: Math.max(0, dueAmount),
        status,
        manualMode,
      })
    );

    return successResponse(
      completeInvoice,
      existingInvoice ? 'Invoice updated successfully' : 'Invoice generated successfully',
      existingInvoice ? 200 : 201
    );
  } catch (error) {
    console.error('Error generating invoice:', error);
    return errorResponse('Failed to generate invoice', 500);
  }
}
