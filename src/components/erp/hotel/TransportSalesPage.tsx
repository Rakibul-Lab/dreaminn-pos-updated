'use client'

import { useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Car, History, List, Send, User, BedDouble, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PAYMENT_METHOD_OPTIONS_WITH_PAYMENT, formatPaymentMethod } from '@/lib/payment-method'
import { formatBdt } from '@/lib/currency'
import { openTransportInvoiceTab, prepareTransportInvoiceTab } from '@/lib/transport-invoice-navigation'
import { TransportAllSalesDialog } from '@/components/erp/hotel/TransportAllSalesDialog'
import { cn } from '@/lib/utils'

type PaymentLine = {
  id: string
  amount: number
  method: string
  reference?: string
}

type RecentSale = {
  id: string
  saleNumber: string
  saleType: 'WALK_IN' | 'ROOM'
  totalAmount: number
  customerName: string
  roomNumber?: string | null
  room?: { roomNumber: string } | null
  invoice?: { invoiceNumber: string } | null
  createdAt: string
}

type SaleMode = 'WALK_IN' | 'ROOM'

function formatDateTimeLocalValue(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:${min}`
}

export function TransportSalesPage() {
  const queryClient = useQueryClient()
  const [saleMode, setSaleMode] = useState<SaleMode>('WALK_IN')
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [roomNumber, setRoomNumber] = useState('')
  const [routeFrom, setRouteFrom] = useState('')
  const [routeTo, setRouteTo] = useState('')
  const [vehicleType, setVehicleType] = useState('')
  const [tripDate, setTripDate] = useState(() => formatDateTimeLocalValue())
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('CASH')
  const [payAmount, setPayAmount] = useState('')
  const [payReference, setPayReference] = useState('')
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([])
  const [notes, setNotes] = useState('')
  const [recentOpen, setRecentOpen] = useState(false)
  const [allSalesOpen, setAllSalesOpen] = useState(false)
  const pendingInvoiceTabRef = useRef<Window | null>(null)

  const { data: recentRes, isLoading: recentLoading } = useQuery({
    queryKey: ['transport-sales-recent'],
    queryFn: () =>
      api.get<{ success: boolean; data: RecentSale[] }>('/transport-sales?limit=12'),
    enabled: recentOpen,
  })

  const recentSales = recentRes?.data ?? []
  const parsedAmount = parseFloat(amount) || 0
  const invoiceTotal = parsedAmount > 0 ? parsedAmount : 0
  const totalPaid = paymentLines.reduce((sum, line) => sum + line.amount, 0)
  const parsedPayAmount = parseFloat(payAmount) || 0
  const recordedBalanceDue = Math.max(0, invoiceTotal - totalPaid)
  const projectedBalanceDue = Math.max(0, invoiceTotal - totalPaid - parsedPayAmount)
  const isFullyPaid = invoiceTotal > 0 && recordedBalanceDue <= 0.01
  const showPayReference = paymentMethod !== 'CASH'

  const completeSaleMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<{
        success: boolean
        data: RecentSale & { invoice?: { id: string; invoiceNumber: string } }
      }>('/transport-sales', payload),
    onSuccess: (res) => {
      if (!res.success) {
        pendingInvoiceTabRef.current?.close()
        pendingInvoiceTabRef.current = null
        toast.error('Failed to complete transport sale')
        return
      }
      toast.success('Transport sale completed', {
        description: res.data.invoice
          ? `Invoice ${res.data.invoice.invoiceNumber} generated`
          : undefined,
      })
      setGuestName('')
      setGuestPhone('')
      setRoomNumber('')
      setRouteFrom('')
      setRouteTo('')
      setVehicleType('')
      setTripDate(formatDateTimeLocalValue())
      setAmount('')
      setPayAmount('')
      setPayReference('')
      setPaymentLines([])
      setNotes('')
      queryClient.invalidateQueries({ queryKey: ['transport-sales-recent'] })
      queryClient.invalidateQueries({ queryKey: ['transport-sales-all'] })
      if (res.data.id) {
        const opened = openTransportInvoiceTab(
          res.data.id,
          true,
          pendingInvoiceTabRef.current
        )
        if (!opened) {
          toast.error('Invoice created, but the browser blocked the new tab. Allow pop-ups and open it from Recent sales.')
        }
      } else {
        pendingInvoiceTabRef.current?.close()
      }
      pendingInvoiceTabRef.current = null
    },
    onError: (err: Error) => {
      pendingInvoiceTabRef.current?.close()
      pendingInvoiceTabRef.current = null
      toast.error(err.message || 'Failed to complete transport sale')
    },
  })

  const handleAmountChange = (value: string) => {
    setAmount(value)
    setPaymentLines([])
    setPayReference('')
    const next = parseFloat(value)
    setPayAmount(Number.isFinite(next) && next > 0 ? String(next) : '')
  }

  const handlePaymentMethodChange = (method: string) => {
    setPaymentMethod(method)
    if (method === 'CASH') {
      setPayReference('')
    }
  }

  const handlePay = () => {
    if (!Number.isFinite(invoiceTotal) || invoiceTotal <= 0) {
      toast.error('Enter a valid sale amount first')
      return
    }
    if (parsedPayAmount <= 0) {
      toast.error('Enter a payment amount greater than zero')
      return
    }
    if (totalPaid + parsedPayAmount > invoiceTotal + 0.01) {
      toast.error(`Payment cannot exceed balance due (${formatBdt(recordedBalanceDue)})`)
      return
    }

    setPaymentLines((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${prev.length}`,
        amount: parsedPayAmount,
        method: paymentMethod,
        reference: payReference.trim() || undefined,
      },
    ])

    const remaining = Math.max(0, invoiceTotal - totalPaid - parsedPayAmount)
    setPayAmount(remaining > 0.01 ? String(remaining) : '')
    setPayReference('')
    toast.success('Payment recorded')
  }

  const handleCompleteSale = () => {
    if (!guestName.trim()) {
      toast.error('Guest name is required')
      return
    }
    if (saleMode === 'ROOM' && !roomNumber.trim()) {
      toast.error('Room number is required for in-house guest sales')
      return
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (!isFullyPaid) {
      toast.error('Record payments until the full amount is covered')
      return
    }
    if (paymentLines.length === 0) {
      toast.error('Add at least one payment')
      return
    }

    pendingInvoiceTabRef.current = prepareTransportInvoiceTab()

    completeSaleMutation.mutate({
      saleType: saleMode,
      customerName: guestName.trim(),
      customerPhone: guestPhone.trim() || undefined,
      roomNumber: roomNumber.trim() || undefined,
      routeFrom: routeFrom.trim() || undefined,
      routeTo: routeTo.trim() || undefined,
      vehicleType: vehicleType.trim() || undefined,
      tripDate: tripDate || formatDateTimeLocalValue(),
      amount: parsedAmount,
      payments: paymentLines.map((line) => ({
        amount: line.amount,
        method: line.method,
        reference: line.reference,
      })),
      notes: notes.trim() || undefined,
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Car className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-semibold">Transport Sale</h2>
            <p className="text-sm text-muted-foreground">
              Record an individual transport sale — each entry generates its own invoice
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setRecentOpen(true)}>
            <History className="mr-1.5 h-4 w-4" />
            Recent
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setAllSalesOpen(true)}>
            <List className="mr-1.5 h-4 w-4" />
            All sales
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex rounded-lg border p-1">
            <Button
              type="button"
              variant={saleMode === 'WALK_IN' ? 'default' : 'ghost'}
              size="sm"
              className="flex-1"
              onClick={() => setSaleMode('WALK_IN')}
            >
              <User className="mr-1.5 h-4 w-4" />
              Walk-in guest
            </Button>
            <Button
              type="button"
              variant={saleMode === 'ROOM' ? 'default' : 'ghost'}
              size="sm"
              className="flex-1"
              onClick={() => setSaleMode('ROOM')}
            >
              <BedDouble className="mr-1.5 h-4 w-4" />
              In-house guest
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="transport-guest-name">Guest name *</Label>
              <Input
                id="transport-guest-name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Enter guest name"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="transport-guest-phone">Phone number</Label>
              <Input
                id="transport-guest-phone"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                placeholder="Enter phone number"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="transport-room-number">
                Room number {saleMode === 'ROOM' ? '*' : '(optional)'}
              </Label>
              <Input
                id="transport-room-number"
                value={roomNumber}
                onChange={(e) => setRoomNumber(e.target.value)}
                placeholder={saleMode === 'ROOM' ? 'Enter room number' : 'Optional'}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="transport-amount">Amount (BDT) *</Label>
              <Input
                id="transport-amount"
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => handleAmountChange(e.target.value)}
                placeholder="Enter amount"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="transport-from">From</Label>
              <Input
                id="transport-from"
                value={routeFrom}
                onChange={(e) => setRouteFrom(e.target.value)}
                placeholder="Pickup location"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="transport-to">To</Label>
              <Input
                id="transport-to"
                value={routeTo}
                onChange={(e) => setRouteTo(e.target.value)}
                placeholder="Drop-off location"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="transport-vehicle-type">Vehicle type (optional)</Label>
              <Input
                id="transport-vehicle-type"
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value)}
                placeholder="e.g. Sedan, Microbus, SUV"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="transport-trip-date">Trip date & time</Label>
              <Input
                id="transport-trip-date"
                type="datetime-local"
                value={tripDate}
                onChange={(e) => setTripDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">Payment</p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="transport-pay-amount">Payment amount (BDT)</Label>
                <Input
                  id="transport-pay-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder={recordedBalanceDue > 0 ? String(recordedBalanceDue) : '0'}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Payment method</Label>
                <Select value={paymentMethod} onValueChange={handlePaymentMethodChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHOD_OPTIONS_WITH_PAYMENT.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                type="button"
                className="h-10 w-full bg-emerald-600 hover:bg-emerald-700 text-white sm:w-auto sm:min-w-[5.5rem]"
                onClick={handlePay}
              >
                Pay
              </Button>
            </div>

            {showPayReference ? (
              <div className="space-y-1.5">
                <Label htmlFor="transport-pay-reference">Reference (optional)</Label>
                <Input
                  id="transport-pay-reference"
                  value={payReference}
                  onChange={(e) => setPayReference(e.target.value)}
                  placeholder="Transaction ID or receipt number"
                />
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Balance due:{' '}
              <span
                className={cn(
                  'font-semibold',
                  projectedBalanceDue > 0.01 ? 'text-red-600' : 'text-emerald-600'
                )}
              >
                {formatBdt(projectedBalanceDue)}
              </span>
            </p>

            {paymentLines.length > 0 ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 space-y-2">
                <p className="text-sm font-semibold text-emerald-900">Payments recorded</p>
                {paymentLines.map((line) => (
                  <div key={line.id} className="flex justify-between text-sm">
                    <span>{formatPaymentMethod(line.method)}</span>
                    <span className="font-medium">{formatBdt(line.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-emerald-200 pt-2 text-sm font-semibold">
                  <span>Total paid</span>
                  <span>{formatBdt(totalPaid)}</span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="transport-notes">Notes</Label>
            <Textarea
              id="transport-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
              rows={2}
            />
          </div>

          <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
            <div className="flex items-center justify-between text-base font-semibold">
              <span>Invoice total</span>
              <span>{formatBdt(invoiceTotal)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Paid</span>
              <span className="font-medium text-emerald-700">{formatBdt(totalPaid)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Balance due</span>
              <span
                className={cn(
                  'font-semibold',
                  projectedBalanceDue > 0.01 ? 'text-red-600' : 'text-emerald-600'
                )}
              >
                {formatBdt(projectedBalanceDue)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Standalone invoice only — not posted to room folio. Counted on the current business day.
            </p>
          </div>

          <Button
            type="button"
            className="w-full"
            size="lg"
            disabled={completeSaleMutation.isPending || !isFullyPaid}
            onClick={handleCompleteSale}
          >
            <Send className="mr-2 h-4 w-4" />
            {completeSaleMutation.isPending ? 'Processing…' : 'Complete sale & generate invoice'}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={recentOpen} onOpenChange={setRecentOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Recent transport sales</DialogTitle>
          </DialogHeader>
          {recentLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : recentSales.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No recent sales</p>
          ) : (
            <div className="max-h-[360px] space-y-2 overflow-y-auto">
              {recentSales.map((sale) => (
                <div
                  key={sale.id}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{sale.customerName}</p>
                    <p className="text-xs text-muted-foreground">
                      {sale.saleNumber}
                      {(sale.roomNumber ?? sale.room?.roomNumber)
                        ? ` · Room ${sale.roomNumber ?? sale.room?.roomNumber}`
                        : ''}
                      {sale.invoice?.invoiceNumber ? ` · ${sale.invoice.invoiceNumber}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{formatBdt(sale.totalAmount)}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => openTransportInvoiceTab(sale.id, false)}
                    >
                      Invoice
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <TransportAllSalesDialog open={allSalesOpen} onOpenChange={setAllSalesOpen} />
    </div>
  )
}
