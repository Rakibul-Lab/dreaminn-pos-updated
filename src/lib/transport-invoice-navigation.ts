export function transportInvoicePath(invoiceId: string, print = false): string {
  const base = `/transport/invoice/${invoiceId}`
  return print ? `${base}?print=1` : base
}

/** Open a blank tab during the user click so pop-up blockers allow the invoice tab. */
export function prepareTransportInvoiceTab(): Window | null {
  if (typeof window === 'undefined') return null
  return window.open('about:blank', '_blank', 'noopener,noreferrer')
}

export function openTransportInvoiceTab(
  invoiceId: string,
  print = true,
  targetWindow?: Window | null
): boolean {
  if (typeof window === 'undefined') return false

  const url = transportInvoicePath(invoiceId, print)

  if (targetWindow && !targetWindow.closed) {
    try {
      targetWindow.location.href = url
      targetWindow.focus()
      return true
    } catch {
      // Fall through to a direct open attempt.
    }
  }

  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  return opened != null
}
