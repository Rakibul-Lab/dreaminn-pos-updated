'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Building2, Loader2, Printer, Receipt, Wallet } from 'lucide-react'
import { computeOrderDue } from '@/lib/restaurant-order-dues'
import {
  formatPaymentMethod,
  PAYMENT_METHOD_OPTIONS_WITH_PAYMENT,
  paymentRequiresReference,
} from '@/lib/payment-method'
import { openRestaurantReceiptTab } from '@/lib/restaurant-receipt-navigation'
import { formatBdt } from '@/lib/currency'
import { resolveSlipRemainderPreview } from '@/lib/restaurant-order-billing'
import { cn } from '@/lib/utils'

export type RestaurantOrderPaymentTarget = {
  id: string
  orderNumber: string
  totalAmount: number
  payments?: { amount: number; paymentType: string }[]
}

type SessionSlipLine = {
  id: string
  amount: number
  method: string
  methodLabel: string
}

type RestaurantOrderPaymentDialogProps = {
  order: RestaurantOrderPaymentTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
  roomGuestOrder?: boolean
}

function formatPayAmount(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0
  return safe.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function parsePayAmountInput(raw: string): number {
  const parsed = parseFloat(raw.replace(/,/g, ''))
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function invalidateRestaurantPaymentQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['restaurant-orders'] })
  queryClient.invalidateQueries({ queryKey: ['pos-today-orders'] })
  queryClient.invalidateQueries({ queryKey: ['restaurant-orders', 'stats', 'today'] })
  queryClient.invalidateQueries({ queryKey: ['payments'] })
  queryClient.invalidateQueries({ queryKey: ['bookings'] })
  queryClient.invalidateQueries({ queryKey: ['rooms'] })
  queryClient.invalidateQueries({ queryKey: ['cloudview-ledger'] })
  queryClient.invalidateQueries({ queryKey: ['company-ledger'] })
}

async function refreshLiveOrder(orderId: string): Promise<RestaurantOrderPaymentTarget | null> {
  const res = (await api.get(`/restaurant-orders/${orderId}`)) as {
    success?: boolean
    data?: {
      id: string
      orderNumber: string
      totalAmount: number
      payments?: { amount: number; paymentType: string }[]
    }
  }
  if (!res?.success || !res.data) return null
  const { id, orderNumber, totalAmount, payments } = res.data
  return { id, orderNumber, totalAmount, payments }
}

function nextCashReference(orderNumber: string, paymentIndex: number): string {
  return paymentIndex <= 1 ? `CASH-${orderNumber}` : `CASH-${orderNumber}-${paymentIndex}`
}

