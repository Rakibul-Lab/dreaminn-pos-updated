import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { successResponse, errorResponse, notFoundResponse } from '@/lib/api-utils'
import { RoleType } from '@prisma/client'
import { formatPaymentMethod } from '@/lib/payment-method'
import { HOTEL_NAME, HOTEL_LOCATION } from '@/lib/reservation-terms'
import {
  INVOICE_BIN,
  INVOICE_HOTEL_ADDRESS,
  INVOICE_HOTEL_MOBILE,
  INVOICE_MUSHAK,
  INVOICE_ZERO_DISCOUNT_DISPLAY,
  buildInvoicePaymentSummary,
} from '@/lib/invoice-display'

type RouteContext = { params: Promise<{ id: string }> }

async function loadTransportSale(id: string) {
  return db.transportSale.findUnique({
    where: { id },
    include: {
      items: { orderBy: { serviceName: 'asc' } },
      room: { select: { roomNumber: true } },
      booking: {
        select: {
          customer: { select: { name: true, phone: true } },
        },
      },
      invoice: true,
      creator: { select: { name: true } },
    },
  })
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireRole(
      request,
      'ADMIN' as RoleType,
      'HOTEL_STAFF' as RoleType,
      'HOTEL_FD' as RoleType
    )
    if (authResult instanceof Response) return authResult

    const { id } = await context.params
    const sale = await loadTransportSale(id)
    if (!sale) return notFoundResponse('Transport sale not found')

    return successResponse(sale)
  } catch (error) {
    console.error('Transport sale detail error:', error)
    return errorResponse('Failed to fetch transport sale', 500)
  }
}

export async function buildTransportInvoiceDocument(saleId: string) {
  const sale = await loadTransportSale(saleId)
  if (!sale?.invoice) return null

  const payments = await db.payment.findMany({
    where: {
      notes: { contains: sale.saleNumber },
      paymentType: 'FINAL',
    },
    orderBy: { createdAt: 'asc' },
    select: {
      amount: true,
      method: true,
      reference: true,
      createdAt: true,
    },
  })

  const paymentSummary = buildInvoicePaymentSummary({
    payments,
    paidAmount: sale.invoice.paidAmount,
    totalAmount: sale.invoice.totalAmount,
    dueAmount: sale.invoice.dueAmount,
  })

  return {
    hotelName: HOTEL_NAME,
    hotelAddress: INVOICE_HOTEL_ADDRESS,
    hotelLocation: HOTEL_LOCATION,
    hotelMobile: INVOICE_HOTEL_MOBILE,
    bin: INVOICE_BIN,
    mushak: INVOICE_MUSHAK,
    vatPercent: 0,
    invoice: {
      id: sale.invoice.id,
      invoiceNumber: sale.invoice.invoiceNumber,
      status: sale.invoice.status,
      subtotal: sale.invoice.subtotal,
      vatAmount: sale.invoice.vatAmount,
      discount: sale.invoice.discount,
      totalAmount: sale.invoice.totalAmount,
      paidAmount: sale.invoice.paidAmount,
      dueAmount: sale.invoice.dueAmount,
      issuedAt: sale.invoice.issuedAt.toISOString(),
      paidAt: sale.invoice.paidAt?.toISOString() ?? null,
    },
    payments: payments.map((payment) => ({
      amount: payment.amount,
      method: payment.method,
      methodLabel: formatPaymentMethod(payment.method),
      reference: payment.reference,
      createdAt: payment.createdAt.toISOString(),
    })),
    paymentSummary,
    sale: {
      id: sale.id,
      saleNumber: sale.saleNumber,
      saleType: sale.saleType,
      customerName: sale.customerName,
      customerPhone: sale.customerPhone,
      routeFrom: sale.routeFrom,
      routeTo: sale.routeTo,
      vehicleType: sale.vehicleType,
      tripDate: sale.tripDate?.toISOString() ?? null,
      roomNumber: sale.roomNumber ?? sale.room?.roomNumber ?? null,
      notes: sale.notes,
      createdAt: sale.createdAt.toISOString(),
      paymentMethodLabel: sale.paymentMethod
        ? formatPaymentMethod(sale.paymentMethod)
        : null,
      createdByName: sale.creator?.name ?? null,
      items: sale.items.map((item) => ({
        serviceName: item.serviceName,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
    },
  }
}
