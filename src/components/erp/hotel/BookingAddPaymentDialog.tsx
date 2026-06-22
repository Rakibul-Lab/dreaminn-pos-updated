'use client'

import { useEffect, useMemo, useState } from 'react'
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
import { formatBdt } from '@/lib/currency'
import {
  PAYMENT_METHOD_OPTIONS_WITH_PAYMENT,
  paymentRequiresLastFour,
  paymentRequiresReference,
  isValidPaymentAccountLastFour,
} from '@/lib/payment-method'

type BookingAddPaymentDialogProps = {
  bookingId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

type BookingDueSnapshot = {
  dueAmount: number
  customer?: { name: string }
  room?: { roomNumber: string }
}

export function BookingAddPaymentDialog({
  bookingId,
  open,
  onOpenChange,
}: BookingAddPaymentDialogProps) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('CASH')
  const [reference, setReference] = useState('')
  const [accountLastFour, setAccountLastFour] = useState('')
  const [notes, setNotes] = useState('')

  const { data: bookingRes, refetch: refetchBooking } = useQuery({
    queryKey: ['booking-payment-due', bookingId],
    queryFn: () =>
      api.get<{ success: boolean; data: BookingDueSnapshot }>(`/bookings/${bookingId}`),
    enabled: open && !!bookingId,
  })

  const dueAmount = Math.max(0, bookingRes?.data?.dueAmount ?? 0)
  const parsedAmount = Math.max(0, parseFloat(amount) || 0)
  const remainingDue = Math.max(0, dueAmount - parsedAmount)

  const showReference = paymentRequiresReference(method)
  const showLastFour = paymentRequiresLastFour(method)

  const validationError = useMemo(() => {
    if (parsedAmount <= 0) return 'Enter a payment amount greater than zero.'
    if (parsedAmount > dueAmount + 0.01) {
      return `Amount cannot exceed due balance (${formatBdt(dueAmount)}).`
    }
    if (showReference && !reference.trim()) {
      return 'Payment reference is required for this payment method.'
    }
    if (showLastFour && !isValidPaymentAccountLastFour(accountLastFour)) {
      return 'Last 4 digits are required for card / bKash / Nagad / Upay.'
    }
    return null
  }, [parsedAmount, dueAmount, showReference, reference, showLastFour, accountLastFour])

  useEffect(() => {
    if (!open) {
      setAmount('')
      setMethod('CASH')
      setReference('')
      setAccountLastFour('')
      setNotes('')
    }
  }, [open])

  const paymentMutation = useMutation({
    mutationFn: () =>
      api.post<{ success?: boolean; error?: string; data?: { updatedDueAmount?: number | null } }>(
        '/payments',
        {
          bookingId,
          amount: parsedAmount,
          method,
          paymentType: 'PARTIAL',
          reference: showReference ? reference.trim() : undefined,
          accountLastFour: showLastFour ? accountLastFour.trim() : undefined,
          notes: notes.trim() || undefined,
        }
      ),
    onSuccess: async (res) => {
      if (!res?.success) {
        toast.error(res?.error || 'Failed to record payment')
        return
      }
      const updatedDue = res.data?.updatedDueAmount
      if (updatedDue != null && bookingId) {
        queryClient.setQueryData(
          ['booking-payment-due', bookingId],
          (prev: { success?: boolean; data?: BookingDueSnapshot } | undefined) =>
            prev?.data
              ? { ...prev, data: { ...prev.data, dueAmount: updatedDue } }
              : prev
        )
      }
      queryClient.invalidateQueries({ queryKey: ['bookings'] })
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
      queryClient.invalidateQueries({ queryKey: ['booking-payment-due', bookingId] })
      await refetchBooking()
      toast.success('Payment recorded — enter another or close when done')
      setAmount('')
      setReference('')
      setAccountLastFour('')
      setNotes('')
      setMethod('CASH')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to record payment'),
  })

  const guestLabel = bookingRes?.data?.customer?.name
  const roomNumber = bookingRes?.data?.room?.roomNumber

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add payment</DialogTitle>
          {(guestLabel || roomNumber) && (
            <p className="text-sm text-muted-foreground">
              {guestLabel}
              {guestLabel && roomNumber ? ' · ' : ''}
              {roomNumber ? `Room ${roomNumber}` : ''}
            </p>
          )}
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/40 px-4 py-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Due amount</p>
              <p className="font-semibold tabular-nums text-red-600">{formatBdt(dueAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">After this payment</p>
              <p
                className={`font-semibold tabular-nums ${
                  parsedAmount > 0 && remainingDue <= 0.009 ? 'text-emerald-600' : ''
                }`}
              >
                {parsedAmount > 0 ? formatBdt(remainingDue) : formatBdt(dueAmount)}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Amount (BDT)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              max={dueAmount > 0 ? dueAmount : undefined}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={dueAmount > 0 ? dueAmount.toFixed(2) : '0.00'}
            />
          </div>
          <div className="space-y-2">
            <Label>Payment method</Label>
            <Select
              value={method}
              onValueChange={(value) => {
                setMethod(value)
                if (!paymentRequiresReference(value)) setReference('')
                if (!paymentRequiresLastFour(value)) setAccountLastFour('')
              }}
            >
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

          {(showReference || showLastFour) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {showReference && (
                <div className="space-y-2">
                  <Label>
                    Reference <span className="text-red-600">*</span>
                  </Label>
                  <Input
                    placeholder="Transaction / receipt no."
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </div>
              )}
              {showLastFour && (
                <div className="space-y-2">
                  <Label>
                    Last 4 digits <span className="text-red-600">*</span>
                  </Label>
                  <Input
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="e.g. 4567"
                    value={accountLastFour}
                    onChange={(e) =>
                      setAccountLastFour(e.target.value.replace(/\D/g, '').slice(0, 4))
                    }
                  />
                </div>
              )}
            </div>
          )}

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
            disabled={paymentMutation.isPending || !!validationError}
            onClick={() => {
              if (validationError) {
                toast.error(validationError)
                return
              }
              paymentMutation.mutate()
            }}
          >
            {paymentMutation.isPending ? 'Saving…' : 'Record payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
