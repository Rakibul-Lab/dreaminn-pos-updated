/** Generate invoice number: YYYYMMDD-XXXX (no INV prefix). */
export function generateInvoiceNumber(now: Date = new Date()): string {
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let suffix = ''
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)]
  }
  return `${year}${month}${day}-${suffix}`
}

/** Strip legacy prefixes (INV-, RRP-DI-) for display on invoices. */
export function formatInvoiceNumberDisplay(invoiceNumber: string): string {
  return invoiceNumber.replace(/^(INV-|RRP-DI-)/i, '')
}

/** Stable, human-readable identifier used in public invoice URLs. */
export function formatInvoiceUrlIdentifier(invoiceNumber: string): string {
  return `RRP-DI-${formatInvoiceNumberDisplay(invoiceNumber)}`
}

/** Possible stored invoice-number forms accepted from a public URL identifier. */
export function invoiceNumberCandidates(identifier: string): string[] {
  const decoded = decodeURIComponent(identifier).trim()
  const normalized = formatInvoiceNumberDisplay(decoded)
  return Array.from(
    new Set([
      decoded,
      normalized,
      `INV-${normalized}`,
      `RRP-DI-${normalized}`,
    ])
  )
}

