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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { Loader2, UtensilsCrossed } from 'lucide-react'
import { formatBdt } from '@/lib/currency'
import { format } from 'date-fns'
import { PAYMENT_METHOD_OPTIONS } from '@/lib/payment-method'
import { parseBookingRestaurantBillNotes } from '@/lib/booking-restaurant-bill-notes'
import {
  GUEST_FOLIO_RESTAURANT_VAT_PERCENT,
  computeGuestFolioRestaurantBillTotals,
} from '@/lib/booking-restaurant-bill.shared'

type RestaurantBillRow = {
  id: string
  orderNumber: string
  subtotal: number
  discount: number
  vatPercent: number
  vatAmount: number
  totalAmount: number
  notes: string | null
  createdAt: string
}

type BookingRestaurantBillDialogProps = {
  bookingId: string | null
  guestLabel?: string
  roomNumber?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BookingRestaurantBillDialog({
  bookingId,
  guestLabel,
  roomNumber,
  open,
  onOpenChange,
}: BookingRestaurantBillDialogProps) {
  const queryClient = useQueryClient()
  const [billNo, setBillNo] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('NONE')
  const [amount, setAmount] = useState('')
  const [discount, setDiscount] = useState('0')
  const [vatApplied, setVatApplied] = useState(true)
  const [notes, setNotes] = useState('')

  const { data: bookingRes } = useQuery({
    queryKey: ['booking-restaurant-bill-due', bookingId],
    queryFn: () =>
      api.get<{ success: boolean; data: { dueAmount: number } }>(`/bookings/${bookingId}`),
    enabled: open && !!bookingId,
  })

  const guestDueAmount = Math.max(0, bookingRes?.data?.dueAmount ?? 0)

  const { data: billsRes, isLoading } = useQuery({
    queryKey: ['booking-restaurant-bills', bookingId],
    queryFn: () =>
      api.get<{ success: boolean; data: RestaurantBillRow[] }>(
        `/bookings/${bookingId}/restaurant-bills`
      ),
    enabled: open && !!bookingId,
  })

  const bills = billsRes?.data ?? []

  useEffect(() => {
    if (!open) return
    setBillNo('')
    setPaymentMethod('NONE')
    setAmount('')
    setDiscount('0')
    setVatApplied(true)
    setNotes('')
  }, [open, bookingId])

  const parsedAmount = Math.max(0, parseFloat(amount) || 0)
  const parsedDiscount = Math.max(0, parseFloat(discount) || 0)
  const billTotals = computeGuestFolioRestaurantBillTotals({
    inclusiveAmount: parsedAmount,
    discount: parsedDiscount,
    vatApplied,
  })
  const projectedDue = guestDueAmount + billTotals.totalAmount

  const addMutation = useMutation({
    mutationFn: () =>
      api.post(`/bookings/${bookingId}/restaurant-bills`, {
        billNo: billNo.trim(),
        paymentMethod,
        amount: parsedAmount,
        discount: parsedDiscount,
        vatApplied,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Restaurant bill added — it will appear on invoice restaurant section')
      queryClient.invalidateQueries({ queryKey: ['booking-restaurant-bills', bookingId] })
      queryClient.invalidateQueries({ queryKey: ['bookings'] })
      queryClient.invalidateQueries({ queryKey: ['booking-restaurant-bill-due', bookingId] })
      setBillNo('')
      setPaymentMethod('NONE')
      setAmount('')
      setDiscount('0')
      setNotes('')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to add restaurant bill'),
  })

  const existingTotal = bills.reduce((sum, bill) => sum + bill.totalAmount, 0)

  const handleSubmit = () => {
    if (!billNo.trim()) {
      toast.error('Bill number is required')
      return
    }
    if (parsedAmount <= 0) {
      toast.error('Amount must be greater than zero')
      return
    }
    if (parsedDiscount > parsedAmount) {
      toast.error('Discount cannot exceed amount')
      return
    }
    addMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-6 py-5 pr-14">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <UtensilsCrossed className="h-5 w-5 text-orange-600" />
            Restaurant bill entry
          </DialogTitle>
          {(guestLabel || roomNumber) && (
            <p className="text-sm text-muted-foreground pt-1">
              {guestLabel}
              {guestLabel && roomNumber ? ' · ' : ''}
              {roomNumber ? `Room ${roomNumber}` : ''}
            </p>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <Card className="border-orange-200/80 bg-orange-50/40">
            <CardContent className="p-4 text-sm text-orange-950 leading-relaxed space-y-2">
              <p>
                Enter the bill total as <strong>VAT-inclusive</strong> (5% VAT when enabled). No
                service charge applies to guest folio restaurant bills.
              </p>
              <p className="text-xs tabular-nums">
                Current guest due:{' '}
                <strong>{formatBdt(guestDueAmount)}</strong>
                {parsedAmount > 0 ? (
                  <>
                    {' '}
                    · After this bill: <strong>{formatBdt(projectedDue)}</strong>
                  </>
                ) : null}
              </p>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Bill No. *</Label>
                <Input
                  value={billNo}
                  onChange={(e) => setBillNo(e.target.value)}
                  placeholder="e.g. RB-1042"
                />
              </div>
              <div className="space-y-2">
                <Label>
                  Payment method{' '}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHOD_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label>Amount (BDT, VAT inclusive) *</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>Discount (BDT)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-4 py-3">
              <div>
                <p className="text-sm font-medium">VAT {GUEST_FOLIO_RESTAURANT_VAT_PERCENT}% (inclusive)</p>
                <p className="text-xs text-muted-foreground">Backed out from the amount above</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{vatApplied ? 'On' : 'Off'}</span>
                <Switch checked={vatApplied} onCheckedChange={setVatApplied} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Internal notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional staff notes — not shown as main line on invoice"
                rows={2}
              />
            </div>

            {parsedAmount > 0 && (
              <div className="rounded-lg border bg-muted/30 px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Net (excl. VAT)</p>
                  <p className="font-medium tabular-nums">{formatBdt(billTotals.subtotal)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    VAT ({vatApplied ? `${GUEST_FOLIO_RESTAURANT_VAT_PERCENT}%` : '0%'})
                  </p>
                  <p className="font-medium tabular-nums">{formatBdt(billTotals.vatAmount)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total (inclusive)</p>
                  <p className="font-semibold tabular-nums text-orange-700">
                    {formatBdt(billTotals.totalAmount)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Service charge</p>
                  <p className="font-medium tabular-nums text-muted-foreground">None</p>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-sm font-semibold">Posted restaurant bills</Label>
              {bills.length > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  Total {formatBdt(existingTotal)}
                </span>
              )}
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading bills…
              </div>
            ) : bills.length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center">
                No restaurant bills on this stay yet.
              </p>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(4.5rem,0.6fr)_minmax(4.5rem,0.6fr)_minmax(5rem,0.7fr)] gap-3 px-4 py-2.5 bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>Bill No.</span>
                  <span>Payment</span>
                  <span className="text-right">Date</span>
                  <span className="text-right">Total</span>
                </div>
                <Separator />
                {bills.map((bill) => {
                  const parsed = parseBookingRestaurantBillNotes(bill.notes)
                  return (
                    <div
                      key={bill.id}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(4.5rem,0.6fr)_minmax(4.5rem,0.6fr)_minmax(5rem,0.7fr)] gap-3 px-4 py-3 border-b last:border-b-0 items-start text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-medium leading-snug font-mono">{parsed.billNo}</p>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">
                          {bill.orderNumber}
                          {bill.vatPercent > 0 ? ` · VAT ${bill.vatPercent}% incl.` : ''}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground pt-0.5">
                        {parsed.paymentMethod ?? '—'}
                      </p>
                      <p className="text-xs text-muted-foreground text-right tabular-nums pt-0.5">
                        {format(new Date(bill.createdAt), 'dd MMM yyyy')}
                      </p>
                      <p className="font-semibold tabular-nums text-right text-orange-800">
                        {formatBdt(bill.totalAmount)}
                      </p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-3 border-t bg-muted/20 px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            className="bg-orange-600 hover:bg-orange-700"
            disabled={addMutation.isPending}
            onClick={handleSubmit}
          >
            {addMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              'Add restaurant bill'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
