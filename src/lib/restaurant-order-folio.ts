import type { PrismaClient } from '@prisma/client'
import { computeOrderDue } from '@/lib/restaurant-order-dues'

type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends' | '$use'
>

const FOLIO_REMAINDER_PREFIX = 'Hotel bill remainder:'

function upsertFolioRemainderNote(
  existingNotes: string | null | undefined,
  billTotal: number,
  remainder: number
): string {
  const line = `Bill ৳${Math.round(billTotal).toLocaleString()} — due ৳${Math.round(remainder).toLocaleString()} on guest room bill`
  const trimmed = existingNotes?.trim()
  if (!trimmed) return line

  const withoutPrior = trimmed
    .split('\n')
    .filter(
      (row) =>
        !row.trim().startsWith(FOLIO_REMAINDER_PREFIX) &&
        !row.trim().startsWith('Bill ৳')
    )
    .join('\n')
    .trim()

  return withoutPrior ? `${withoutPrior}\n${line}` : line
}

/** Commit unpaid restaurant balance to the checked-in guest folio after a partial counter payment. */
export async function postGuestFolioRemainderInTx(
  tx: Tx,
  order: {
    id: string
    orderNumber: string
    orderType: string
    bookingId: string | null
    notes: string | null
    totalAmount: number
    payments: { amount: number; paymentType: string }[]
  },
  remainingDue: number
): Promise<{ posted: boolean; remainder: number; bookingId: string | null }> {
  if (remainingDue <= 0.009) {
    return { posted: false, remainder: 0, bookingId: order.bookingId }
  }
  if (order.orderType !== 'ROOM_SERVICE' || !order.bookingId) {
    return { posted: false, remainder: remainingDue, bookingId: order.bookingId }
  }

  const booking = await tx.booking.findUnique({
    where: { id: order.bookingId },
    select: { id: true, status: true, dueAmount: true, roomId: true },
  })

  if (!booking || booking.status !== 'CHECKED_IN') {
    return { posted: false, remainder: remainingDue, bookingId: order.bookingId }
  }

  const { dueAmount } = computeOrderDue(order.totalAmount, order.payments)
  const folioRemainder = Math.min(remainingDue, dueAmount)
  if (folioRemainder <= 0.009) {
    return { posted: false, remainder: 0, bookingId: order.bookingId }
  }

  await tx.restaurantOrder.update({
    where: { id: order.id },
    data: {
      notes: upsertFolioRemainderNote(order.notes, order.totalAmount, folioRemainder),
    },
  })

  return { posted: true, remainder: folioRemainder, bookingId: booking.id }
}

export function formatFolioRemainderLabel(remainder: number): string {
  return `৳${Math.round(remainder).toLocaleString()} on guest room bill`
}
