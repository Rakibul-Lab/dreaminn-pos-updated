'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useAuthStore, canAccessHotel, canAccessRestaurant, canAccessAdmin } from '@/lib/auth-store'
import { useToast } from '@/hooks/use-toast'
import { format } from 'date-fns'
import {
  CreditCard, Plus, Filter, RefreshCw, Wallet, TrendingUp, Calendar, CalendarRange, FileDown, Loader2, Landmark, AlertCircle, Search,
  Sparkles, Wrench, CircleEllipsis, Receipt,
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
  formatPaymentTypeLabel,
  isValidPaymentAccountLastFour,
  MANUAL_RECORD_PAYMENT_TYPE_OPTIONS,
  PAYMENT_METHOD_OPTIONS_WITH_PAYMENT,
  paymentRequiresLastFour,
  paymentRequiresReference,
} from '@/lib/payment-method'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter
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
import { BookingPaymentSlipButton } from '@/components/erp/hotel/BookingPaymentSlipButton'
import {
  BookingPaymentSearchField,
  type BookingPaymentSearchResult,
} from '@/components/erp/hotel/BookingPaymentSearchField'
import { formatPaymentSlipNumber } from '@/lib/booking-payment-receipt-navigation'

type RestaurantSourceFilter = 'all' | 'HOTEL_DUE' | 'RESTAURANT_DIRECT'

const PAYMENT_SEARCH_PLACEHOLDER =
  'Search reg. no., slip no., room, guest, conf. no., reference…'

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
    confirmationNumber?: string | null
    registrationNumber?: string | null
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

const paymentTypeColors: Record<string, string> = {
  ADVANCE: 'bg-amber-50 text-amber-700 border-amber-200',
  INITIAL: 'bg-sky-50 text-sky-700 border-sky-200',
  FINAL: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PARTIAL: 'bg-orange-50 text-orange-700 border-orange-200',
  EXTRA_CHARGES: 'bg-violet-50 text-violet-700 border-violet-200',
  DAMAGE_CHARGES: 'bg-rose-50 text-rose-700 border-rose-200',
  OTHERS: 'bg-slate-50 text-slate-700 border-slate-200',
  RESTAURANT: 'bg-purple-50 text-purple-700 border-purple-200',
  REFUND: 'bg-red-50 text-red-700 border-red-200',
}

