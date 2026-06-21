export function openHotelBeverageReceiptTab(saleId: string, options?: { autoPrint?: boolean }) {
  if (typeof window === 'undefined') return
  const query = options?.autoPrint ? '?print=1' : ''
  window.open(`/hotel/beverage-receipt/${saleId}${query}`, '_blank', 'noopener,noreferrer')
}
