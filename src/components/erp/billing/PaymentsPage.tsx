'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useAuthStore, canAccessHotel, canAccessRestaurant, canAccessAdmin } from '@/lib/auth-store'
import { useToast } from '@/hooks/use-toast'
import { format } from 'date-fns'
import {
  CreditCard, Plus, Filter, RefreshCw, Wallet, TrendingUp, Calendar, CalendarRange, FileDown, Loader2, Landmark, AlertCircle
} from 'lucide-react'
import {
  BOOKING_DATE_PRESET_OPTIONS,
  resolveBookingDateRange,
  type BookingDatePreset,
} from '@/lib/booking-date-filter'
import {
  buildPaymentsExportQuery,
  downloadPaymentsPdf,
  type PaymentExportRecord,
} from '@/lib/payments-export'
import {
  formatPaymentLastFourDisplay,
  formatPaymentMethod,
  formatPaymentReferenceDisplay,
  isValidPaymentAccountLastFour,
  PAYMENT_METHOD_OPTIONS_WITH_PAYMENT,
  paymentRequiresLastFour,
  paymentRequiresReference,
} from '@/lib/payment-method'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { getPaginationPages } from '@/lib/pagination-pages'
import { cn } from '@/lib/utils'
import { openCloudViewRestaurantLedgerTab } from '@/lib/company-ledger-navigation'
import { formatRestaurantPaymentSourceLabel } from '@/lib/restaurant-order-settle'

type RestaurantSourceFilter = 'all' | 'HOTEL_DUE' | 'RESTAURANT_DIRECT'

interface Payment {
  id: string
  amount: number
  method: string
  paymentType: string
  bookingId: string | null
  orderId: string | null
  reference: string | null
  accountLastFour: string | null
  notes: string | null
  createdAt: string
  booking: {
    id: string
    customer: { id: string; name: string }
    room: { id: string; roomNumber: string }
  } | null
  order: {
    id: string
    orderNumber: string
    orderType: string
  } | null
  receiver: { id: string; name: string; role?: string }
  settlementSource?: string | null
}

interface Booking {
  id: string
  checkIn: string
  checkOut: string
  customer: { id: string; name: string }
  room: { id: string; roomNumber: string; type: { name: string } }
}

const paymentTypeColors: Record<string, string> = {
  ADVANCE: 'bg-amber-50 text-amber-700 border-amber-200',
  INITIAL: 'bg-sky-50 text-sky-700 border-sky-200',
  FINAL: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PARTIAL: 'bg-orange-50 text-orange-700 border-orange-200',
  RESTAURANT: 'bg-purple-50 text-purple-700 border-purple-200',
  REFUND: 'bg-red-50 text-red-700 border-red-200',
}

