'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { PAYMENT_METHOD_OPTIONS_WITH_PAYMENT } from '@/lib/payment-method'

type BookingAddPaymentDialogProps = {
  bookingId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BookingAddPaymentDialog({
  bookingId,
  open,
  onOpenChange,
}: BookingAddPaymentDialogProps) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('CASH')
  const [notes, setNotes] = useState('')

  const paymentMutation = useMutation({
    mutationFn: () =>
      api.post('/payments', {
        bookingId,
        amount: parseFloat(amount) || 0,
        method,
        paymentType: 'PARTIAL',
        notes: notes.trim() || undefined,
      }),
    onSuccess: (res: { success?: boolean; error?: string }) => {
      if (!res?.success) {
        toast.error(res?.error || 'Failed to record payment')
        return
      }
      queryClient.invalidateQueries({ queryKey: ['bookings'] })
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
      toast.success('Payment recorded — enter another or close when done')
      setAmount('')
      setNotes('')
      setMethod('CASH')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to record payment'),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setAmount('')
          setNotes('')
          setMethod('CASH')
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Amount (BDT)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Payment method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHOD_OPTIONS_WITH_PAYMENT.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={paymentMutation.isPending || !(parseFloat(amount) > 0)}
            onClick={() => paymentMutation.mutate()}
          >
            {paymentMutation.isPending ? 'Saving…' : 'Record payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
