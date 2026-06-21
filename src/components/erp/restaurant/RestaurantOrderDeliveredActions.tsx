'use client'

import { Building2, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  canPayOrderDirectly,
  canSendOrderToHotel,
  formatOrderBillingDetail,
  formatOrderBillingState,
  hasPartialRestaurantPayment,
  isRoomServiceGuestOrder,
  resolveOrderBillingState,
} from '@/lib/restaurant-order-billing'
import { computeOrderDue } from '@/lib/restaurant-order-dues'
import { cn } from '@/lib/utils'
import { RestaurantOrderSlipButton } from './RestaurantOrderSlipButton'

export type RestaurantDeliveredOrder = {
  id: string
  orderNumber: string
  orderType: string
  status: string
  billingDisposition?: 'PENDING' | 'HOTEL_BILL' | 'PAID_DIRECT' | null
  bookingId?: string | null
  totalAmount: number
  payments?: { amount: number; paymentType: string; settlementSource?: string | null }[]
  companyLedgerBill?: { id: string } | null
  booking?: { id: string } | null
}

type RestaurantOrderDeliveredActionsProps = {
  order: RestaurantDeliveredOrder
  compact?: boolean
  /** Icon-only action buttons (order management table, POS delivered panel). */
  iconOnly?: boolean
  onPay: (order: RestaurantDeliveredOrder) => void
  onSendToHotel?: (orderId: string) => void
  sendToHotelPending?: boolean
}

function billingBadgeClass(state: string) {
  if (state === 'HOTEL_BILL') return 'bg-sky-50 text-sky-800 border-sky-200'
  if (state === 'PAID_DIRECT') return 'bg-emerald-50 text-emerald-800 border-emerald-200'
  return 'bg-amber-50 text-amber-800 border-amber-200'
}

export function RestaurantOrderDeliveredActions({
  order,
  compact = false,
  iconOnly = false,
  onPay,
  onSendToHotel,
  sendToHotelPending = false,
}: RestaurantOrderDeliveredActionsProps) {
  if (order.status !== 'DELIVERED') return null

  const billingState = resolveOrderBillingState(order)
  const roomGuest = isRoomServiceGuestOrder(order)
  const partialPaid = hasPartialRestaurantPayment(order)
  const payLabel = roomGuest ? 'Pay now' : 'Collect payment'
  const { paidAmount, dueAmount } = computeOrderDue(order.totalAmount, order.payments ?? [])
  const canShowSlip = paidAmount > 0.009
  const payTitle = partialPaid ? `Collect balance (${dueAmount.toFixed(0)} due)` : payLabel
  const sendHotelTitle = partialPaid
    ? `Send remaining balance (${dueAmount.toFixed(0)}) to hotel ledger`
    : 'Send to hotel ledger'
  const rowClass = cn(
    'flex flex-row flex-nowrap items-center gap-1',
    !iconOnly && compact && 'flex-col items-stretch gap-1.5',
    !iconOnly && !compact && 'flex-wrap gap-2'
  )

  if (billingState === 'PAID_DIRECT') {
    return (
      <div className={rowClass}>
        {!iconOnly && (
          <Badge variant="outline" className={`${billingBadgeClass('PAID_DIRECT')} text-xs w-fit`}>
            Paid at restaurant
          </Badge>
        )}
        {canShowSlip && (
          <RestaurantOrderSlipButton orderId={order.id} iconOnly={iconOnly} compact={compact} />
        )}
      </div>
    )
  }

  if (billingState === 'HOTEL_BILL') {
    if (iconOnly) {
      return (
        <div className={rowClass}>
          {canShowSlip && (
            <RestaurantOrderSlipButton orderId={order.id} iconOnly />
          )}
          <Button
            size="icon"
            variant="outline"
            className="h-7 w-7 shrink-0 border-sky-400 text-sky-700 bg-sky-50/80 cursor-default"
            title="Sent to hotel"
            disabled
          >
            <Building2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )
    }
    return (
      <div className={rowClass}>
        <Badge variant="outline" className={`${billingBadgeClass('HOTEL_BILL')} text-xs`}>
          Sent to hotel
        </Badge>
        {canShowSlip && (
          <RestaurantOrderSlipButton orderId={order.id} compact={compact} />
        )}
      </div>
    )
  }

  return (
    <div className={rowClass}>
      {roomGuest && !iconOnly && !partialPaid && (
        <Badge variant="outline" className={`${billingBadgeClass('PENDING')} text-[10px] w-fit`}>
          {formatOrderBillingState('PENDING')}
        </Badge>
      )}
      {partialPaid && !iconOnly && (
        <Badge variant="outline" className={`${billingBadgeClass('PENDING')} text-[10px] w-fit`}>
          {formatOrderBillingDetail(order)}
        </Badge>
      )}
      {canPayOrderDirectly(order) && (
        <Button
          size={iconOnly ? 'icon' : 'sm'}
          className={cn(
            iconOnly
              ? 'h-7 w-7 shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white',
            !iconOnly && compact && 'h-8 text-xs w-full',
            !iconOnly && !compact && 'h-7 text-xs'
          )}
          title={payTitle}
          onClick={() => onPay(order)}
        >
          <Wallet className={iconOnly ? 'h-3.5 w-3.5' : 'w-3.5 h-3.5 mr-1'} />
          {!iconOnly && (roomGuest ? 'Pay now' : 'Payment')}
        </Button>
      )}
      {canShowSlip && canPayOrderDirectly(order) && (
        <RestaurantOrderSlipButton orderId={order.id} iconOnly={iconOnly} compact={compact} />
      )}
      {canSendOrderToHotel(order) && onSendToHotel && (
        <Button
          size={iconOnly ? 'icon' : 'sm'}
          variant="outline"
          className={cn(
            iconOnly
              ? 'h-7 w-7 shrink-0 border-sky-500 text-sky-700 hover:bg-sky-50'
              : 'border-sky-300 text-sky-800 hover:bg-sky-50',
            !iconOnly && compact && 'h-8 text-xs w-full',
            !iconOnly && !compact && 'h-7 text-xs'
          )}
          title={sendHotelTitle}
          disabled={sendToHotelPending}
          onClick={() => onSendToHotel(order.id)}
        >
          <Building2 className={iconOnly ? 'h-3.5 w-3.5' : 'w-3.5 h-3.5 mr-1'} />
          {!iconOnly && 'Send hotel'}
        </Button>
      )}
    </div>
  )
}
