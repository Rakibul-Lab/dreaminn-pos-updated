'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { api } from '@/lib/api-client'
import { useAuthStore, canAccessAdmin, canAccessHotel } from '@/lib/auth-store'
import { formatBdt } from '@/lib/currency'
import { formatSettlementStage } from '@/lib/cloudview-ledger'
import {
  BOOKING_DATE_PRESET_OPTIONS,
  resolveBookingDateRange,
  type BookingDatePreset,
} from '@/lib/booking-date-filter'
import {
  formatPaymentMethod,
  PAYMENT_METHOD_OPTIONS_WITH_PAYMENT,
  paymentRequiresLastFour,
  paymentRequiresReference,
  isValidPaymentAccountLastFour,
} from '@/lib/payment-method'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  buildCloudViewLedgerExportQuery,
  downloadCloudViewLedgerPdf,
  type CloudViewLedgerBillExportRecord,
} from '@/lib/cloudview-ledger-export'
import { Building2, CalendarRange, CheckCircle2, FileDown, Loader2, Search, Wallet } from 'lucide-react'
import { toast } from 'sonner'

type LedgerBill = {
  id: string
  guestName: string
  roomNumber?: string | null
  orderNumber?: string | null
  orderType?: string | null
  totalAmount: number
  paidAmount: number
  dueAmount: number
  settlementStage: string
  billedAt: string
  hotelClearedAt?: string | null
  hotelClearer?: { id: string; name: string } | null
  restaurantOrder?: {
    orderNumber: string
    orderType: string
    status: string
  } | null
}

type StageFilter = 'all' | 'OPEN' | 'HOTEL_CLEARED' | 'PAID'
type SortFilter = 'newest' | 'oldest' | 'amount_desc' | 'amount_asc'

