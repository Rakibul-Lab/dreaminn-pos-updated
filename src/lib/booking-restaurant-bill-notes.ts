import {
  formatPaymentMethod,
  type PaymentMethodValue,
} from '@/lib/payment-method'

export function formatBookingRestaurantBillNotes(input: {
  billNo: string
  paymentMethod: PaymentMethodValue
  notes?: string
}): string {
  const lines = [
    `Bill No. ${input.billNo.trim()}`,
    `Payment: ${formatPaymentMethod(input.paymentMethod)}`,
  ]
  if (input.notes?.trim()) lines.push(input.notes.trim())
  return lines.join('\n')
}

export function parseBookingRestaurantBillNotes(notes: string | null): {
  billNo: string
  paymentMethod: string | null
  internalNotes: string | null
} {
  if (!notes?.trim()) {
    return { billNo: '—', paymentMethod: null, internalNotes: null }
  }

  const lines = notes.trim().split('\n')
  let billNo = lines[0]?.trim() || '—'
  if (billNo.startsWith('Bill No. ')) {
    billNo = billNo.slice('Bill No. '.length).trim() || '—'
  }

  let paymentMethod: string | null = null
  let internalStart = 1
  if (lines[1]?.startsWith('Payment: ')) {
    paymentMethod = lines[1].slice('Payment: '.length).trim() || null
    internalStart = 2
  }

  const internalNotes = lines.slice(internalStart).join('\n').trim() || null
  return { billNo, paymentMethod, internalNotes }
}
