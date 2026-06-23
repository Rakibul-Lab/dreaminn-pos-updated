'use client'

import { Receipt } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { openBookingPaymentReceiptTab } from '@/lib/booking-payment-receipt-navigation'
import { cn } from '@/lib/utils'

type BookingPaymentSlipButtonProps = {
  paymentId: string
  autoPrint?: boolean
  iconOnly?: boolean
  size?: 'sm' | 'default'
  variant?: 'outline' | 'ghost'
  className?: string
  label?: string
}

export function BookingPaymentSlipButton({
  paymentId,
  autoPrint = false,
  iconOnly = false,
  size = 'sm',
  variant = 'outline',
  className,
  label = 'Slip',
}: BookingPaymentSlipButtonProps) {
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn(iconOnly ? 'h-7 w-7 p-0' : 'h-7 gap-1 text-xs', className)}
      title={autoPrint ? 'Print payment slip' : 'View payment slip'}
      onClick={() => openBookingPaymentReceiptTab(paymentId, { autoPrint })}
    >
      <Receipt className={iconOnly ? 'h-3.5 w-3.5' : 'h-3.5 w-3.5'} />
      {!iconOnly ? label : null}
    </Button>
  )
}
