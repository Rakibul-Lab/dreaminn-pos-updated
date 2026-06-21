'use client'

import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useBusinessDate } from '@/hooks/use-business-date'

type DayCloseGateBannerProps = {
  onGoToDayClose?: () => void
  className?: string
}

export function DayCloseGateBanner({ onGoToDayClose, className }: DayCloseGateBannerProps) {
  const { data: businessDateRes } = useBusinessDate()
  const gate = businessDateRes?.data

  if (!gate?.dayCloseRequired) return null

  return (
    <div
      className={
        className ??
        'flex flex-col gap-2 rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between'
      }
      role="status"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
        <div>
          <p className="font-semibold">Business day behind calendar date</p>
          <p className="text-amber-900/90">
            {gate.dayCloseMessage ??
              `Business day ${gate.businessDate} is still open while today is ${gate.calendarDate}. You can continue check-ins and reservations. Run Day Close when ready to start the next business day.`}
          </p>
        </div>
      </div>
      {onGoToDayClose && (
        <Button type="button" variant="outline" size="sm" onClick={onGoToDayClose} className="shrink-0">
          Go to Day Close
        </Button>
      )}
    </div>
  )
}
