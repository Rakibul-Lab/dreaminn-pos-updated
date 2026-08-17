const GENERIC_PAYMENT_NOTES = new Set([
  'Advance payment at booking creation',
  'Final payment at check-out',
  'Payment at check-out',
])

/**
 * Notes the settlement flow writes for its own bookkeeping, such as
 * "laundry settled at check-out". The charge they name is already an invoice line,
 * so only a note the user actually typed belongs in the notes section.
 */
const GENERIC_PAYMENT_NOTE_PATTERNS = [/\bsettled at check-out\.?$/i]

function isGenericPaymentNote(note: string): boolean {
  if (GENERIC_PAYMENT_NOTES.has(note)) return true
  return GENERIC_PAYMENT_NOTE_PATTERNS.some((pattern) => pattern.test(note))
}

/** System-generated booking note lines that must never appear on invoices. */
const SYSTEM_NOTE_PATTERNS = [
  /^Auto-extended\b/i,
  /checkout grace\.?$/i,
  /^Converted from reservation entry\.?$/i,
  /^Booked by:/i,
]

/** Drop auto-generated system lines, keep only human-written booking notes. */
export function stripSystemBookingNotes(notes?: string | null): string | null {
  if (!notes) return null
  const kept = notes
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return false
      return !SYSTEM_NOTE_PATTERNS.some((pattern) => pattern.test(trimmed))
    })
    .join('\n')
    .trim()
  return kept.length > 0 ? kept : null
}

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

  add(stripSystemBookingNotes(input.bookingNotes))
  add(input.customerNotes)
  add(input.companyLedgerGuestNotes)

  for (const note of input.paymentNotes ?? []) {
    const trimmed = note?.trim()
    if (!trimmed || isGenericPaymentNote(trimmed)) continue
    add(trimmed)
  }

  return lines
}
