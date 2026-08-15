import type { Prisma } from '@prisma/client'
import type { PostedExtraChargeLine } from '@/lib/checkout-settlement'
import {
  paymentRequiresLastFour,
  paymentRequiresReference,
  type PaymentMethodValue,
} from '@/lib/payment-method'

export type FolioSettlementRow = {
  amount: number
  method: PaymentMethodValue
  reference?: string | null
  accountLastFour?: string | null
  notes?: string | null
}

type FolioSettlementClient = Pick<Prisma.TransactionClient, 'payment'>

/** A payment slice small enough to ignore — keeps rounding noise off the folio. */
const SETTLEMENT_EPSILON = 0.005

function roundAmount(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Charges sent to the room stay open on the folio until they are paid for. Money taken
 * for the stay clears those charges first so each one leaves its own payment row (and
 * therefore its own slip), and only the remainder lands on the room balance.
 *
 * `pendingCharges` is consumed in place, so a caller settling several payment rows in
 * one go can pass the same array and have each row pick up where the last one stopped.
 */
export async function recordFolioSettlementPayments(
  client: FolioSettlementClient,
  params: {
    bookingId: string
    receivedBy: string
    businessDate: string
    invoiceId?: string | null
    pendingCharges: PostedExtraChargeLine[]
    rows: FolioSettlementRow[]
    defaultNotes: string
  }
): Promise<number> {
  const { bookingId, receivedBy, businessDate, invoiceId, pendingCharges, rows, defaultNotes } =
    params

  let totalRecorded = 0

  for (const row of rows) {
    const amount = Math.max(0, Number(row.amount || 0))
    if (amount <= 0) continue

    const method = row.method
    const reference = row.reference ? String(row.reference).trim() : null
    const accountLastFour = row.accountLastFour ? String(row.accountLastFour).trim() : null
    // Whatever the user typed wins on every row this payment produces; the descriptive
    // text below is only a fallback so the payments list still reads sensibly.
    const typedNotes = row.notes ? String(row.notes).trim() || null : null

    const basePaymentData = {
      method,
      // Every row stays a FINAL payment so the business day report still picks up
      // the full collection for the stay.
      paymentType: 'FINAL' as const,
      businessDate,
      bookingId,
      receivedBy,
      invoiceId: invoiceId ?? null,
      reference: paymentRequiresReference(method) ? reference : null,
      accountLastFour: paymentRequiresLastFour(method) ? accountLastFour : null,
    }

    let unallocated = amount
    while (unallocated > SETTLEMENT_EPSILON && pendingCharges.length > 0) {
      const charge = pendingCharges[0]
      const settled = roundAmount(Math.min(unallocated, charge.amount))

      await client.payment.create({
        data: {
          ...basePaymentData,
          amount: settled,
          categoryLabel: charge.label,
          notes: typedNotes ?? `${charge.label} settled at check-out`,
        },
      })

      charge.amount -= settled
      unallocated -= settled
      if (charge.amount <= SETTLEMENT_EPSILON) pendingCharges.shift()
    }

    if (unallocated > SETTLEMENT_EPSILON) {
      await client.payment.create({
        data: {
          ...basePaymentData,
          amount: roundAmount(unallocated),
          notes: typedNotes ?? defaultNotes,
        },
      })
    }

    totalRecorded += amount
  }

  return roundAmount(totalRecorded)
}

/**
 * Folio charges that still need clearing, after subtracting what earlier payments
 * already settled. Without this a second payment would re-label charges that the
 * first one already paid for.
 */
export function subtractSettledCharges(
  pendingCharges: PostedExtraChargeLine[],
  settledPayments: { amount: number; categoryLabel: string | null }[]
): PostedExtraChargeLine[] {
  const settledByLabel = new Map<string, number>()
  for (const payment of settledPayments) {
    if (!payment.categoryLabel) continue
    settledByLabel.set(
      payment.categoryLabel,
      (settledByLabel.get(payment.categoryLabel) ?? 0) + payment.amount
    )
  }

  return pendingCharges
    .map((charge) => ({
      label: charge.label,
      amount: roundAmount(charge.amount - (settledByLabel.get(charge.label) ?? 0)),
    }))
    .filter((charge) => charge.amount > SETTLEMENT_EPSILON)
}
