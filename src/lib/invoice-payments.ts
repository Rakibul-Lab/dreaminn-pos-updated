export type FolioPaymentRow = {
  id: string
  amount: number
  method: string
  paymentType: string
  createdAt: Date | string
  reference?: string | null
  accountLastFour?: string | null
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
