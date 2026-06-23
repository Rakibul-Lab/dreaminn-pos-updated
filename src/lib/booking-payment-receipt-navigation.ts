export {
  formatPaymentSlipNumber,
  paymentSlipSuffixFromId,
} from '@/lib/booking-payment-slip'

export function openBookingPaymentReceiptTab(
  paymentId: string,
  options?: { autoPrint?: boolean }
) {
  const query = options?.autoPrint ? '?print=1' : ''
  window.open(`/hotel/payment-receipt/${paymentId}${query}`, '_blank', 'noopener,noreferrer')
}
