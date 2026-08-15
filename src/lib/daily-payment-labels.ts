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
  categoryLabel?: string | null
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
  let label = ''

  if (payment.paymentType === 'REFUND') {
    if (payment.invoice?.invoiceNumber) {
      label = `Refund · Invoice ${payment.invoice.invoiceNumber}`
    } else if (payment.order?.orderNumber) {
      label = `Refund · Restaurant #${payment.order.orderNumber}`
    } else {
      label = 'Refund'
    }
  } else if (payment.invoice?.invoiceNumber) {
    label = `Checkout invoice · ${payment.invoice.invoiceNumber}`
  } else if (payment.order?.orderNumber) {
    const source = payment.settlementSource
      ? formatRestaurantPaymentSourceLabel(payment.settlementSource)
      : 'Restaurant order'
    label = `${source} · #${payment.order.orderNumber}`
  } else if (isBeverageWalkInPayment(payment)) {
    const saleNumber = beverageSaleNumberFromPayment(payment)
    label = saleNumber
      ? `Hotel beverage (walk-in) · ${saleNumber}`
      : 'Hotel beverage (walk-in)'
  } else if (isTransportSalePayment(payment)) {
    const saleNumber = transportSaleNumberFromPayment(payment)
    const isInHouse = payment.notes?.includes('In-house guest') === true
    label = saleNumber
      ? `Transport sale (${isInHouse ? 'in-house guest' : 'walk-in'}) · ${saleNumber}`
      : 'Transport sale'
  } else if (payment.booking?.id) {
    const room = payment.booking.room?.roomNumber
    const roomSuffix = room ? ` · Room ${room}` : ''
    switch (payment.paymentType) {
      case 'PARTIAL':
        label = `Guest folio (Add payment)${roomSuffix}`
        break
      case 'ADVANCE':
        label = `Booking advance${roomSuffix}`
        break
      case 'INITIAL':
        label = `Initial payment${roomSuffix}`
        break
      case 'FINAL': {
        // Check-out splits the settlement across the folio charges it clears, so name
        // the charge to keep the day report rows apart.
        const settled = payment.categoryLabel?.trim()
        label = `Final payment${settled ? ` · ${settled}` : ''}${roomSuffix}`
        break
      }
      case 'EXTRA_CHARGES':
        label = `Extra charges${roomSuffix}`
        break
      case 'DAMAGE_CHARGES':
        label = `Damage charges${roomSuffix}`
        break
      case 'OTHERS':
        label = `Other payment${roomSuffix}`
        break
      default:
        label = `Booking payment${roomSuffix}`
        break
    }
  } else if (payment.reservationEntry) {
    const room = payment.reservationEntry.lines?.[0]?.room?.roomNumber
    const reg = payment.reservationEntry.registrationNumber
    const parts = [
      payment.paymentType === 'ADVANCE' ? 'Reservation advance' : 'Reservation payment',
    ]
    if (reg) parts.push(reg)
    if (room) parts.push(`Room ${room}`)
    label = parts.join(' · ')
  } else {
    switch (payment.paymentType) {
      case 'EXTRA_CHARGES':
        label = 'Extra charges'
        break
      case 'DAMAGE_CHARGES':
        label = 'Damage charges'
        break
      case 'OTHERS':
        label = 'Other payment'
        break
      default:
        label = 'Payment'
        break
    }
  }

  if (payment.notes && payment.notes.trim()) {
    const cleanNotes = payment.notes.trim()
    const isSystemNote =
      isBeverageWalkInPayment(payment) ||
      isTransportSalePayment(payment) ||
      cleanNotes.startsWith('Beverage walk-in sale') ||
      cleanNotes.startsWith('Transport sale')
    if (!isSystemNote && !label.includes(cleanNotes)) {
      label = `${label} · ${cleanNotes}`
    }
  }

  return label
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
