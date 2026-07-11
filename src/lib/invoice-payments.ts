import type { InvoiceStatus, PaymentType, PrismaClient } from '@prisma/client'
import { sumBookingNetPaid } from '@/lib/booking-totals'
import { formatPaymentTypeLabel, isManualRecordPaymentType } from '@/lib/payment-method'

export type FolioPaymentRow = {
  id: string
  amount: number
  method: string
  paymentType: string
  createdAt: Date | string
  reference?: string | null
  accountLastFour?: string | null
  notes?: string | null
}

/** Booking folio payments plus any invoice-linked rows, deduped by id. */
export function mergeFolioPayments(
  invoicePayments: FolioPaymentRow[],
  bookingPayments: FolioPaymentRow[]
): FolioPaymentRow[] {
  const byId = new Map<string, FolioPaymentRow>()
  for (const payment of bookingPayments) {
    if (payment.paymentType === 'REFUND') continue
    byId.set(payment.id, payment)
  }
  for (const payment of invoicePayments) {
    if (payment.paymentType === 'REFUND') continue
    byId.set(payment.id, payment)
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )
}

type InvoicePaymentDb = Pick<PrismaClient, 'invoice' | 'payment' | 'invoiceItem'>

/** Latest non-cancelled invoice for a booking (by reg. no. / stay). */
export async function resolveActiveBookingInvoiceId(
  client: InvoicePaymentDb,
  bookingId: string
): Promise<string | null> {
  const invoice = await client.invoice.findFirst({
    where: { bookingId, status: { not: 'CANCELLED' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  return invoice?.id ?? null
}

/** Recompute invoice paid/due from all folio payments for the stay. */
export async function syncInvoicePaymentTotals(
  client: InvoicePaymentDb,
  invoiceId: string
): Promise<{ paidAmount: number; dueAmount: number; bookingId: string } | null> {
  const invoice = await client.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, bookingId: true, totalAmount: true, status: true },
  })
  if (!invoice) return null

  const paymentRows = await client.payment.findMany({
    where: {
      OR: [{ invoiceId }, { bookingId: invoice.bookingId }],
    },
    select: { id: true, amount: true, paymentType: true },
  })

  const byId = new Map<string, { amount: number; paymentType: string }>()
  for (const row of paymentRows) {
    byId.set(row.id, row)
  }

  const paidAmount = sumBookingNetPaid(Array.from(byId.values()))
  const dueAmount = Math.max(0, invoice.totalAmount - paidAmount)

  let status: InvoiceStatus = invoice.status
  if (dueAmount <= 0) {
    status = 'PAID'
  } else if (paidAmount > 0 && invoice.status !== 'CANCELLED') {
    status = 'PARTIALLY_PAID'
  }

  await client.invoice.update({
    where: { id: invoiceId },
    data: {
      paidAmount,
      dueAmount,
      status,
      paidAt: dueAmount <= 0 ? new Date() : null,
    },
  })

  return { paidAmount, dueAmount, bookingId: invoice.bookingId }
}

/** Add a hotel-part invoice row for Record New Payment charge types. */
export async function appendManualChargeInvoiceLine(
  client: InvoicePaymentDb,
  input: {
    invoiceId: string
    paymentId: string
    paymentType: PaymentType
    amount: number
    notes?: string | null
  }
): Promise<void> {
  if (!isManualRecordPaymentType(input.paymentType)) return

  const label = formatPaymentTypeLabel(input.paymentType)

  await client.invoiceItem.create({
    data: {
      invoiceId: input.invoiceId,
      itemType: 'extra_service',
      referenceId: input.paymentId,
      description: label,
      quantity: 1,
      unitPrice: input.amount,
      total: input.amount,
    },
  })

  await client.invoice.update({
    where: { id: input.invoiceId },
    data: {
      extraCharges: { increment: input.amount },
      subtotal: { increment: input.amount },
      totalAmount: { increment: input.amount },
    },
  })
}

export function formatManualChargeInvoiceNote(payment: {
  paymentType: string
  notes?: string | null
}): string | null {
  // Invoice notes: only human-entered payment notes — never auto-add the charge category label.
  return payment.notes?.trim() || null
}