const manualPaymentTypeIcons = {
  EXTRA_CHARGES: Sparkles,
  DAMAGE_CHARGES: Wrench,
  OTHERS: CircleEllipsis,
} as const

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
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [exporting, setExporting] = useState(false)
  const [showNewPaymentDialog, setShowNewPaymentDialog] = useState(false)
  const [selectedBookingLabel, setSelectedBookingLabel] = useState('')
  const [paymentForm, setPaymentForm] = useState({
    paymentType: 'EXTRA_CHARGES',
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchInput.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

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
    setSelectedBookingLabel('')
    setPaymentForm({
      paymentType: 'EXTRA_CHARGES',
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
    if (searchQuery) params.set('search', searchQuery)
    else {
      if (dateRange.dateFrom) params.set('startDate', dateRange.dateFrom)
      if (dateRange.dateTo) params.set('endDate', dateRange.dateTo)
    }
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
      searchQuery,
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
      return api.post<{ success?: boolean; message?: string; error?: string }>('/payments', payload)
    },
    onSuccess: (res: { success?: boolean; message?: string; error?: string }) => {
      if (!res?.success) {
        toast({
          title: 'Error',
          description: res?.error || res?.message || 'Failed to record payment',
          variant: 'destructive',
        })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      queryClient.invalidateQueries({ queryKey: ['payments-summary'] })
      if (paymentForm.bookingId) {
        queryClient.invalidateQueries({ queryKey: ['bookings'] })
        queryClient.invalidateQueries({ queryKey: ['invoices'] })
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
        dateFrom: searchQuery ? undefined : dateRange.dateFrom,
        dateTo: searchQuery ? undefined : dateRange.dateTo,
        search: searchQuery || undefined,
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
        <CardContent className="p-4 space-y-3">
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={PAYMENT_SEARCH_PLACEHOLDER}
              className="pl-9"
              autoComplete="off"
            />
          </div>
          {searchQuery ? (
            <p className="text-xs text-muted-foreground">
              Searching all dates for matching payments. Clear search to use the date filter again.
            </p>
          ) : null}
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
                  <SelectItem value="EXTRA_CHARGES">Extra Charges</SelectItem>
                  <SelectItem value="DAMAGE_CHARGES">Damage Charges</SelectItem>
                  <SelectItem value="OTHERS">Others</SelectItem>
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
                  {!isRestaurant ? <TableHead>Slip No.</TableHead> : null}
                  <TableHead>Reference</TableHead>
                  <TableHead>Last 4</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Room / Order</TableHead>
                  <TableHead>Received By</TableHead>
                  {!isRestaurant ? <TableHead className="text-right">Slip</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: isRestaurant ? 9 : 11 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : payments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isRestaurant ? 9 : 11} className="text-center py-8 text-muted-foreground">
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
                            {formatPaymentTypeLabel(payment.paymentType)}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{formatPaymentMethod(payment.method)}</TableCell>
                      <TableCell className="text-right font-semibold text-emerald-600">
                        ৳{payment.amount.toLocaleString()}
                      </TableCell>
                      {!isRestaurant ? (
                        <TableCell className="font-mono text-[10px] max-w-[120px] truncate">
                          {payment.paymentType !== 'RESTAURANT'
                            ? formatPaymentSlipNumber(payment)
                            : '—'}
                        </TableCell>
                      ) : null}
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
                      {!isRestaurant ? (
                        <TableCell className="text-right">
                          {payment.paymentType !== 'RESTAURANT' ? (
                            <BookingPaymentSlipButton paymentId={payment.id} iconOnly variant="ghost" />
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                      ) : null}
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
        <DialogContent className="flex max-h-[min(92dvh,42rem)] w-[calc(100%-1rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl sm:max-h-[min(90dvh,40rem)]">
          <div className="shrink-0 border-b bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 px-4 py-3 text-white sm:px-5 sm:py-4">
            <DialogHeader className="space-y-1 text-left">
              <div className="flex items-center gap-2.5 sm:gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20 backdrop-blur-sm sm:h-10 sm:w-10 sm:rounded-xl">
                  <Receipt className="h-4 w-4 sm:h-5 sm:w-5" />
                </div>
                <div className="min-w-0 pr-6">
                  <DialogTitle className="text-base font-semibold tracking-tight text-white sm:text-lg">
                    Record New Payment
                  </DialogTitle>
                  <DialogDescription className="line-clamp-1 text-xs text-emerald-50/90 sm:line-clamp-none sm:text-sm">
                    Post a guest payment with charge category and method.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3 sm:space-y-4 sm:px-5 sm:py-4">
            <div className="space-y-2">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Payment type
              </Label>
              <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                {MANUAL_RECORD_PAYMENT_TYPE_OPTIONS.map((option) => {
                  const Icon = manualPaymentTypeIcons[option.value]
                  const selected = paymentForm.paymentType === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setPaymentForm((f) => ({ ...f, paymentType: option.value }))}
                      className={cn(
                        'rounded-lg border p-2 text-center transition-all sm:rounded-xl sm:p-2.5 sm:text-left',
                        selected
                          ? 'border-emerald-500 bg-emerald-50/80 shadow-sm ring-1 ring-emerald-500/30'
                          : 'border-border bg-card hover:border-emerald-200 hover:bg-muted/40'
                      )}
                    >
                      <div className="flex flex-col items-center gap-1.5 sm:flex-row sm:items-start sm:gap-2">
                        <div
                          className={cn(
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md sm:h-8 sm:w-8 sm:rounded-lg',
                            selected ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'
                          )}
                        >
                          <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </div>
                        <div className="min-w-0">
                          <p
                            className={cn(
                              'text-[11px] font-semibold leading-tight sm:text-sm',
                              selected && 'text-emerald-900'
                            )}
                          >
                            <span className="sm:hidden">
                              {option.value === 'EXTRA_CHARGES'
                                ? 'Extra'
                                : option.value === 'DAMAGE_CHARGES'
                                  ? 'Damage'
                                  : 'Other'}
                            </span>
                            <span className="hidden sm:inline">{option.label}</span>
                          </p>
                          <p className="mt-0.5 hidden text-xs leading-snug text-muted-foreground sm:block">
                            {option.description}
                          </p>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {(isHotel || isAdmin) && (
              <div className="space-y-2 rounded-lg border bg-muted/20 p-3 sm:rounded-xl sm:p-3.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Guest booking
                  </Label>
                  <span className="text-[11px] font-normal text-muted-foreground">(optional)</span>
                </div>
                <BookingPaymentSearchField
                  selectedId={paymentForm.bookingId}
                  selectedLabel={selectedBookingLabel}
                  onSelect={(booking: BookingPaymentSearchResult) => {
                    setPaymentForm((f) => ({ ...f, bookingId: booking.id }))
                    setSelectedBookingLabel(
                      `${booking.customer.name} · Room ${booking.room.roomNumber}`
                    )
                  }}
                  onClear={() => {
                    setPaymentForm((f) => ({ ...f, bookingId: '' }))
                    setSelectedBookingLabel('')
                  }}
                />
                {selectedBookingLabel ? (
                  <p className="truncate text-xs text-muted-foreground">
                    Recording for{' '}
                    <span className="font-medium text-foreground">{selectedBookingLabel}</span>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Optional: Search and select a guest stay to link this payment to a booking folio.
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Amount (৳)
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
                  className="h-10 text-base font-semibold"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Payment method
                </Label>
                <Select value={paymentForm.method} onValueChange={handlePaymentMethodChange}>
                  <SelectTrigger className="h-10">
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
            </div>

            {(showFormReference || showFormLastFour) && (
              <div className="grid grid-cols-1 gap-2.5 rounded-lg border bg-muted/15 p-3 sm:grid-cols-2 sm:gap-3 sm:rounded-xl sm:p-3.5">
                {showFormReference && (
                  <div className="space-y-1.5">
                    <Label className="text-sm">
                      Reference <span className="text-red-600">*</span>
                    </Label>
                    <Input
                      placeholder="Transaction ID or receipt no."
                      value={paymentForm.reference}
                      onChange={(e) => setPaymentForm((f) => ({ ...f, reference: e.target.value }))}
                      className="h-10"
                    />
                  </div>
                )}
                {showFormLastFour && (
                  <div className="space-y-1.5">
                    <Label className="text-sm">
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
                      className="h-10"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Notes <span className="font-normal normal-case text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                placeholder="Payment details…"
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
                rows={1}
                className="min-h-[2.5rem] resize-none sm:min-h-[3.5rem] sm:rows-2"
              />
            </div>
          </div>

          <DialogFooter className="shrink-0 gap-2 border-t bg-muted/20 px-4 py-3 sm:flex-row sm:justify-between sm:px-5 sm:py-3.5">
            <Button variant="ghost" onClick={() => setShowNewPaymentDialog(false)}>
              Cancel
            </Button>
            <Button
              className="min-w-[9rem] bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
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
              {createPaymentMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Recording…
                </>
              ) : (
                'Record Payment'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