export function CloudViewRestaurantLedgerView() {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const canHotelClear = canAccessAdmin(user?.role) || user?.role === 'HOTEL_STAFF' || user?.role === 'HOTEL_FD'
  const canRecordPayment = canAccessAdmin(user?.role) || user?.role === 'RESTAURANT_STAFF'

  const [stageFilter, setStageFilter] = useState<StageFilter>('all')
  const [sortFilter, setSortFilter] = useState<SortFilter>('newest')
  const [datePreset, setDatePreset] = useState<BookingDatePreset>('all')
  const [customDateFrom, setCustomDateFrom] = useState('')
  const [customDateTo, setCustomDateTo] = useState('')
  const [search, setSearch] = useState('')

  const [payBill, setPayBill] = useState<LedgerBill | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('CASH')
  const [payReference, setPayReference] = useState('')
  const [payLastFour, setPayLastFour] = useState('')
  const [payNotes, setPayNotes] = useState('')
  const [exporting, setExporting] = useState(false)

  const dateRange = useMemo(
    () => resolveBookingDateRange(datePreset, customDateFrom, customDateTo),
    [datePreset, customDateFrom, customDateTo]
  )

  const buildQuery = () => {
    const params = new URLSearchParams()
    if (stageFilter !== 'all') params.set('stage', stageFilter)
    params.set('sort', sortFilter)
    if (dateRange.dateFrom) params.set('dateFrom', dateRange.dateFrom)
    if (dateRange.dateTo) params.set('dateTo', dateRange.dateTo)
    if (search.trim()) params.set('search', search.trim())
    return `/company-ledger/cloudview?${params.toString()}`
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: [
      'cloudview-ledger',
      stageFilter,
      sortFilter,
      datePreset,
      customDateFrom,
      customDateTo,
      search,
    ],
    queryFn: () =>
      api.get<{
        success: boolean
        data: {
          ledger: {
            name: string
            totalBilled: number
            totalPaid: number
            dueAmount: number
          }
          bills: LedgerBill[]
          meta: {
            openCount: number
            hotelClearedCount: number
            totalOpenDue: number
            totalClearedDue: number
          }
        }
      }>(buildQuery()),
  })

  const ledger = data?.data?.ledger
  const bills = data?.data?.bills ?? []
  const meta = data?.data?.meta

  const hotelClearMutation = useMutation({
    mutationFn: (billId: string) =>
      api.post(`/company-ledger/bills/${billId}/hotel-clear`, {}),
    onSuccess: (res: { success?: boolean; message?: string; error?: string }) => {
      if (!res?.success) {
        toast.error(res?.error || 'Failed to clear hotel due')
        return
      }
      toast.success(res.message || 'Hotel due cleared')
      queryClient.invalidateQueries({ queryKey: ['cloudview-ledger'] })
      queryClient.invalidateQueries({ queryKey: ['company-ledger'] })
      queryClient.invalidateQueries({ queryKey: ['payments'] })
    },
    onError: () => toast.error('Failed to clear hotel due'),
  })

  const hotelClearAllMutation = useMutation({
    mutationFn: () => api.post('/company-ledger/cloudview/hotel-clear-all', {}),
    onSuccess: (res: { success?: boolean; message?: string; error?: string }) => {
      if (!res?.success) {
        toast.error(res?.error || 'Failed to clear dues')
        return
      }
      toast.success(res.message || 'All open dues cleared')
      queryClient.invalidateQueries({ queryKey: ['cloudview-ledger'] })
      queryClient.invalidateQueries({ queryKey: ['company-ledger'] })
      queryClient.invalidateQueries({ queryKey: ['payments'] })
    },
    onError: () => toast.error('Failed to clear all dues'),
  })

  const payMutation = useMutation({
    mutationFn: (payload: {
      billId: string
      amount: number
      method: string
      reference?: string
      accountLastFour?: string
      notes?: string
    }) => api.post(`/company-ledger/bills/${payload.billId}/restaurant-payment`, payload),
    onSuccess: (res: {
      success?: boolean
      message?: string
      error?: string
      data?: { billDueAmount?: number }
    }, variables) => {
      if (!res?.success) {
        toast.error(res?.error || 'Failed to record payment')
        return
      }
      const newDue = res.data?.billDueAmount ?? 0
      toast.success(
        newDue <= 0.009
          ? res.message || 'Payment recorded — bill cleared'
          : res.message || 'Payment recorded — enter another or close when done'
      )
      if (newDue <= 0.009) {
        setPayBill(null)
      } else {
        setPayBill((prev) =>
          prev && prev.id === variables.billId ? { ...prev, dueAmount: newDue } : prev
        )
        setPayAmount(String(newDue))
      }
      setPayReference('')
      setPayLastFour('')
      setPayNotes('')
      setPayMethod('CASH')
      queryClient.invalidateQueries({ queryKey: ['cloudview-ledger'] })
      queryClient.invalidateQueries({ queryKey: ['payments'] })
    },
    onError: () => toast.error('Failed to record payment'),
  })

  const openPayDialog = (bill: LedgerBill) => {
    setPayBill(bill)
    setPayAmount(String(bill.dueAmount))
    setPayMethod('CASH')
    setPayReference('')
    setPayLastFour('')
    setPayNotes('')
  }

  const showPayReference = paymentRequiresReference(payMethod)
  const showPayLastFour = paymentRequiresLastFour(payMethod)

  const handleExportPdf = async () => {
    setExporting(true)
    try {
      const path = buildCloudViewLedgerExportQuery({
        stage: stageFilter,
        sort: sortFilter,
        dateFrom: dateRange.dateFrom,
        dateTo: dateRange.dateTo,
        search,
      })
      const res = await api.get<{
        success: boolean
        data?: {
          ledger: { name: string; totalBilled: number; totalPaid: number; dueAmount: number }
          bills: CloudViewLedgerBillExportRecord[]
        }
      }>(path)
      const exportBills = res?.data?.bills ?? []
      if (!exportBills.length) {
        toast.error('No ledger bills match the selected filters')
        return
      }
      await downloadCloudViewLedgerPdf(exportBills, {
        exportedAt: new Date(),
        generatedBy: user
          ? { name: user.name, email: user.email, role: user.role }
          : undefined,
        ledgerName: res.data?.ledger?.name ?? ledger?.name,
        totalBilled: res.data?.ledger?.totalBilled,
        totalPaid: res.data?.ledger?.totalPaid,
        dueAmount: res.data?.ledger?.dueAmount,
        datePreset,
        customDateFrom,
        customDateTo,
        stage: stageFilter,
        sort: sortFilter,
        search,
      })
      toast.success('Ledger PDF downloaded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not export ledger PDF')
    } finally {
      setExporting(false)
    }
  }

  const stageBadgeClass = (stage: string) => {
    if (stage === 'OPEN') return 'bg-amber-50 text-amber-800 border-amber-200'
    if (stage === 'HOTEL_CLEARED') return 'bg-sky-50 text-sky-800 border-sky-200'
    return 'bg-emerald-50 text-emerald-800 border-emerald-200'
  }

  if (isError) {
    return <div className="p-8 text-red-600">Failed to load CloudView restaurant ledger.</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Building2 className="h-6 w-6 text-emerald-600" />
            {ledger?.name ?? 'CloudView Restaurant'}
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Room service orders billed to the hotel. Hotel clears dues first; restaurant records payment after.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void handleExportPdf()}
            disabled={exporting || isLoading}
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4 mr-2" />
            )}
            Export PDF
          </Button>
          {canHotelClear && (meta?.openCount ?? 0) > 0 && (
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={hotelClearAllMutation.isPending}
              onClick={() => hotelClearAllMutation.mutate()}
            >
              {hotelClearAllMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Clear all hotel dues ({meta?.openCount})
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total billed</p>
            <p className="text-lg font-bold">{formatBdt(ledger?.totalBilled ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total paid</p>
            <p className="text-lg font-bold text-emerald-700">{formatBdt(ledger?.totalPaid ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Awaiting hotel</p>
            <p className="text-lg font-bold text-amber-700">{formatBdt(meta?.totalOpenDue ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Ready for payment</p>
            <p className="text-lg font-bold text-sky-700">{formatBdt(meta?.totalClearedDue ?? 0)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Guest, order, room…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={stageFilter} onValueChange={(v) => setStageFilter(v as StageFilter)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Stage" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              <SelectItem value="OPEN">Awaiting hotel</SelectItem>
              <SelectItem value="HOTEL_CLEARED">Hotel cleared</SelectItem>
              <SelectItem value="PAID">Paid</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortFilter} onValueChange={(v) => setSortFilter(v as SortFilter)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="amount_desc">Due: high → low</SelectItem>
              <SelectItem value="amount_asc">Due: low → high</SelectItem>
            </SelectContent>
          </Select>
          <Select value={datePreset} onValueChange={(v) => setDatePreset(v as BookingDatePreset)}>
            <SelectTrigger className="w-40">
              <CalendarRange className="h-4 w-4 mr-2 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOOKING_DATE_PRESET_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : bills.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground text-sm">No restaurant ledger bills match filters.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Guest / Room</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bills.map((bill) => (
                  <TableRow key={bill.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {format(new Date(bill.billedAt), 'dd MMM yyyy')}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {bill.orderNumber ?? bill.restaurantOrder?.orderNumber ?? '—'}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{bill.guestName}</div>
                      {bill.roomNumber && (
                        <div className="text-xs text-muted-foreground">Room {bill.roomNumber}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={stageBadgeClass(bill.settlementStage)}>
                        {formatSettlementStage(bill.settlementStage)}
                      </Badge>
                      {bill.hotelClearedAt && bill.hotelClearer && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          by {bill.hotelClearer.name}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatBdt(bill.dueAmount)}
                    </TableCell>
                    <TableCell className="text-right">
                      {bill.settlementStage === 'OPEN' && bill.dueAmount > 0 && canHotelClear && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          disabled={hotelClearMutation.isPending}
                          onClick={() => hotelClearMutation.mutate(bill.id)}
                        >
                          Clear hotel due
                        </Button>
                      )}
                      {bill.settlementStage === 'HOTEL_CLEARED' && bill.dueAmount > 0 && canRecordPayment && (
                        <Button
                          size="sm"
                          className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={() => openPayDialog(bill)}
                        >
                          <Wallet className="h-3.5 w-3.5 mr-1" />
                          Record payment
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!payBill} onOpenChange={(open) => !open && setPayBill(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment — {payBill?.orderNumber}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Amount (৳)</Label>
              <Input
                type="number"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
            </div>
            <div>
              <Label>Method</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHOD_OPTIONS_WITH_PAYMENT.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {showPayReference && (
              <div>
                <Label>Reference *</Label>
                <Input value={payReference} onChange={(e) => setPayReference(e.target.value)} />
              </div>
            )}
            {showPayLastFour && (
              <div>
                <Label>Last 4 digits *</Label>
                <Input
                  inputMode="numeric"
                  maxLength={4}
                  value={payLastFour}
                  onChange={(e) => setPayLastFour(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
              </div>
            )}
            <div>
              <Label>Notes</Label>
              <Textarea value={payNotes} onChange={(e) => setPayNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayBill(null)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={payMutation.isPending}
              onClick={() => {
                if (!payBill) return
                const amount = parseFloat(payAmount)
                if (!amount || amount <= 0) {
                  toast.error('Enter a valid amount')
                  return
                }
                if (showPayReference && !payReference.trim()) {
                  toast.error('Reference is required')
                  return
                }
                if (showPayLastFour && !isValidPaymentAccountLastFour(payLastFour)) {
                  toast.error('Enter exactly 4 digits')
                  return
                }
                payMutation.mutate({
                  billId: payBill.id,
                  amount,
                  method: payMethod,
                  reference: payReference.trim() || undefined,
                  accountLastFour: payLastFour || undefined,
                  notes: payNotes || undefined,
                })
              }}
            >
              {payMutation.isPending ? 'Saving…' : 'Record payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
