'use client'

import Image from 'next/image'
import Link from 'next/link'
import { use } from 'react'
import { NewReservationWizard } from '@/components/erp/hotel/NewReservationWizard'
import { FilePenLine } from 'lucide-react'
import { AppDevelopedByFooter } from '@/components/AppDevelopedByFooter'

export default function EditReservationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)

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
                <FilePenLine className="h-5 w-5 text-amber-600 shrink-0" />
                Edit Booking
              </h1>
              <p className="text-xs text-muted-foreground truncate">
                Update guest, stay, and billing details until checkout
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
        <NewReservationWizard editBookingId={id} />
      </main>
      <AppDevelopedByFooter printHidden />
    </div>
  )
}
