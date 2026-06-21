'use client'

import { Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { NewReservationWizard } from '@/components/erp/hotel/NewReservationWizard'
import { DayCloseGateBanner } from '@/components/erp/admin/DayCloseGateBanner'
import { CalendarCheck } from 'lucide-react'
import { AppDevelopedByFooter } from '@/components/AppDevelopedByFooter'

function NewReservationPageContent() {
  const searchParams = useSearchParams()
  const initialRoomId = searchParams.get('roomId') ?? undefined
  const initialCheckInDate = searchParams.get('checkIn') ?? undefined
  const initialCheckOutDate = searchParams.get('checkOut') ?? undefined

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm shadow-sm print:hidden">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border bg-card">
              <Image
                src="/brand-logo.png"
                alt="RRP Dream Inn"
                width={40}
                height={40}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-foreground truncate flex items-center gap-2">
                <CalendarCheck className="h-5 w-5 text-amber-600 shrink-0" />
                New Reservation
              </h1>
              <p className="text-xs text-muted-foreground truncate">
                Scan ID, complete stay details, then print or download PDF
              </p>
            </div>
          </div>
          <Link
            href="/"
            className="text-sm font-medium text-amber-700 hover:text-amber-800 shrink-0"
          >
            ← Back to ERP
          </Link>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="space-y-4">
          <DayCloseGateBanner />
          <NewReservationWizard
            initialRoomId={initialRoomId}
            initialCheckInDate={initialCheckInDate}
            initialCheckOutDate={initialCheckOutDate}
          />
        </div>
      </main>
      <AppDevelopedByFooter printHidden />
    </div>
  )
}

export default function NewReservationPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background p-8 text-sm text-muted-foreground">
          Loading reservation wizard...
        </div>
      }
    >
      <NewReservationPageContent />
    </Suspense>
  )
}
