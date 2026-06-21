'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IdDocumentScanner, type IdDocumentItem } from './IdDocumentScanner'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import type { IdDocumentType } from '@/lib/id-ocr'
import { DEFAULT_NATIONALITY } from '@/lib/id-type-label'

type BookingIdUploadDialogProps = {
  bookingId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BookingIdUploadDialog({
  bookingId,
  open,
  onOpenChange,
}: BookingIdUploadDialogProps) {
  const queryClient = useQueryClient()
  const [documents, setDocuments] = useState<IdDocumentItem[]>([])

  const { data, isLoading } = useQuery({
    queryKey: ['booking-id-upload', bookingId],
    queryFn: () =>
      api.get<{ success: boolean; data: Record<string, unknown> }>(`/bookings/${bookingId}`),
    enabled: open && !!bookingId,
  })

  const booking = (data as { data?: Record<string, unknown> })?.data
  const customer = booking?.customer as Record<string, unknown> | undefined
  const nationality = String(customer?.nationality ?? DEFAULT_NATIONALITY)
  const idType = (customer?.idType as IdDocumentType) || 'national_id'

  useEffect(() => {
    if (!booking) return
    const idDocs = (booking.idDocuments as { filePath: string }[] | undefined) ?? []
    setDocuments(idDocs.map((d) => ({ path: d.filePath, previewUrl: d.filePath })))
  }, [booking])

  const saveMutation = useMutation({
    mutationFn: (paths: string[]) =>
      api.put(`/bookings/${bookingId}`, { idDocumentPaths: paths }),
    onSuccess: (res: { success?: boolean; error?: string }) => {
      if (!res?.success) {
        toast.error(res?.error || 'Failed to save ID documents')
        return
      }
      queryClient.invalidateQueries({ queryKey: ['bookings'] })
      queryClient.invalidateQueries({ queryKey: ['booking-id-upload', bookingId] })
      toast.success('ID documents saved')
      onOpenChange(false)
    },
    onError: () => toast.error('Failed to save ID documents'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload ID documents</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading…
          </div>
        ) : (
          <IdDocumentScanner
            nationality={nationality}
            idType={idType}
            onIdTypeChange={() => {}}
            documents={documents}
            onDocumentsChange={setDocuments}
            onScanComplete={(result) => {
              if (result.documents.length) setDocuments(result.documents)
            }}
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-amber-600 hover:bg-amber-700 text-white"
            disabled={saveMutation.isPending || documents.length === 0}
            onClick={() =>
              saveMutation.mutate(documents.map((d) => d.path))
            }
          >
            {saveMutation.isPending ? 'Saving…' : 'Save ID documents'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
