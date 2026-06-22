import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils';
import {
  resolveInvoiceHotelServicePercent,
  resolveInvoiceHotelVatPercent,
} from '@/lib/invoice-display';
import { collectInvoiceNotes } from '@/lib/invoice-notes';
import { mergeFolioPayments } from '@/lib/invoice-payments';
import { filterGuestFolioRestaurantOrders } from '@/lib/restaurant-order-billing';
import { InvoiceStatus } from '@prisma/client';

// GET /api/invoices/[id] - Get invoice detail
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(request, 'ADMIN', 'HOTEL_STAFF', 'HOTEL_FD');
    if (authResult instanceof Response) return authResult;

    const { id } = await params;

    const invoice = await db.invoice.findUnique({
      where: { id },
      include: {
        booking: {
          select: {
            id: true,
            checkIn: true,
            checkOut: true,
            actualCheckIn: true,
            actualCheckOut: true,
            adults: true,
            children: true,
            status: true,
            company: true,
            isCorporateGuest: true,
            discountEnabled: true,
            discountType: true,
            discountValue: true,
            vatApplied: true,
            vatPercent: true,
            serviceChargePercent: true,
            notes: true,
            customer: true,
            companyLedger: {
              select: {
                id: true,
                name: true,
                contactPerson: true,
                phone: true,
                email: true,
                address: true,
              },
            },
            companyLedgerGuest: {
              select: {
                guestName: true,
                phone: true,
                email: true,
                nationality: true,
                registrationNumber: true,
                address: true,
                idType: true,
                idNumber: true,
                notes: true,
              },
            },
            creator: { select: { id: true, name: true } },
            companions: {
              orderBy: { sortOrder: 'asc' },
              select: {
                name: true,
                companionType: true,
                nationality: true,
                idType: true,
                idNumber: true,
                phone: true,
                visaExpiryDate: true,
              },
            },
            room: {
              select: {
                id: true,
                roomNumber: true,
                totalPrice: true,
                type: { select: { name: true } },
              },
            },
            charges: true,
            restaurantOrders: {
              where: { status: { not: 'CANCELLED' } },
              select: {
                id: true,
                orderNumber: true,
                subtotal: true,
                discount: true,
                vatPercent: true,
                vatAmount: true,
                totalAmount: true,
                createdAt: true,
                notes: true,
                billingDisposition: true,
                status: true,
                companyLedgerBill: { select: { id: true } },
              },
              orderBy: { createdAt: 'asc' },
            },
            payments: {
              select: {
                id: true,
                amount: true,
                method: true,
                paymentType: true,
                createdAt: true,
                reference: true,
                accountLastFour: true,
                notes: true,
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        items: {
          orderBy: { itemType: 'asc' },
        },
        payments: {
          include: {
            receiver: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!invoice) {
      return notFoundResponse('Invoice');
    }

    const declaredVatPercent = resolveInvoiceHotelVatPercent(invoice.booking);
    const declaredServiceChargePercent = resolveInvoiceHotelServicePercent(invoice.booking);
    const invoiceNotes = collectInvoiceNotes({
      bookingNotes: invoice.booking.notes,
      customerNotes: invoice.booking.customer.notes,
      companyLedgerGuestNotes: invoice.booking.companyLedgerGuest?.notes,
      paymentNotes: invoice.booking.payments.map((payment) => payment.notes),
    });

    const folioRestaurantOrders = filterGuestFolioRestaurantOrders(invoice.booking.restaurantOrders)
    const folioPayments = mergeFolioPayments(invoice.payments, invoice.booking.payments)

    return successResponse({
      ...invoice,
      payments: folioPayments,
      booking: {
        ...invoice.booking,
        restaurantOrders: folioRestaurantOrders,
      },
      declaredVatPercent,
      declaredServiceChargePercent,
      invoiceNotes,
    });
  } catch (error) {
    console.error('Error fetching invoice:', error);
    return errorResponse('Failed to fetch invoice', 500);
  }
}

// PUT /api/invoices/[id] - Update invoice (add discount, change status)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(request, 'ADMIN', 'HOTEL_STAFF', 'HOTEL_FD');
    if (authResult instanceof Response) return authResult;

    const user = authResult;
    const { id } = await params;
    const body = await request.json();
    const { discount, status } = body;

    const invoice = await db.invoice.findUnique({
      where: { id },
    });

    if (!invoice) {
      return notFoundResponse('Invoice');
    }

    // Prepare update data
    const updateData: Record<string, unknown> = {};

    // If discount is provided, recalculate totals
    if (discount !== undefined && discount !== null) {
      if (discount < 0) {
        return errorResponse('Discount cannot be negative');
      }

      if (discount > invoice.subtotal) {
        return errorResponse('Discount cannot exceed subtotal');
      }

      updateData.discount = discount;

      // Recalculate VAT and total
      const vatPercent = invoice.vatAmount > 0 && invoice.subtotal > 0
        ? (invoice.vatAmount / (invoice.subtotal - invoice.discount)) * 100
        : 0;

      const newVatAmount = (invoice.subtotal - discount) * vatPercent / 100;
      const newTotalAmount = invoice.subtotal - discount + newVatAmount;
      const newDueAmount = Math.max(0, newTotalAmount - invoice.paidAmount);

      updateData.vatAmount = newVatAmount;
      updateData.totalAmount = newTotalAmount;
      updateData.dueAmount = newDueAmount;

      // Auto-update status based on due amount
      if (newDueAmount <= 0 && invoice.paidAmount > 0) {
        updateData.status = 'PAID';
        updateData.paidAt = new Date();
      }
    }

    // If status is being changed
    if (status) {
      const validStatuses: InvoiceStatus[] = ['ISSUED', 'PAID', 'CANCELLED', 'PARTIALLY_PAID'];
      if (!validStatuses.includes(status as InvoiceStatus)) {
        return errorResponse('Invalid invoice status');
      }

      updateData.status = status;

      // When marking as PAID, set paidAt timestamp
      if (status === 'PAID') {
        updateData.paidAt = new Date();
      }

      // When cancelling, don't set paidAt
      if (status === 'CANCELLED') {
        updateData.paidAt = null;
      }
    }

    const updatedInvoice = await db.invoice.update({
      where: { id },
      data: updateData,
      include: {
        booking: {
          include: {
            customer: true,
            room: { include: { type: true } },
          },
        },
        items: true,
        payments: {
          include: {
            receiver: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Log activity
    await logActivity(
      user.id,
      'INVOICE_UPDATED',
      'billing',
      JSON.stringify({
        invoiceId: id,
        invoiceNumber: invoice.invoiceNumber,
        updates: Object.keys(updateData),
        newStatus: updateData.status || invoice.status,
      })
    );

    return successResponse(updatedInvoice, 'Invoice updated successfully');
  } catch (error) {
    console.error('Error updating invoice:', error);
    return errorResponse('Failed to update invoice', 500);
  }
}
