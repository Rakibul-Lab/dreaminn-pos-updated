'use client'

import { Receipt } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { openRestaurantReceiptTab } from '@/lib/restaurant-receipt-navigation'
import { cn } from '@/lib/utils'

type RestaurantOrderSlipButtonProps = {
  orderId: string
  iconOnly?: boolean
  compact?: boolean
  className?: string
  /** When true, opens receipt and triggers print (Collect & close flow). */
  autoPrint?: boolean
}

export function RestaurantOrderSlipButton({
  orderId,
  iconOnly = false,
  compact = false,
  className,
  autoPrint = false,
}: RestaurantOrderSlipButtonProps) {
  return (
    <Button
      type="button"
      size={iconOnly ? 'icon' : compact ? 'sm' : 'default'}
      variant="outline"
      className={cn(
        iconOnly &&
          'h-7 w-7 shrink-0 border-slate-400 text-slate-700 hover:bg-slate-50',
        !iconOnly && compact && 'h-7 text-xs',
        className
      )}
      title={autoPrint ? 'Print payment slip' : 'View payment slip'}
      onClick={() => openRestaurantReceiptTab(orderId, { autoPrint })}
    >
      <Receipt className={iconOnly ? 'h-3.5 w-3.5' : 'w-3.5 h-3.5 mr-1'} />
      {!iconOnly && 'Slip'}
    </Button>
  )
}