export default function PaymentsPage() {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const isHotel = canAccessHotel(user?.role) && !canAccessRestaurant(user?.role)
  const isRestaurant = canAccessRestaurant(user?.role) && !canAccessHotel(user?.role)
  const isAdmin = canAccessAdmin(user?.role)
  const canRecordPayment = isHotel || isAdmin

  const [paymentTypeFilter, setPaymentTypeFilter] = useState<string>('all')
  const [restaurantSourceFilter, setRestaurantSourceFilter] =
    useState<RestaurantSourceFilter>('all')
  const [methodFilter, setMethodFilter] = useState<string>('all')
  const [datePreset, setDatePreset] = useState<BookingDatePreset>('today')
  const [customDateFrom, setCustomDateFrom] = useState('')
  const [customDateTo, setCustomDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [exporting, setExporting] = useState(false)
  const [showNewPaymentDialog, setShowNewPaymentDialog] = useState(false)
  const [paymentForm, setPaymentForm] = useState({
    paymentType: 'PARTIAL',
    bookingId: '',
    orderId: '',
    amount: '',
    method: 'CASH',
    reference: '',
    accountLastFour: '',
    notes: '',
  })

  const showFormReference = paymentRequiresReference(paymentForm.method)
  const showFormLastFour = paymentRequiresLastFour(paymentForm.method)

  const resetPaymentEntryFields = () => {
    setPaymentForm((f) => ({
      ...f,
      amount: '',
      reference: '',
      accountLastFour: '',
      notes: '',
    }))
  }

  const resetPaymentForm = () => {
    setPaymentForm({
      paymentType: 'PARTIAL',
      bookingId: '',
      orderId: '',
      amount: '',
      method: 'CASH',
      reference: '',
      accountLastFour: '',
      notes: '',
    })
  }

  const handlePaymentMethodChange = (method: string) => {
    setPaymentForm((f) => ({
      ...f,
      method,
      reference: paymentRequiresReference(method) ? f.reference : '',
      accountLastFour: paymentRequiresLastFour(method) ? f.accountLastFour : '',
    }))
  }

  const validatePaymentForm = (): string | null => {
    if (!paymentForm.amount || parseFloat(paymentForm.amount) <= 0) {
      return 'Enter a valid payment amount.'
    }
    if (showFormReference && !paymentForm.reference.trim()) {
      return 'Payment reference is required for this payment method.'
    }
    if (showFormLastFour && !isValidPaymentAccountLastFour(paymentForm.accountLastFour)) {
      return 'Enter exactly 4 digits for card / bKash / Nagad / Upay.'
    }
    return null
  }

  const dateRange = useMemo(
    () => resolveBookingDateRange(datePreset, customDateFrom, customDateTo),
    [datePreset, customDateFrom, customDateTo]
  )

  const buildPaymentsQuery = (p: number, limit: number) => {
    const params = new URLSearchParams()
    params.set('page', String(p))
    params.set('limit', String(limit))
    if (isRestaurant) {
      if (restaurantSourceFilter !== 'all') {
        params.set('settlementSource', restaurantSourceFilter)
      }
    } else if (paymentTypeFilter !== 'all') {
      params.set('paymentType', paymentTypeFilter)
    }
    if (methodFilter !== 'all') params.set('method', methodFilter)
    if (dateRange.dateFrom) params.set('startDate', dateRange.dateFrom)
    if (dateRange.dateTo) params.set('endDate', dateRange.dateTo)
    return `/payments?${params.toString()}`
  }

  const fetchPaymentSum = async (preset: BookingDatePreset) => {
    const range = resolveBookingDateRange(preset)
    const params = new URLSearchParams({ page: '1', limit: '1' })
    if (range.dateFrom) params.set('startDate', range.dateFrom)
    if (range.dateTo) params.set('endDate', range.dateTo)
    const res = await api.get<{ success: boolean; meta?: { sumAmount?: number } }>(
      `/payments?${params.toString()}`
    )
    return res?.meta?.sumAmount ?? 0
  }

  // Fetch payments
  const { data: paymentsData, isLoading } = useQuery({
    queryKey: [
      'payments',
      isRestaurant ? restaurantSourceFilter : paymentTypeFilter,
      methodFilter,
      datePreset,
      customDateFrom,
      customDateTo,
      page,
      pageSize,
      isRestaurant,
    ],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean
        data: Payment[]
        meta?: { total: number; totalPages: number; sumAmount?: number }
      }>(buildPaymentsQuery(page, pageSize))
      return res
    },
    enabled: !!user,
  })

  const { data: todayTotal = 0 } = useQuery({
    queryKey: ['payments-summary', 'today'],
    queryFn: () => fetchPaymentSum('today'),
    enabled: !!user,
  })

  const { data: weekTotal = 0 } = useQuery({
    queryKey: ['payments-summary', 'this_week'],
    queryFn: () => fetchPaymentSum('this_week'),
    enabled: !!user,
  })

  const { data: monthTotal = 0 } = useQuery({
    queryKey: ['payments-summary', 'this_month'],
    queryFn: () => fetchPaymentSum('this_month'),
    enabled: !!user,
  })

  const { data: settlementMeta } = useQuery({
    queryKey: ['cloudview-ledger', 'payments-hint'],
    queryFn: () =>
      api.get<{
        success: boolean
        data?: {
          meta?: {
            openCount: number
            hotelClearedCount: number
            totalOpenDue: number
            totalClearedDue: number
          }
        }
      }>('/company-ledger/cloudview?sort=newest'),
    enabled: !!user && (isRestaurant || isAdmin),
    select: (res) => res?.data?.meta,
  })

  // Fetch bookings for payment dialog
  const { data: bookingsData } = useQuery({
    queryKey: ['bookings-for-payment'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Booking[] }>('/bookings?limit=50&status=CHECKED_IN')
      return res
    },
    enabled: showNewPaymentDialog && (isHotel || isAdmin),
  })

  // Create payment mutation
  const createPaymentMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        amount: parseFloat(paymentForm.amount),
        method: paymentForm.method,
        paymentType: paymentForm.paymentType,
        reference: showFormReference ? paymentForm.reference.trim() : null,
        accountLastFour: showFormLastFour ? paymentForm.accountLastFour.trim() : null,
        notes: paymentForm.notes || null,
      }
      if (paymentForm.bookingId) payload.bookingId = paymentForm.bookingId
      return api.post('/payments', payload)
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      queryClient.invalidateQueries({ queryKey: ['payments-summary'] })
      if (paymentForm.bookingId) {
        queryClient.invalidateQueries({ queryKey: ['bookings'] })
      }
      toast({
        title: 'Payment Recorded',
        description: res.message || 'Payment recorded — enter another or close when done',
      })
      resetPaymentEntryFields()
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message || 'Failed to record payment', variant: 'destructive' })
    },
  })

  const payments = paymentsData?.data || []
  const totalPages = Math.max(paymentsData?.meta?.totalPages || 1, 1)
  const filteredSum = paymentsData?.meta?.sumAmount ?? 0
  const filteredTotal = paymentsData?.meta?.total ?? 0
  const rangeStart = filteredTotal === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, filteredTotal)
  const pageNumbers = getPaginationPages(page, totalPages)

  const handleExportPdf = async () => {
    setExporting(true)
    try {
      const url = buildPaymentsExportQuery({
        paymentType: isRestaurant ? undefined : paymentTypeFilter,
        settlementSource: isRestaurant ? restaurantSourceFilter : undefined,
        method: methodFilter,
        dateFrom: dateRange.dateFrom,
        dateTo: dateRange.dateTo,
      })
      const res = await api.get<{ success: boolean; data: PaymentExportRecord[] }>(url)
      if (!res?.success || !res.data?.length) {
        toast({ title: 'No payments', description: 'No payments to export for the selected filters', variant: 'destructive' })
        return
      }
      await downloadPaymentsPdf(res.data, {
        exportedAt: new Date(),
        generatedBy: user ? { name: user.name, email: user.email, role: user.role } : undefined,
        datePreset,
        customDateFrom,
        customDateTo,
        paymentType: isRestaurant ? restaurantSourceFilter : paymentTypeFilter,
        method: methodFilter,
      })
      toast({ title: 'Exported', description: 'Payments PDF downloaded' })
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Could not export payments',
        variant: 'destructive',
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CreditCard className="h-6 w-6 text-amber-600" />
            Payments
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            {isRestaurant
              ? 'Hotel settlements and order payments from delivered orders'
              : isHotel
                ? 'Hotel booking payments and restaurant payments on guest folios / company ledger'
                : 'Payment records for hotel and restaurant'}
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
          {canRecordPayment && (
            <Button
              onClick={() => setShowNewPaymentDialog(true)}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              <Plus className="h-4 w-4 mr-2" />
              Record Payment
            </Button>
          )}
        </div>
      </div>

      {(isRestaurant || isAdmin) && settlementMeta && (
        settlementMeta.openCount > 0 || settlementMeta.hotelClearedCount > 0
      ) && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm">
                {settlementMeta.openCount > 0 && (
                  <p className="text-amber-900">
                    {settlementMeta.openCount} order{settlementMeta.openCount === 1 ? '' : 's'} awaiting hotel clearance
                    (৳{settlementMeta.totalOpenDue.toLocaleString()}).
                  </p>
                )}
                {settlementMeta.hotelClearedCount > 0 && (
                  <p className={settlementMeta.openCount > 0 ? 'text-sky-800 mt-1' : 'text-sky-800'}>
                    {settlementMeta.hotelClearedCount} order{settlementMeta.hotelClearedCount === 1 ? '' : 's'} ready to record payment
                    (৳{settlementMeta.totalClearedDue.toLocaleString()}) — open CloudView Restaurant ledger.
                  </p>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-amber-300"
              onClick={() => openCloudViewRestaurantLedgerTab()}
            >
              <Landmark className="h-4 w-4 mr-2" />
              Open ledger
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-lg bg-emerald-50">
              <Wallet className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Today</p>
              <p className="text-xl font-bold text-foreground">৳{todayTotal.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-lg bg-amber-50">
              <Calendar className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">This Week</p>
              <p className="text-xl font-bold text-foreground">৳{weekTotal.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-lg bg-sky-50">
              <TrendingUp className="h-5 w-5 text-sky-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">This Month</p>
              <p className="text-xl font-bold text-foreground">৳{monthTotal.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row flex-wrap gap-3">
            <Select
              value={datePreset}
              onValueChange={(v) => {
                setDatePreset(v as BookingDatePreset)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full sm:w-44">
                <CalendarRange className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Date" />
              </SelectTrigger>
              <SelectContent>
                {BOOKING_DATE_PRESET_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {datePreset === 'custom' && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="payment-date-from" className="text-xs text-muted-foreground">
                    From
                  </Label>
                  <Input
                    id="payment-date-from"
                    type="date"
                    value={customDateFrom}
                    onChange={(e) => {
                      setCustomDateFrom(e.target.value)
                      setPage(1)
                    }}
                    className="w-40"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="payment-date-to" className="text-xs text-muted-foreground">
                    To
                  </Label>
                  <Input
                    id="payment-date-to"
                    type="date"
                    value={customDateTo}
                    onChange={(e) => {
                      setCustomDateTo(e.target.value)
                      setPage(1)
                    }}
                    className="w-40"
                  />
                </div>
              </>
            )}
            {isRestaurant ? (
              <Select
                value={restaurantSourceFilter}
                onValueChange={(v) => {
                  setRestaurantSourceFilter(v as RestaurantSourceFilter)
                  setPage(1)
                }}
              >
                <SelectTrigger className="w-full sm:w-52">
                  <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  <SelectItem value="HOTEL_DUE">Hotel settlement</SelectItem>
                  <SelectItem value="RESTAURANT_DIRECT">Order payment</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Select
                value={paymentTypeFilter}
                onValueChange={(v) => {
                  setPaymentTypeFilter(v)
                  setPage(1)
                }}
              >
                <SelectTrigger className="w-full sm:w-48">
                  <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="Payment type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="ADVANCE">Advance</SelectItem>
                  <SelectItem value="INITIAL">Initial</SelectItem>
                  <SelectItem value="FINAL">Final</SelectItem>
                  <SelectItem value="PARTIAL">Partial</SelectItem>
                  <SelectItem value="RESTAURANT">Restaurant</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Select
              value={methodFilter}
              onValueChange={(v) => {
                setMethodFilter(v)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Payment method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Methods</SelectItem>
                {PAYMENT_METHOD_OPTIONS_WITH_PAYMENT.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ['payments'] })
                queryClient.invalidateQueries({ queryKey: ['payments-summary'] })
              }}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Payments Table */}
      <Card>
        <CardContent className="p-0">
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>{isRestaurant ? 'Source' : 'Type'}</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Last 4</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Room / Order</TableHead>
                  <TableHead>Received By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 9 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : payments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      No payments found
                    </TableCell>
                  </TableRow>
                ) : (
                  payments.map((payment) => (
                    <TableRow key={payment.id} className="hover:bg-muted">
                      <TableCell className="text-sm">
                        {format(new Date(payment.createdAt), 'MMM dd, yyyy HH:mm')}
                      </TableCell>
                      <TableCell>
                        {isRestaurant ? (
                          <Badge
                            variant="outline"
                            className={
                              payment.settlementSource === 'HOTEL_DUE'
                                ? 'bg-sky-50 text-sky-800 border-sky-200'
                                : 'bg-purple-50 text-purple-800 border-purple-200'
                            }
                          >
                            {formatRestaurantPaymentSourceLabel(payment.settlementSource)}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className={paymentTypeColors[payment.paymentType] || ''}>
                            {payment.paymentType}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{formatPaymentMethod(payment.method)}</TableCell>
                      <TableCell className="text-right font-semibold text-emerald-600">
                        ৳{payment.amount.toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[140px] truncate">
                        {formatPaymentReferenceDisplay(payment.method, payment.reference)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatPaymentLastFourDisplay(payment.method, payment.accountLastFour)}
                      </TableCell>
                      <TableCell className="text-sm max-w-[160px] truncate">
                        {payment.notes || '—'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {payment.booking?.room?.roomNumber && (
                          <div>Room {payment.booking.room.roomNumber}</div>
                        )}
                        {payment.order?.orderNumber && (
                          <div className="text-xs text-muted-foreground font-mono">
                            {payment.order.orderNumber}
                          </div>
                        )}
                        {!payment.booking?.room?.roomNumber && !payment.order?.orderNumber && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{payment.receiver?.name || 'N/A'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {!isLoading && payments.length > 0 && (
            <div className="flex flex-col gap-2 border-t bg-emerald-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-muted-foreground">
                {filteredTotal} payment{filteredTotal === 1 ? '' : 's'} in selected period
              </span>
              <span className="text-base font-bold text-emerald-700">
                Total: ৳{filteredSum.toLocaleString()}
              </span>
            </div>
          )}
          <div className="flex flex-col gap-3 border-t bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {filteredTotal === 0 ? 'No results' : `Showing ${rangeStart}–${rangeEnd} of ${filteredTotal}`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v))
                  setPage(1)
                }}
              >
                <SelectTrigger className="h-8 w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 / page</SelectItem>
                  <SelectItem value="20">20 / page</SelectItem>
                  <SelectItem value="50">50 / page</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <div className="flex flex-wrap items-center gap-1">
                {pageNumbers.map((item, index) =>
                  item === 'ellipsis' ? (
                    <span
                      key={`ellipsis-${index}`}
                      className="flex h-8 min-w-8 items-center justify-center px-1 text-sm text-muted-foreground"
                    >
                      …
                    </span>
                  ) : (
                    <Button
                      key={item}
                      type="button"
                      variant="outline"
                      size="sm"
                      className={cn(
                        'h-8 min-w-8 px-2',
                        item === page &&
                          'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white'
                      )}
                      onClick={() => setPage(item)}
                      aria-current={item === page ? 'page' : undefined}
                    >
                      {item}
                    </Button>
                  )
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      </div>

      {/* New Payment Dialog */}
      <Dialog
        open={showNewPaymentDialog}
        onOpenChange={(open) => {
          setShowNewPaymentDialog(open)
          if (!open) resetPaymentForm()
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record New Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Payment Type</Label>
              <Select value={paymentForm.paymentType} onValueChange={(v) => setPaymentForm((f) => ({ ...f, paymentType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(isHotel || isAdmin) && (
                    <>
                      <SelectItem value="ADVANCE">Advance</SelectItem>
                      <SelectItem value="INITIAL">Initial</SelectItem>
                      <SelectItem value="FINAL">Final</SelectItem>
                      <SelectItem value="PARTIAL">Partial</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Show booking selector for hotel payments */}
            {(isHotel || isAdmin) && (
              <div>
                <Label>Select Booking (Hotel)</Label>
                <Select value={paymentForm.bookingId} onValueChange={(v) => setPaymentForm((f) => ({ ...f, bookingId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Choose a booking" /></SelectTrigger>
                  <SelectContent>
                    {bookingsData?.data?.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.customer?.name} - Room {b.room?.roomNumber}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>Amount (৳)</Label>
              <Input
                type="number"
                placeholder="Enter amount"
                value={paymentForm.amount}
                onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>

            <div>
              <Label>Payment Method</Label>
              <Select value={paymentForm.method} onValueChange={handlePaymentMethodChange}>
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

            {(showFormReference || showFormLastFour) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {showFormReference && (
                  <div>
                    <Label>
                      Reference <span className="text-red-600">*</span>
                    </Label>
                    <Input
                      placeholder="e.g. transaction ID or receipt number"
                      value={paymentForm.reference}
                      onChange={(e) => setPaymentForm((f) => ({ ...f, reference: e.target.value }))}
                    />
                  </div>
                )}
                {showFormLastFour && (
                  <div>
                    <Label>
                      Last 4 digits <span className="text-red-600">*</span>
                    </Label>
                    <Input
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="e.g. 4567"
                      value={paymentForm.accountLastFour}
                      onChange={(e) =>
                        setPaymentForm((f) => ({
                          ...f,
                          accountLastFour: e.target.value.replace(/\D/g, '').slice(0, 4),
                        }))
                      }
                    />
                  </div>
                )}
              </div>
            )}

            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="Payment notes"
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewPaymentDialog(false)}>Done</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={
                !paymentForm.amount ||
                parseFloat(paymentForm.amount) <= 0 ||
                createPaymentMutation.isPending ||
                (showFormReference && !paymentForm.reference.trim()) ||
                (showFormLastFour && !isValidPaymentAccountLastFour(paymentForm.accountLastFour))
              }
              onClick={() => {
                const err = validatePaymentForm()
                if (err) {
                  toast({ title: 'Validation', description: err, variant: 'destructive' })
                  return
                }
                createPaymentMutation.mutate()
              }}
            >
              {createPaymentMutation.isPending ? 'Recording...' : 'Record Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
