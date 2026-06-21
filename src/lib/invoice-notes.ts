const GENERIC_PAYMENT_NOTES = new Set([
  'Advance payment at booking creation',
  'Final payment at check-out',
])

export type InvoiceNotesInput = {
  bookingNotes?: string | null
  customerNotes?: string | null
  companyLedgerGuestNotes?: string | null
  paymentNotes?: Array<string | null | undefined>
}

/** Collect unique notes from reservation through checkout for invoice display. */
export function collectInvoiceNotes(input: InvoiceNotesInput): string[] {
  const lines: string[] = []
  const seen = new Set<string>()

  const add = (text?: string | null) => {
    const trimmed = text?.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    lines.push(trimmed)
  }

  add(input.bookingNotes)
  add(input.customerNotes)
  add(input.companyLedgerGuestNotes)

  for (const note of input.paymentNotes ?? []) {
    const trimmed = note?.trim()
    if (!trimmed || GENERIC_PAYMENT_NOTES.has(trimmed)) continue
    add(trimmed)
  }

  return lines
}
