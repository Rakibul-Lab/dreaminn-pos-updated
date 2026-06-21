'use client'

import {
  formatOrderBillingDetail,
  resolveOrderBillingState,
} from '@/lib/restaurant-order-billing'
import { computeOrderDue } from '@/lib/restaurant-order-dues'
import { cn } from '@/lib/utils'

type RestaurantOrderPaymentSummaryProps = {
  totalAmount: number
  payments?: { amount: number; paymentType: string }[]
  billingDisposition?: 'PENDING' | 'HOTEL_BILL' | 'PAID_DIRECT' | null
  companyLedgerBill?: { id: string } | null
  className?: string
}

function billingBadgeClass(state: string) {
  if (state === 'HOTEL_BILL') return 'bg-sky-50 text-sky-800 border-sky-200'
  if (state === 'PAID_DIRECT') return 'bg-emerald-50 text-emerald-800 border-emerald-200'
  return 'bg-amber-50 text-amber-800 border-amber-200'
}

export function RestaurantOrderPaymentSummary({
  totalAmount,
  payments,
  billingDisposition,
  companyLedgerBill,
  className,
}: RestaurantOrderPaymentSummaryProps) {
  const { paidAmount, dueAmount } = computeOrderDue(totalAmount, payments ?? [])
  const billingState = resolveOrderBillingState({
    billingDisposition,
    companyLedgerBill,
    payments,
    totalAmount,
  })
  const billingDetail = formatOrderBillingDetail({
    billingDisposition,
    companyLedgerBill,
    payments,
    totalAmount,
  })

  return (
    <div className={cn('rounded-md border bg-muted/25 px-3 py-2.5 space-y-2', className)}>
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <p className="text-muted-foreground">Total</p>
          <p className="font-semibold tabular-nums text-sm">৳{totalAmount.toFixed(0)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Paid</p>
          <p className="font-semibold tabular-nums text-sm text-emerald-700">
            ৳{paidAmount.toFixed(0)}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Due</p>
          <p
            className={cn(
              'font-semibold tabular-nums text-sm',
              dueAmount > 0.009 ? 'text-amber-800' : 'text-emerald-700'
            )}
          >
            ৳{dueAmount.toFixed(0)}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <span className="text-[10px] text-muted-foreground">{billingDetail}</span>
        <span
          className={cn(
            'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium',
            billingBadgeClass(billingState)
          )}
        >
          {dueAmount <= 0.009 ? 'Settled' : 'Open balance'}
        </span>
      </div>
    </div>
  )
}
