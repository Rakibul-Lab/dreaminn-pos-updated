import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { successResponse, errorResponse, paginatedResponse, logActivity } from '@/lib/api-utils'
import { RoleType, type PaymentMethod, type Prisma } from '@prisma/client'
import {
  computeTransportManualSaleTotal,
  generateTransportInvoiceNumber,
  generateTransportSaleNumber,
  type TransportCartLine,
} from '@/lib/transport-sales'
import { parsePaymentMethod } from '@/lib/payment-method'
import { readCurrentBusinessDateString } from '@/lib/business-date'

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(
      request,
      'ADMIN' as RoleType,
      'HOTEL_STAFF' as RoleType,
      'HOTEL_FD' as RoleType
    )
    if (authResult instanceof Response) return authResult

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const limit = Math.max(1, Math.min(5000, parseInt(searchParams.get('limit') || '20', 10) || 20))
    const saleType = searchParams.get('saleType')
    const search = searchParams.get('search')?.trim()
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    const whereParts: Prisma.TransportSaleWhereInput[] = []

    if (saleType === 'WALK_IN' || saleType === 'ROOM') {
      whereParts.push({ saleType })
    }

    if (search) {
      whereParts.push({
        OR: [
          { saleNumber: { contains: search } },
          { customerName: { contains: search } },
          { customerPhone: { contains: search } },
          { roomNumber: { contains: search } },
          { routeFrom: { contains: search } },
          { routeTo: { contains: search } },
          { invoice: { invoiceNumber: { contains: search } } },
        ],
      })
    }

    if (dateFrom || dateTo) {
      const createdAt: Prisma.DateTimeFilter = {}
      if (dateFrom) createdAt.gte = new Date(`${dateFrom}T00:00:00.000`)
      if (dateTo) createdAt.lte = new Date(`${dateTo}T23:59:59.999`)
      whereParts.push({ createdAt })
    }

    const where =
      whereParts.length === 0
        ? {}
        : whereParts.length === 1
          ? whereParts[0]!
          : { AND: whereParts }

    const [sales, total, aggregate] = await Promise.all([
      db.transportSale.findMany({
        where,
        include: {
          room: { select: { roomNumber: true } },
          items: true,
          invoice: { select: { id: true, invoiceNumber: true, status: true, totalAmount: true } },
          creator: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.transportSale.count({ where }),
      db.transportSale.aggregate({
        where,
        _sum: { totalAmount: true, subtotal: true },
      }),
    ])

    return paginatedResponse(sales, total, page, limit, {
      totalAmount: aggregate._sum.totalAmount ?? 0,
      subtotal: aggregate._sum.subtotal ?? 0,
    })
  } catch (error) {
    console.error('Transport sales list error:', error)
    return errorResponse('Failed to fetch transport sales', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(
      request,
      'ADMIN' as RoleType,
      'HOTEL_STAFF' as RoleType,
      'HOTEL_FD' as RoleType
    )
    if (authResult instanceof Response) return authResult

    const authUser = await db.user.findUnique({
      where: { id: authResult.id },
      select: { id: true, active: true },
    })
    if (!authUser?.active) {
      return errorResponse('Session expired. Please log in again.', 401)
    }

    const body = await request.json()
    const {
      saleType,
      amount,
      customerName,
      customerPhone,
      roomNumber,
      routeFrom,
      routeTo,
      vehicleType,
      tripDate,
      paymentMethod,
      payments,
      notes,
    } = body as {
      saleType?: string
      amount?: number
      customerName?: string
      customerPhone?: string
      roomNumber?: string
      routeFrom?: string
      routeTo?: string
      vehicleType?: string
      tripDate?: string
      paymentMethod?: string
      payments?: Array<{
        amount?: number
        method?: string
        reference?: string
        notes?: string
      }>
      notes?: string
    }

    if (saleType !== 'WALK_IN' && saleType !== 'ROOM') {
      return errorResponse('Sale type must be WALK_IN or ROOM')
    }

    const guestName = String(customerName || '').trim()
    if (!guestName) return errorResponse('Guest name is required')

    const manualRoomNumber = String(roomNumber || '').trim()
    if (saleType === 'ROOM' && !manualRoomNumber) {
      return errorResponse('Room number is required for in-house guest sales')
    }

    const manualAmount = Number(amount)
    if (!Number.isFinite(manualAmount) || manualAmount <= 0) {
      return errorResponse('Enter a valid amount')
    }

    const { subtotal, vatAmount, totalAmount } = computeTransportManualSaleTotal(manualAmount)

    const normalizedPayments = Array.isArray(payments)
      ? payments
          .map((payment) => ({
            amount: Number(payment.amount),
            method: parsePaymentMethod(String(payment.method || ''), 'CASH'),
            reference: payment.reference ? String(payment.reference).trim() : undefined,
            notes: payment.notes ? String(payment.notes).trim() : undefined,
          }))
          .filter((payment) => Number.isFinite(payment.amount) && payment.amount > 0)
      : []

    if (normalizedPayments.length === 0) {
      if (!paymentMethod) {
        return errorResponse('At least one payment is required')
      }
      normalizedPayments.push({
        amount: totalAmount,
        method: parsePaymentMethod(String(paymentMethod), 'CASH'),
        reference: undefined,
        notes: undefined,
      })
    }

    const paidTotal = normalizedPayments.reduce((sum, payment) => sum + payment.amount, 0)
    if (Math.abs(paidTotal - totalAmount) > 0.01) {
      return errorResponse('Payments must equal the sale total')
    }

    const primaryPaymentMethod = normalizedPayments[0]!.method
    const cartLines: TransportCartLine[] = [
      {
        serviceName: 'Transport',
        description: null,
        unitPrice: totalAmount,
        quantity: 1,
      },
    ]

    const saleNumber = await generateTransportSaleNumber(db)
    const invoiceNumber = await generateTransportInvoiceNumber(db)
    const businessDate = await readCurrentBusinessDateString()
    const saleTypeLabel = saleType === 'ROOM' ? 'In-house guest' : 'Walk-in guest'
    const parsedTripDate = tripDate ? new Date(tripDate) : null
    const tripDateValue =
      parsedTripDate && !Number.isNaN(parsedTripDate.getTime()) ? parsedTripDate : null

    const result = await db.$transaction(async (tx) => {
      const sale = await tx.transportSale.create({
        data: {
          saleNumber,
          saleType,
          roomNumber: manualRoomNumber || null,
          customerName: guestName,
          customerPhone: customerPhone ? String(customerPhone).trim() : null,
          routeFrom: routeFrom ? String(routeFrom).trim() : null,
          routeTo: routeTo ? String(routeTo).trim() : null,
          vehicleType: vehicleType ? String(vehicleType).trim() : null,
          tripDate: tripDateValue,
          subtotal,
          vatAmount,
          totalAmount,
          paymentMethod: primaryPaymentMethod as PaymentMethod,
          notes: notes?.trim() || null,
          businessDate,
          createdBy: authUser.id,
          items: {
            create: cartLines.map((line) => ({
              transportServiceId: null,
              serviceName: line.serviceName,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: totalAmount,
            })),
          },
        },
        include: {
          items: true,
        },
      })

      const invoice = await tx.transportInvoice.create({
        data: {
          invoiceNumber,
          saleId: sale.id,
          subtotal,
          vatAmount,
          discount: 0,
          totalAmount,
          paidAmount: paidTotal,
          dueAmount: 0,
          status: 'PAID',
          businessDate,
          paidAt: new Date(),
        },
      })

      for (const payment of normalizedPayments) {
        await tx.payment.create({
          data: {
            amount: payment.amount,
            method: payment.method as PaymentMethod,
            paymentType: 'FINAL',
            reference: payment.reference || saleNumber,
            notes:
              payment.notes ||
              `Transport sale (${saleTypeLabel}) ${saleNumber} · Invoice ${invoiceNumber}`,
            businessDate,
            receivedBy: authUser.id,
          },
        })
      }

      return { sale, invoice }
    })

    await logActivity(
      authUser.id,
      'CREATE_TRANSPORT_SALE',
      'hotel',
      JSON.stringify({
        saleId: result.sale.id,
        saleNumber: result.sale.saleNumber,
        invoiceId: result.invoice.id,
        invoiceNumber: result.invoice.invoiceNumber,
        saleType: result.sale.saleType,
        totalAmount: result.sale.totalAmount,
        roomNumber: result.sale.roomNumber,
      })
    )

    return successResponse(
      {
        ...result.sale,
        invoice: result.invoice,
      },
      201
    )
  } catch (error) {
    console.error('Transport sale create error:', error)
    return errorResponse('Failed to complete transport sale', 500)
  }
}