export function RestaurantOrderPaymentDialog({
  order,
  open,
  onOpenChange,
  roomGuestOrder = false,
}: RestaurantOrderPaymentDialogProps) {
  const queryClient = useQueryClient()
  const [liveOrder, setLiveOrder] = useState<RestaurantOrderPaymentTarget | null>(order)
  const [payMethod, setPayMethod] = useState('CASH')
  const [payAmount, setPayAmount] = useState('')
  const [payReference, setPayReference] = useState('')
  const [payNotes, setPayNotes] = useState('')
  const [slipEnabled, setSlipEnabled] = useState(false)
  const [sessionSlipLines, setSessionSlipLines] = useState<SessionSlipLine[]>([])
  const [postRemainderToGuestFolio, setPostRemainderToGuestFolio] = useState(true)
  const [sendRemainderToHotelLedger, setSendRemainderToHotelLedger] = useState(false)
  const sessionOrderIdRef = useRef<string | null>(null)

  const activeOrder = liveOrder ?? order

  const totals = useMemo(() => {
    if (!activeOrder) {
      return { orderTotal: 0, paidAmount: 0, dueAmount: 0 }
    }
    const { paidAmount, dueAmount } = computeOrderDue(activeOrder.totalAmount, activeOrder.payments ?? [])
    return {
      orderTotal: activeOrder.totalAmount,
      paidAmount,
      dueAmount,
    }
  }, [activeOrder])

  useEffect(() => {
    if (!open) {
      sessionOrderIdRef.current = null
      return
    }
    if (!order) return

    const isNewSession = sessionOrderIdRef.current !== order.id
    if (!isNewSession) return

    sessionOrderIdRef.current = order.id
    setLiveOrder(order)
    setPayMethod('CASH')
    setPayReference(nextCashReference(order.orderNumber, 1))
    setPayNotes('')
    setSlipEnabled(false)
    setSessionSlipLines([])
    setPostRemainderToGuestFolio(true)
    setSendRemainderToHotelLedger(false)
    const { dueAmount } = computeOrderDue(order.totalAmount, order.payments ?? [])
    setPayAmount(dueAmount > 0 ? String(dueAmount) : '')
  }, [open, order])

  const parsedPayAmount = parsePayAmountInput(payAmount)
  const collectingNow = Math.min(parsedPayAmount, totals.dueAmount)
  const balanceAfterCollect =
    totals.dueAmount > 0 ? Math.max(0, totals.dueAmount - collectingNow) : 0
  const hotelBillAfter = roomGuestOrder ? balanceAfterCollect : 0
  const isPartialSettlement =
    collectingNow > 0.009 && balanceAfterCollect > 0.009
  const isFullSettlement = collectingNow > 0.009 && balanceAfterCollect <= 0.009
  const showFolioOptions =
    roomGuestOrder && (isPartialSettlement || (collectingNow <= 0.009 && totals.dueAmount > 0.009))

  const sessionPaidTotal = sessionSlipLines.reduce((sum, line) => sum + line.amount, 0)
  const showSlipSection = totals.paidAmount > 0.009 || sessionSlipLines.length > 0
  const slipRemainderAmount =
    collectingNow > 0.009 ? balanceAfterCollect : totals.dueAmount
  const slipRemainderPreview = resolveSlipRemainderPreview({
    remainderAmount: slipRemainderAmount,
    roomGuestOrder,
    postRemainderToGuestFolio,
    sendRemainderToHotelLedger,
  })

  const settleMutation = useMutation({
    mutationFn: (payload: {
      orderId: string
      amount?: number
      method?: string
      reference?: string
      notes?: string
      settleFull: boolean
      finalizeGuestFolioOnly?: boolean
      postRemainderToGuestFolio: boolean
      sendRemainderToHotelLedger: boolean
    }) =>
      api.post(`/restaurant-orders/${payload.orderId}/settle`, {
        settleFull: payload.settleFull,
        amount: payload.settleFull ? undefined : payload.amount,
        method: payload.method,
        reference: payload.reference,
        notes: payload.notes,
        finalizeGuestFolioOnly: payload.finalizeGuestFolioOnly,
        postRemainderToGuestFolio: payload.postRemainderToGuestFolio,
        sendRemainderToHotelLedger: payload.sendRemainderToHotelLedger,
      }),
  })

  const buildSettlePayload = (mode: 'pay' | 'collect') => {
    if (!activeOrder) return null

    const reference =
      payReference.trim() || (payMethod === 'CASH' ? `CASH-${activeOrder.orderNumber}` : '')

    if (mode === 'pay') {
      if (collectingNow <= 0) {
        toast.error('Enter a payment amount greater than zero')
        return null
      }
      if (collectingNow > totals.dueAmount + 0.01) {
        toast.error(`Amount cannot exceed due balance (${formatBdt(totals.dueAmount)})`)
        return null
      }
      if (!reference) {
        toast.error('Reference is required for this payment method')
        return null
      }
      const settleFull = Math.abs(collectingNow - totals.dueAmount) <= 0.009
      return {
        orderId: activeOrder.id,
        amount: collectingNow,
        method: payMethod,
        reference,
        notes: payNotes.trim() || undefined,
        settleFull,
        postRemainderToGuestFolio: roomGuestOrder && !settleFull,
        sendRemainderToHotelLedger: false,
      }
    }

    if (collectingNow > 0.009) {
      if (collectingNow > totals.dueAmount + 0.01) {
        toast.error(`Amount cannot exceed due balance (${formatBdt(totals.dueAmount)})`)
        return null
      }
      if (!reference) {
        toast.error('Reference is required for this payment method')
        return null
      }
      const settleFull = Math.abs(collectingNow - totals.dueAmount) <= 0.009
      return {
        orderId: activeOrder.id,
        amount: collectingNow,
        method: payMethod,
        reference,
        notes: payNotes.trim() || undefined,
        settleFull,
        postRemainderToGuestFolio: showFolioOptions
          ? postRemainderToGuestFolio
          : settleFull
            ? false
            : roomGuestOrder,
        sendRemainderToHotelLedger: showFolioOptions ? sendRemainderToHotelLedger : false,
      }
    }

    if (totals.dueAmount > 0.009 && roomGuestOrder && (postRemainderToGuestFolio || sendRemainderToHotelLedger)) {
      return {
        orderId: activeOrder.id,
        settleFull: false,
        finalizeGuestFolioOnly: true,
        postRemainderToGuestFolio,
        sendRemainderToHotelLedger,
      }
    }

    return { orderId: activeOrder.id, finalizeOnly: true as const }
  }

  const handlePay = async () => {
    const payload = buildSettlePayload('pay')
    if (!payload || !activeOrder) return

    try {
      const res = (await settleMutation.mutateAsync(payload)) as {
        success?: boolean
        message?: string
        error?: string
        data?: { paidAmount?: number; remainingDue?: number; isFullySettled?: boolean }
      }
      if (!res?.success) {
        toast.error(res?.error || 'Payment failed')
        return
      }

      const paidNow = res.data?.paidAmount ?? payload.amount ?? 0
      const remainingDue = res.data?.remainingDue ?? 0
      const nextPaymentIndex = sessionSlipLines.length + 2

      setSessionSlipLines((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${prev.length}`,
          amount: paidNow,
          method: payMethod,
          methodLabel: formatPaymentMethod(payMethod),
        },
      ])

      setLiveOrder((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          payments: [
            ...(prev.payments ?? []),
            { amount: paidNow, paymentType: 'RESTAURANT' },
          ],
        }
      })

      setPayAmount('')
      if (payMethod === 'CASH') {
        setPayReference(nextCashReference(activeOrder.orderNumber, nextPaymentIndex))
      }

      toast.success(
        remainingDue > 0.009
          ? `Paid ${formatBdt(paidNow)} — ${formatBdt(remainingDue)} still due`
          : `Paid ${formatBdt(paidNow)} — bill fully settled`
      )

      const refreshed = await refreshLiveOrder(payload.orderId)
      if (refreshed?.payments?.length) {
        setLiveOrder(refreshed)
      }

      invalidateRestaurantPaymentQueries(queryClient)
    } catch (error) {
      toast.error('Payment failed', {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  const handleCollect = async () => {
    const payload = buildSettlePayload('collect')
    if (!payload || !activeOrder) return

    if ('finalizeOnly' in payload) {
      onOpenChange(false)
      invalidateRestaurantPaymentQueries(queryClient)
      if (slipEnabled) {
        openRestaurantReceiptTab(activeOrder.id, { autoPrint: true })
      }
      return
    }

    try {
      const res = (await settleMutation.mutateAsync(payload)) as {
        success?: boolean
        message?: string
        error?: string
        data?: { paidAmount?: number }
      }
      if (!res?.success) {
        toast.error(res?.error || 'Payment failed')
        return
      }

      toast.success(res.message || 'Bill updated')
      onOpenChange(false)
      invalidateRestaurantPaymentQueries(queryClient)
      if (slipEnabled) {
        openRestaurantReceiptTab(activeOrder.id, { autoPrint: true })
      }
    } catch (error) {
      toast.error('Failed to collect', {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  const collectLabel = (() => {
    const slipSuffix = slipEnabled && showSlipSection ? ' & slip' : ''
    if (totals.dueAmount <= 0.009) {
      return sessionSlipLines.length > 0 || slipEnabled ? `Done${slipSuffix}` : 'Close'
    }
    if (collectingNow > 0.009) {
      if (isFullSettlement) return `Collect ${formatPayAmount(collectingNow)}${slipSuffix}`
      if (showFolioOptions && postRemainderToGuestFolio) {
        return `Collect ${formatPayAmount(collectingNow)} & close${slipSuffix}`
      }
      return `Collect ${formatPayAmount(collectingNow)}${slipSuffix}`
    }
    return `Collect & close${slipSuffix}`
  })()

  const isBusy = settleMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 border-b px-6 py-5 pr-14">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Wallet className="h-5 w-5 text-emerald-600" />
            Collect payment
          </DialogTitle>
          {activeOrder && (
            <p className="text-sm text-muted-foreground font-mono pt-0.5">{activeOrder.orderNumber}</p>
          )}
        </DialogHeader>

        {activeOrder && (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <Card className="border-emerald-200/80 bg-emerald-50/40">
              <CardContent className="p-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Order total</p>
                  <p className="font-semibold tabular-nums">{formatBdt(totals.orderTotal)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Paid at restaurant</p>
                  <p className="font-semibold tabular-nums text-emerald-800">
                    {formatBdt(totals.paidAmount)}
                  </p>
                </div>
                <div className="col-span-2 pt-1 border-t border-emerald-200/60">
                  <p className="text-xs text-muted-foreground">Balance due now</p>
                  <p
                    className={cn(
                      'text-2xl font-bold tabular-nums transition-colors',
                      totals.dueAmount <= 0.009 ? 'text-emerald-700' : 'text-emerald-900'
                    )}
                  >
                    {formatBdt(totals.dueAmount)}
                  </p>
                  {totals.dueAmount <= 0.009 && sessionSlipLines.length > 0 && (
                    <p className="text-xs text-emerald-700 mt-1">
                      Fully paid — click Collect to close
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-2">
              <Label htmlFor="restaurant-pay-amount">Payment</Label>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[7rem] flex-1">
                  <Input
                    id="restaurant-pay-amount"
                    type="number"
                    min={0}
                    step="0.01"
                    max={totals.dueAmount}
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    placeholder="Amount"
                    className="h-9"
                  />
                </div>
                <Select
                  value={payMethod}
                  onValueChange={(v) => {
                    setPayMethod(v)
                    if (v === 'CASH' && activeOrder) {
                      setPayReference(
                        nextCashReference(activeOrder.orderNumber, sessionSlipLines.length + 1)
                      )
                    }
                  }}
                >
                  <SelectTrigger className="h-9 w-[8.5rem] shrink-0">
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0"
                  disabled={totals.dueAmount <= 0 || isBusy}
                  onClick={() => setPayAmount(String(totals.dueAmount))}
                >
                  Pay full
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-9 shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={isBusy || totals.dueAmount <= 0 || collectingNow <= 0}
                  onClick={handlePay}
                >
                  {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Pay'}
                </Button>
              </div>
              {parsedPayAmount > 0.009 && totals.dueAmount > 0.009 && (
                <div
                  className={cn(
                    'flex items-center justify-between rounded-md border px-3 py-2 text-sm',
                    balanceAfterCollect > 0.009
                      ? 'border-amber-200 bg-amber-50/80'
                      : 'border-emerald-200 bg-emerald-50/80'
                  )}
                >
                  <span className="text-muted-foreground">
                    Collecting{' '}
                    <span className="font-semibold tabular-nums text-emerald-800">
                      {formatBdt(collectingNow)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">
                      {slipRemainderPreview?.label ?? 'Due'}
                    </span>
                    <span
                      className={cn(
                        'text-base font-bold tabular-nums',
                        slipRemainderPreview?.destination === 'SENT_TO_HOTEL'
                          ? 'text-sky-900'
                          : slipRemainderPreview?.destination === 'GUEST_ROOM_BILL'
                            ? 'text-sky-800'
                            : balanceAfterCollect > 0.009
                              ? 'text-amber-900'
                              : 'text-emerald-800'
                      )}
                    >
                      {formatBdt(balanceAfterCollect)}
                    </span>
                  </span>
                </div>
              )}
            </div>

            {sessionSlipLines.length > 0 && (
              <Card className="border-emerald-200/70 bg-white">
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold uppercase tracking-wide text-muted-foreground">
                      Payments this session
                    </span>
                    <span className="font-medium tabular-nums text-emerald-800">
                      {formatBdt(sessionPaidTotal)}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {sessionSlipLines.map((line, index) => (
                      <div
                        key={line.id}
                        className="flex items-center justify-between rounded-md bg-emerald-50/60 px-3 py-2 text-sm"
                      >
                        <span className="text-muted-foreground">
                          #{index + 1} · {line.methodLabel}
                        </span>
                        <span className="font-semibold tabular-nums">{formatBdt(line.amount)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {showSlipSection && (
              <>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-slate-600" />
                    <div>
                      <Label htmlFor="payment-slip-toggle" className="text-sm font-medium cursor-pointer">
                        Print payment slip
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Off by default — opens when you click Collect
                      </p>
                    </div>
                  </div>
                  <Switch
                    id="payment-slip-toggle"
                    checked={slipEnabled}
                    onCheckedChange={setSlipEnabled}
                  />
                </div>

                {slipEnabled && (
                  <Card className="border-dashed border-slate-300 bg-slate-50/80">
                    <CardContent className="p-4 space-y-3 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                        <Printer className="h-3.5 w-3.5" />
                        Slip preview
                      </p>

                      <div className="space-y-1.5">
                        <p className="text-xs text-muted-foreground">Paid at restaurant</p>
                        <div className="flex items-center justify-between rounded-md border bg-white px-3 py-2">
                          <span className="text-muted-foreground">Total collected</span>
                          <span className="font-semibold tabular-nums">{formatBdt(totals.paidAmount)}</span>
                        </div>
                      </div>

                      {collectingNow > 0.009 && totals.dueAmount > 0.009 && (
                        <>
                          <Separator />
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="rounded-lg border bg-white px-3 py-2.5">
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Wallet className="h-3.5 w-3.5 text-emerald-600" />
                                On Collect
                              </p>
                              <p className="text-lg font-bold tabular-nums text-emerald-800 mt-0.5">
                                {formatBdt(collectingNow)}
                              </p>
                            </div>
                            {slipRemainderPreview && (
                              <div
                                className={cn(
                                  'rounded-lg border px-3 py-2.5',
                                  slipRemainderPreview.destination === 'SENT_TO_HOTEL'
                                    ? 'border-sky-200 bg-sky-50/80'
                                    : slipRemainderPreview.destination === 'GUEST_ROOM_BILL'
                                      ? 'border-sky-200 bg-sky-50/50'
                                      : 'border-amber-200 bg-amber-50/80'
                                )}
                              >
                                <p className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Building2
                                    className={cn(
                                      'h-3.5 w-3.5',
                                      slipRemainderPreview.destination === 'SENT_TO_HOTEL'
                                        ? 'text-sky-700'
                                        : slipRemainderPreview.destination === 'GUEST_ROOM_BILL'
                                          ? 'text-sky-600'
                                          : 'text-amber-600'
                                    )}
                                  />
                                  {slipRemainderPreview.label}
                                </p>
                                <p
                                  className={cn(
                                    'text-lg font-bold tabular-nums mt-0.5',
                                    slipRemainderPreview.destination === 'SENT_TO_HOTEL'
                                      ? 'text-sky-900'
                                      : slipRemainderPreview.destination === 'GUEST_ROOM_BILL'
                                        ? 'text-sky-800'
                                        : 'text-amber-900'
                                  )}
                                >
                                  {formatBdt(slipRemainderAmount)}
                                </p>
                              </div>
                            )}
                          </div>
                        </>
                      )}

                      {slipRemainderPreview && slipRemainderAmount > 0.009 && (
                        <p
                          className={cn(
                            'text-xs rounded-md px-3 py-2 border',
                            slipRemainderPreview.destination === 'SENT_TO_HOTEL'
                              ? 'border-sky-200 bg-sky-50 text-sky-900'
                              : slipRemainderPreview.destination === 'GUEST_ROOM_BILL'
                                ? 'border-sky-100 bg-sky-50/60 text-sky-800'
                                : 'border-amber-100 bg-amber-50/60 text-amber-900'
                          )}
                        >
                          {slipRemainderPreview.note}
                        </p>
                      )}

                      {totals.dueAmount > 0.009 && collectingNow <= 0.009 && slipRemainderPreview && (
                        <div
                          className={cn(
                            'flex items-center justify-between rounded-md border px-3 py-2',
                            slipRemainderPreview.destination === 'SENT_TO_HOTEL'
                              ? 'border-sky-200 bg-sky-50/80'
                              : slipRemainderPreview.destination === 'GUEST_ROOM_BILL'
                                ? 'border-sky-100 bg-white'
                                : 'border-amber-200 bg-white'
                          )}
                        >
                          <span className="text-muted-foreground">{slipRemainderPreview.label}</span>
                          <span
                            className={cn(
                              'font-semibold tabular-nums',
                              slipRemainderPreview.destination === 'SENT_TO_HOTEL'
                                ? 'text-sky-900'
                                : slipRemainderPreview.destination === 'GUEST_ROOM_BILL'
                                  ? 'text-sky-800'
                                  : 'text-amber-900'
                            )}
                          >
                            {formatBdt(totals.dueAmount)}
                          </span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            {showFolioOptions && (
              <Card className="border-sky-200/80 bg-sky-50/30">
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 pr-2">
                      <Label htmlFor="post-guest-folio" className="text-sm font-medium leading-snug">
                        Post remaining balance to guest room bill
                      </Label>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {formatBdt(collectingNow > 0.009 ? hotelBillAfter : totals.dueAmount)} will be
                        added to the guest hotel invoice when you collect.
                      </p>
                    </div>
                    <Switch
                      id="post-guest-folio"
                      checked={postRemainderToGuestFolio}
                      onCheckedChange={setPostRemainderToGuestFolio}
                    />
                  </div>
                  <Separator />
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 pr-2">
                      <Label htmlFor="send-hotel-ledger" className="text-sm font-medium leading-snug">
                        Also send balance to hotel ledger
                      </Label>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Optional. Posts the remaining balance to CloudView hotel billing.
                      </p>
                    </div>
                    <Switch
                      id="send-hotel-ledger"
                      checked={sendRemainderToHotelLedger}
                      onCheckedChange={setSendRemainderToHotelLedger}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {paymentRequiresReference(payMethod) && (
              <div className="space-y-2">
                <Label>Reference / receipt no. *</Label>
                <Input
                  value={payReference}
                  onChange={(e) => setPayReference(e.target.value)}
                  placeholder="Transaction reference"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                rows={2}
                placeholder="Optional payment notes"
              />
            </div>
          </div>
        )}

        <DialogFooter className="shrink-0 flex-col sm:flex-row gap-3 border-t bg-muted/20 px-6 py-4">
          {showSlipSection && slipEnabled && (
            <p className="mr-auto text-xs text-muted-foreground hidden sm:block">
              Payment slip will open when you collect
            </p>
          )}
          <div className="flex w-full sm:w-auto gap-3 sm:ml-auto">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isBusy}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[9rem]"
              disabled={isBusy || !activeOrder}
              onClick={handleCollect}
            >
              {isBusy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing…
                </>
              ) : (
                collectLabel
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
