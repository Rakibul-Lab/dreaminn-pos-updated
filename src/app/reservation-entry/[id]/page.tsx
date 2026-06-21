'use client'

import { useParams } from 'next/navigation'
import { ReservationEntryDocumentView } from '@/components/erp/hotel/ReservationEntryDocumentView'
import { AppDevelopedByFooter } from '@/components/AppDevelopedByFooter'

export default function ReservationEntryPrintPage() {
  const params = useParams<{ id: string }>()
  const entryId = params?.id

  if (!entryId) {
    return <div className="p-8 text-red-600">Invalid reservation entry link.</div>
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 mx-auto w-full p-6 print:bg-white print:p-0 flex justify-center">
        <ReservationEntryDocumentView
          entryId={entryId}
          showToolbar
          onClose={() => window.close()}
        />
      </main>
      <AppDevelopedByFooter printHidden />
    </div>
  )
}
