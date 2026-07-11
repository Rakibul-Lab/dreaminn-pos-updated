import { formatRestaurantPaymentSourceLabel } from '@/lib/restaurant-order-settle'

const BEVERAGE_SALE_NUMBER_RE = /BEV-\d{8}-\d+/
const TRANSPORT_SALE_NUMBER_RE = /TRN-\d{8}-\d+/

export function isBeverageWalkInPayment(payment: {
  notes?: string | null
  reference?: string | null
}): boolean {
  return (
    payment.notes?.includes('Beverage walk-in sale') === true ||
    payment.reference?.startsWith('BEV-') === true
  )
}

export function beverageSaleNumberFromPayment(payment: {
  notes?: string | null
  reference?: string | null
}): string | null {
  if (payment.reference?.startsWith('BEV-')) return payment.reference
  const match = payment.notes?.match(BEVERAGE_SALE_NUMBER_RE)
  return match?.[0] ?? null
}

export function isTransportWalkInPayment(payment: {
  notes?: string | null
  reference?: string | null
}): boolean {
  return isTransportSalePayment(payment)
}

export function isTransportSalePayment(payment: {
  notes?: string | null
  reference?: string | null
}): boolean {
  return (
    payment.notes?.includes('Transport sale') === true ||
    payment.notes?.includes('Transport walk-in sale') === true ||
    payment.reference?.startsWith('TRN-') === true
  )
}

export function transportSaleNumberFromPayment(payment: {
  notes?: string | null
  reference?: string | null
}): string | null {
  const fromNotes = payment.notes?.match(TRANSPORT_SALE_NUMBER_RE)?.[0] ?? null
  if (payment.reference?.startsWith('TRN-')) return payment.reference
  return fromNotes
}

export type PaymentLabelInput = {
  amount: number
  method: string
  paymentType: string
  notes?: string | null
  reference?: string | null
  settlementSource?: string | null
  booking?: {
    id: string
    customer?: { name: string } | null
    room?: { roomNumber: string } | null
  } | null
  invoice?: {
    invoiceNumber: string
    booking?: { room?: { roomNumber: string } | null } | null
  } | null
  order?: {
    orderNumber: string
    orderType?: string
    room?: { roomNumber: string } | null
    notes?: string | null
    bookingId?: string | null
  } | null
  reservationEntry?: {
    guestName?: string | null
    registrationNumber?: string | null
    lines?: Array<{ room?: { roomNumber: string } | null }>
  } | null
}

export function resolvePaymentSourceLabel(payment: PaymentLabelInput): string {
  if (payment.paymentType === 'REFUND') {
    if (payment.invoice?.invoiceNumber) {
      return `Refund · Invoice ${payment.invoice.invoiceNumber}`
    }
    if (payment.order?.orderNumber) {
      return `Refund · Restaurant #${payment.order.orderNumber}`
    }
    return 'Refund'
  }

  if (payment.invoice?.invoiceNumber) {
    return `Checkout invoice · ${payment.invoice.invoiceNumber}`
  }

  if (payment.order?.orderNumber) {
    const source = payment.settlementSource
      ? formatRestaurantPaymentSourceLabel(payment.settlementSource)
      : 'Restaurant order'
    return `${source} · #${payment.order.orderNumber}`
  }

  if (isBeverageWalkInPayment(payment)) {
    const saleNumber = beverageSaleNumberFromPayment(payment)
    return saleNumber
      ? `Hotel beverage (walk-in) · ${saleNumber}`
      : 'Hotel beverage (walk-in)'
  }

  if (isTransportSalePayment(payment)) {
    const saleNumber = transportSaleNumberFromPayment(payment)
    const isInHouse = payment.notes?.includes('In-house guest') === true
    return saleNumber
      ? `Transport sale (${isInHouse ? 'in-house guest' : 'walk-in'}) · ${saleNumber}`
      : 'Transport sale'
  }

  if (payment.booking?.id) {
    const room = payment.booking.room?.roomNumber
    const roomSuffix = room ? ` · Room ${room}` : ''
    switch (payment.paymentType) {
      case 'PARTIAL':
        return `Guest folio (Add payment)${roomSuffix}`
      case 'ADVANCE':
        return `Booking advance${roomSuffix}`
      case 'INITIAL':
        return `Initial payment${roomSuffix}`
      case 'FINAL':
        return `Final payment${roomSuffix}`
      case 'EXTRA_CHARGES':
        return `Extra charges${roomSuffix}`
      case 'DAMAGE_CHARGES':
        return `Damage charges${roomSuffix}`
      case 'OTHERS':
        return `Other payment${roomSuffix}`
      default:
        return `Booking payment${roomSuffix}`
    }
  }

  if (payment.reservationEntry) {
    const room = payment.reservationEntry.lines?.[0]?.room?.roomNumber
    const reg = payment.reservationEntry.registrationNumber
    const parts = [
      payment.paymentType === 'ADVANCE' ? 'Reservation advance' : 'Reservation payment',
    ]
    if (reg) parts.push(reg)
    if (room) parts.push(`Room ${room}`)
    return parts.join(' · ')
  }

  return 'Payment'
}

export function resolvePaymentRoomNumber(payment: PaymentLabelInput): string | null {
  if (payment.invoice?.booking?.room?.roomNumber) {
    return payment.invoice.booking.room.roomNumber
  }
  if (payment.booking?.room?.roomNumber) return payment.booking.room.roomNumber
  if (payment.order?.room?.roomNumber) return payment.order.room.roomNumber
  return payment.reservationEntry?.lines?.[0]?.room?.roomNumber ?? null
}

export function resolvePaymentGuestName(payment: PaymentLabelInput): string | null {
  return payment.booking?.customer?.name ?? payment.reservationEntry?.guestName ?? null
}

export function resolvePaymentReference(payment: PaymentLabelInput): string | null {
  return (
    payment.reference ??
    payment.invoice?.invoiceNumber ??
    (payment.order?.orderNumber ? `#${payment.order.orderNumber}` : null) ??
    beverageSaleNumberFromPayment(payment) ??
    transportSaleNumberFromPayment(payment) ??
    payment.reservationEntry?.registrationNumber ??
    payment.booking?.id?.slice(-6) ??
    null
  )
}
