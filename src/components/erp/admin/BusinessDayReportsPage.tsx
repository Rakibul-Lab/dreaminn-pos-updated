'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO, subDays } from 'date-fns'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/lib/auth-store'
import { useBusinessDate } from '@/hooks/use-business-date'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  FileBarChart,
  RefreshCw,
  CalendarRange,
  FileDown,
  Loader2,
  Search,
} from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  downloadBusinessDayCheckInOutExcel,
  downloadBusinessDayCheckInOutPdf,
  downloadBusinessDayCollectionsExcel,
  downloadBusinessDayCollectionsPdf,
  downloadBusinessDayDiscountsExcel,
  downloadBusinessDayDiscountsPdf,
  downloadBusinessDaySalesExcel,
  downloadBusinessDaySalesPdf,
  downloadBusinessDaySummaryExcel,
  downloadBusinessDaySummaryPdf,
  type BusinessDayReportTab,
  type BusinessDaySummaryData,
  type CheckInOutReportData,
  type CollectionsReportData,
  type DiscountReportData,
  type SalesReportData,
} from '@/lib/business-day-reports-export'
import { DailySalesPaperView } from '@/components/erp/admin/DailySalesPaperView'
import type { PaperSalesInput } from '@/lib/daily-sales-paper-format'
import { BusinessDaySummarySection } from '@/components/erp/admin/BusinessDaySummarySection'
import {
  BOOKING_DATE_PRESET_OPTIONS,
  resolveBookingDateRangeWithBusinessDate,
  type BookingDatePreset,
} from '@/lib/booking-date-filter'
import { toast } from 'sonner'

type DayCloseHistoryItem = {
  id: string
  businessDate: string
  closedAt: string
}

type DayCloseListResponse = {
  success: boolean
  data?: {
    history: DayCloseHistoryItem[]
    meta?: { total: number; page: number; totalPages: number }
  }
}

type ReportResponse = {
  success: boolean
  data?: Record<string, unknown>
}

type BusinessDatePreset = 'today' | 'yesterday' | 'custom' | 'closed'
type ReportDateMode = 'single' | 'range'

const DATE_PRESET_OPTIONS: { value: BusinessDatePreset; label: string }[] = [
  { value: 'today', label: 'Business today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'custom', label: 'Pick a date' },
  { value: 'closed', label: 'Closed business day' },
]

function buildReportUrl(type: string, businessDate: string): string {
  const params = new URLSearchParams({ type, businessDate })
  return `/reports?${params.toString()}`
}

function buildReportRangeUrl(type: string, range: { dateFrom?: string; dateTo?: string }): string {
  const params = new URLSearchParams({ type })
  if (range.dateFrom) params.set('dateFrom', range.dateFrom)
  if (range.dateTo) params.set('dateTo', range.dateTo)
  return `/reports?${params.toString()}`
}

function buildDiscountReportUrl(range: { dateFrom?: string; dateTo?: string }): string {
  const params = new URLSearchParams({ type: 'hotel-daily-discounts' })
  if (range.dateFrom) params.set('dateFrom', range.dateFrom)
  if (range.dateTo) params.set('dateTo', range.dateTo)
  return `/reports?${params.toString()}`
}

export default function BusinessDayReportsPage() {
  const { user } = useAuthStore()
  const { data: businessDateRes } = useBusinessDate()
  const currentBusinessDate = businessDateRes?.data?.businessDate

  const [datePreset, setDatePreset] = useState<BusinessDatePreset>('today')
  const [customDate, setCustomDate] = useState('')
  const [closedDate, setClosedDate] = useState('')
  const [dateMode, setDateMode] = useState<ReportDateMode>('single')
  const [rangeDateFrom, setRangeDateFrom] = useState('')
  const [rangeDateTo, setRangeDateTo] = useState('')
  const [activeTab, setActiveTab] = useState<BusinessDayReportTab>('summary')
  const [exportingExcel, setExportingExcel] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [discountSearchInput, setDiscountSearchInput] = useState('')
  const [discountSearchQuery, setDiscountSearchQuery] = useState('')
  const [discountSourceFilter, setDiscountSourceFilter] = useState<'all' | 'hotel' | 'restaurant'>('all')
  const [discountDatePreset, setDiscountDatePreset] = useState<BookingDatePreset>('today')
  const [discountCustomDateFrom, setDiscountCustomDateFrom] = useState('')
  const [discountCustomDateTo, setDiscountCustomDateTo] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setDiscountSearchQuery(discountSearchInput.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [discountSearchInput])

  const { data: closedDaysRes, isLoading: loadingClosedDays } = useQuery({
    queryKey: ['day-close-history-options'],
    queryFn: () => api.get<DayCloseListResponse>('/day-close?page=1&limit=60'),
  })

  const closedDays = closedDaysRes?.data?.history ?? []

  const selectedBusinessDate = useMemo(() => {
    if (!currentBusinessDate) return undefined
    if (datePreset === 'today') return currentBusinessDate
    if (datePreset === 'yesterday') {
      return format(subDays(parseISO(`${currentBusinessDate}T12:00:00`), 1), 'yyyy-MM-dd')
    }
    if (datePreset === 'custom') return customDate || undefined
    if (datePreset === 'closed') return closedDate || closedDays[0]?.businessDate
    return currentBusinessDate
  }, [currentBusinessDate, datePreset, customDate, closedDate, closedDays])

  useEffect(() => {
    if (!currentBusinessDate) return
    if (!rangeDateFrom) setRangeDateFrom(currentBusinessDate)
    if (!rangeDateTo) setRangeDateTo(currentBusinessDate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBusinessDate])

  useEffect(() => {
    setDiscountSearchInput('')
    setDiscountSearchQuery('')
    setDiscountSourceFilter('all')
  }, [selectedBusinessDate])

  const discountDateRange = useMemo(
    () =>
      resolveBookingDateRangeWithBusinessDate(
        discountDatePreset,
        discountCustomDateFrom,
        discountCustomDateTo,
        currentBusinessDate
      ),
    [discountDatePreset, discountCustomDateFrom, discountCustomDateTo, currentBusinessDate]
  )

  const discountQueryEnabled = useMemo(() => {
    if (discountDatePreset === 'today' || discountDatePreset === 'yesterday') {
      return !!currentBusinessDate
    }
    if (discountDatePreset === 'custom') {
      return !!(discountCustomDateFrom || discountCustomDateTo)
    }
    return true
  }, [discountDatePreset, discountCustomDateFrom, discountCustomDateTo, currentBusinessDate])

  const reportEnabled =
    dateMode === 'single'
      ? !!selectedBusinessDate
      : !!(rangeDateFrom || rangeDateTo)

  const { data: salesRes, isLoading: loadingSales, refetch: refetchSales, isFetching: fetchingSales } = useQuery({
    queryKey: ['business-day-sales', dateMode, selectedBusinessDate, rangeDateFrom, rangeDateTo],
    queryFn: () =>
      api.get<ReportResponse>(
        dateMode === 'range'
          ? buildReportRangeUrl('hotel-daily-sales', { dateFrom: rangeDateFrom, dateTo: rangeDateTo })
          : buildReportUrl('hotel-daily-sales', selectedBusinessDate!)
      ),
    enabled: reportEnabled,
  })

  const { data: collectionsRes, isLoading: loadingCollections, refetch: refetchCollections, isFetching: fetchingCollections } = useQuery({
    queryKey: ['business-day-collections', dateMode, selectedBusinessDate, rangeDateFrom, rangeDateTo],
    queryFn: () =>
      api.get<ReportResponse>(
        dateMode === 'range'
          ? buildReportRangeUrl('hotel-daily-collections', { dateFrom: rangeDateFrom, dateTo: rangeDateTo })
          : buildReportUrl('hotel-daily-collections', selectedBusinessDate!)
      ),
    enabled: reportEnabled,
  })

  const { data: arrivalsRes, isLoading: loadingArrivals, refetch: refetchArrivals, isFetching: fetchingArrivals } = useQuery({
    queryKey: ['business-day-arrivals', selectedBusinessDate],
    queryFn: () => api.get<ReportResponse>(buildReportUrl('hotel-daily-arrivals', selectedBusinessDate!)),
    enabled: dateMode === 'single' && reportEnabled,
  })

  const { data: departuresRes, isLoading: loadingDepartures, refetch: refetchDepartures, isFetching: fetchingDepartures } = useQuery({
    queryKey: ['business-day-departures', selectedBusinessDate],
    queryFn: () => api.get<ReportResponse>(buildReportUrl('hotel-daily-departures', selectedBusinessDate!)),
    enabled: dateMode === 'single' && reportEnabled,
  })

  const { data: discountsRes, isLoading: loadingDiscounts, refetch: refetchDiscounts, isFetching: fetchingDiscounts } = useQuery({
    queryKey: [
      'business-day-discounts',
      discountDatePreset,
      discountDateRange.dateFrom,
      discountDateRange.dateTo,
    ],
    queryFn: () => api.get<ReportResponse>(buildDiscountReportUrl(discountDateRange)),
    enabled: discountQueryEnabled,
  })

  const salesData = salesRes?.data as SalesReportData | undefined
  const salesLines = salesData?.lines ?? []
  const salesBalances = salesData?.balances
  const salesSummary = salesData?.summary
  const collectionsData = collectionsRes?.data as CollectionsReportData | undefined
  const discountsData = discountsRes?.data as DiscountReportData | undefined
  const arrivalsData = arrivalsRes?.data
  const departuresData = departuresRes?.data

  const dailySalesHotel = salesData?.hotel
  const dailySalesRestaurant = salesData?.restaurant
  const dailyCollectionsByMethod = collectionsData?.byMethod
  const dailyCollectionPayments = collectionsData?.payments
  const dailyHeadOfficeRemittances = collectionsData?.deposits
  const dailyArrivalsGuests = arrivalsData?.guests as Array<Record<string, unknown>> | undefined
  const dailyDeparturesGuests = departuresData?.guests as Array<Record<string, unknown>> | undefined

  const dailyDiscountLines = discountsData?.lines ?? []
  const dailyDiscountSummary = discountsData?.summary

  const filteredDiscountLines = useMemo(() => {
    let lines = dailyDiscountLines

    if (discountSourceFilter !== 'all') {
      lines = lines.filter((line) => line.source === discountSourceFilter)
    }

    if (discountSearchQuery) {
      const q = discountSearchQuery.toLowerCase()
      lines = lines.filter((line) =>
        [
          line.reference,
          line.guestName,
          line.roomNumber,
          line.company,
          line.detail,
          line.purpose,
          line.createdBy,
          line.source === 'hotel' ? 'hotel' : 'restaurant',
        ].some((value) => value?.toLowerCase().includes(q))
      )
    }

    return lines
  }, [dailyDiscountLines, discountSearchQuery, discountSourceFilter])

  const hasDiscountFilters =
    !!discountSearchQuery ||
    discountSourceFilter !== 'all' ||
    discountDatePreset !== 'today' ||
    (discountDatePreset === 'custom' && !!(discountCustomDateFrom || discountCustomDateTo))

  const businessDateDisplay =
    (salesData?.businessDateDisplay as string | undefined) ||
    (collectionsData?.businessDateDisplay as string | undefined) ||
    (discountsData?.businessDateDisplay as string | undefined) ||
    selectedBusinessDate

  const isFetching =
    fetchingSales || fetchingCollections || fetchingArrivals || fetchingDepartures || fetchingDiscounts

  const buildExportMeta = () => ({
    businessDate: selectedBusinessDate!,
    businessDateDisplay,
    exportedAt: new Date(),
    generatedBy: user
      ? { name: user.name, email: user.email, role: user.role }
      : undefined,
  })

  const isLoadingSummary =
    loadingSales || loadingCollections || loadingArrivals || loadingDepartures

  const buildCheckInOutData = (): CheckInOutReportData => ({
    businessDate: selectedBusinessDate!,
    businessDateDisplay,
    arrivals: {
      actualCheckIns: arrivalsData?.actualCheckIns as number | undefined,
      expectedArrivals: arrivalsData?.expectedArrivals as number | undefined,
      totalListed: arrivalsData?.totalListed as number | undefined,
      guests: dailyArrivalsGuests,
    },
    departures: {
      actualCheckOuts: departuresData?.actualCheckOuts as number | undefined,
      totalListed: departuresData?.totalListed as number | undefined,
      guests: dailyDeparturesGuests,
    },
  })

  const buildSummaryData = (): BusinessDaySummaryData => ({
    businessDate: selectedBusinessDate!,
    businessDateDisplay,
    sales: salesData ?? { businessDate: selectedBusinessDate! },
    collections: collectionsData ?? { businessDate: selectedBusinessDate! },
    checkInOut: buildCheckInOutData(),
  })

  const refreshAll = () => {
    refetchSales()
    refetchCollections()
    refetchArrivals()
    refetchDepartures()
    refetchDiscounts()
  }

  const handleExportExcel = async () => {
    if (dateMode === 'single' && !selectedBusinessDate) return
    setExportingExcel(true)
    const toastId = toast.loading('Preparing Excel export…')
    try {
      const meta = buildExportMeta()
      if (activeTab === 'summary') {
        await downloadBusinessDaySummaryExcel(buildSummaryData(), meta)
      } else if (activeTab === 'sales') {
        if (!salesData) throw new Error('No sales data for this business day')
        await downloadBusinessDaySalesExcel(salesData, meta)
      } else if (activeTab === 'collections') {
        if (!collectionsData) throw new Error('No collections data for this business day')
        await downloadBusinessDayCollectionsExcel(collectionsData, meta)
      } else if (activeTab === 'discounts') {
        if (!discountsData) throw new Error('No discount data for this business day')
        await downloadBusinessDayDiscountsExcel(discountsData, meta)
      } else if (activeTab === 'checkin-checkout') {
        await downloadBusinessDayCheckInOutExcel(buildCheckInOutData(), meta)
      }
      toast.success('Excel export ready', { id: toastId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed'
      toast.error(msg, { id: toastId })
    } finally {
      setExportingExcel(false)
    }
  }

  const handleExportPdf = async () => {
    if (dateMode === 'single' && !selectedBusinessDate) return
    setExportingPdf(true)
    const toastId = toast.loading('Preparing PDF export…')
    try {
      const meta = buildExportMeta()
      if (activeTab === 'summary') {
        await downloadBusinessDaySummaryPdf(buildSummaryData(), meta)
      } else if (activeTab === 'sales') {
        if (!salesData) throw new Error('No sales data for this business day')
        await downloadBusinessDaySalesPdf(salesData, meta)
      } else if (activeTab === 'collections') {
        if (!collectionsData) throw new Error('No collections data for this business day')
        await downloadBusinessDayCollectionsPdf(collectionsData, meta)
      } else if (activeTab === 'discounts') {
        if (!discountsData) throw new Error('No discount data for this business day')
        await downloadBusinessDayDiscountsPdf(discountsData, meta)
      } else if (activeTab === 'checkin-checkout') {
        await downloadBusinessDayCheckInOutPdf(buildCheckInOutData(), meta)
      }
      toast.success('PDF export ready', { id: toastId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed'
      toast.error(msg, { id: toastId })
    } finally {
      setExportingPdf(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <FileBarChart className="h-6 w-6 text-amber-600" />
            Business Day Reports
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Daily sales, collections, and check-in / check-out for any business date.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll} disabled={isFetching || !reportEnabled}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarRange className="h-4 w-4" />
            Select business date / range
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row flex-wrap gap-4">
          <div className="space-y-2 min-w-[200px]">
            <Label>Report mode</Label>
            <Select value={dateMode} onValueChange={(v) => setDateMode(v as ReportDateMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single business date</SelectItem>
                <SelectItem value="range">Date range</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {dateMode === 'range' ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="business-range-from">From</Label>
                <Input
                  id="business-range-from"
                  type="date"
                  value={rangeDateFrom}
                  onChange={(e) => setRangeDateFrom(e.target.value)}
                  className="w-[180px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="business-range-to">To</Label>
                <Input
                  id="business-range-to"
                  type="date"
                  value={rangeDateTo}
                  onChange={(e) => setRangeDateTo(e.target.value)}
                  className="w-[180px]"
                />
              </div>
              <div className="flex items-end">
                <p className="text-xs text-muted-foreground max-w-[260px]">
                  Range mode applies to Sales & Collections. Arrivals/Departures stay single-date.
                </p>
              </div>
            </>
          ) : (
            <>
          <div className="space-y-2 min-w-[200px]">
            <Label>Date option</Label>
            <Select
              value={datePreset}
              onValueChange={(v) => setDatePreset(v as BusinessDatePreset)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_PRESET_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {datePreset === 'custom' && (
            <div className="space-y-2">
              <Label htmlFor="custom-business-date">Date</Label>
              <Input
                id="custom-business-date"
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="w-[180px]"
              />
            </div>
          )}

          {datePreset === 'closed' && (
            <div className="space-y-2 min-w-[220px]">
              <Label>Closed day</Label>
              {loadingClosedDays ? (
                <Skeleton className="h-10 w-full" />
              ) : closedDays.length === 0 ? (
                <p className="text-sm text-muted-foreground">No closed business days yet.</p>
              ) : (
                <Select value={closedDate || closedDays[0]?.businessDate} onValueChange={setClosedDate}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select closed day" />
                  </SelectTrigger>
                  <SelectContent>
                    {closedDays.map((row) => (
                      <SelectItem key={row.id} value={row.businessDate}>
                        {row.businessDate}
                        {' · '}
                        {format(parseISO(row.closedAt), 'dd MMM · h:mm a')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
            </>
          )}

          {selectedBusinessDate && (
            <div className="flex items-end">
              <p className="text-sm text-muted-foreground pb-2">
                Reporting for{' '}
                <span className="font-medium text-foreground">{businessDateDisplay}</span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {!selectedBusinessDate ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            Loading business date…
          </CardContent>
        </Card>
      ) : (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as BusinessDayReportTab)}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="summary">All summary</TabsTrigger>
              <TabsTrigger value="sales">Sales report</TabsTrigger>
              <TabsTrigger value="collections">Collections report</TabsTrigger>
              <TabsTrigger value="discounts">Discount report</TabsTrigger>
              <TabsTrigger value="checkin-checkout">Check-in / Check-out</TabsTrigger>
            </TabsList>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportExcel}
                disabled={exportingExcel || exportingPdf}
              >
                {exportingExcel ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileDown className="h-4 w-4 mr-2" />
                )}
                Export Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportPdf}
                disabled={exportingExcel || exportingPdf}
              >
                {exportingPdf ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileDown className="h-4 w-4 mr-2" />
                )}
                Export PDF
              </Button>
            </div>
          </div>

          <TabsContent value="summary" className="space-y-4 mt-4">
            <BusinessDaySummarySection
              isLoading={isLoadingSummary}
              salesBalances={salesBalances ?? null}
              grandTotal={(salesData?.grandTotal as number | undefined) ?? 0}
              hotel={dailySalesHotel ?? null}
              restaurant={dailySalesRestaurant ?? null}
              totalDiscount={(salesData?.totalDiscount as number | undefined) ?? undefined}
              collectionsSummary={collectionsData?.summary as Record<string, number> | undefined}
              collectionsByMethod={dailyCollectionsByMethod ?? []}
              guestMovement={{
                actualCheckIns: arrivalsData?.actualCheckIns as number | undefined,
                expectedArrivals: arrivalsData?.expectedArrivals as number | undefined,
                totalListed: arrivalsData?.totalListed as number | undefined,
                actualCheckOuts: departuresData?.actualCheckOuts as number | undefined,
              }}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Recent arrivals & departures</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-48 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Guest</TableHead>
                          <TableHead>Room</TableHead>
                          <TableHead>Type</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {isLoadingSummary ? (
                          <TableRow><TableCell colSpan={3}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                        ) : (
                          <>
                            {(dailyArrivalsGuests ?? []).slice(0, 3).map((g, i) => (
                              <TableRow key={`in-${i}`}>
                                <TableCell className="font-medium">{String(g.guestName)}</TableCell>
                                <TableCell className="font-mono">{String(g.roomNumber)}</TableCell>
                                <TableCell className="text-emerald-600 text-xs">Check-in</TableCell>
                              </TableRow>
                            ))}
                            {(dailyDeparturesGuests ?? []).slice(0, 3).map((g, i) => (
                              <TableRow key={`out-${i}`}>
                                <TableCell className="font-medium">{String(g.guestName)}</TableCell>
                                <TableCell className="font-mono">{String(g.roomNumber)}</TableCell>
                                <TableCell className="text-sky-600 text-xs">Check-out</TableCell>
                              </TableRow>
                            ))}
                            {!dailyArrivalsGuests?.length && !dailyDeparturesGuests?.length && (
                              <TableRow><TableCell colSpan={3} className="text-center py-4 text-muted-foreground">No movement today</TableCell></TableRow>
                            )}
                          </>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="sales" className="space-y-4 mt-4">
            {loadingSales ? (
              <Skeleton className="h-[520px] w-full" />
            ) : salesData ? (
              <DailySalesPaperView
                data={{
                  businessDate: salesData.businessDate,
                  businessDateDisplay: salesData.businessDateDisplay,
                  openingBalance: salesData.openingBalance,
                  lines: salesLines,
                  balances: salesBalances,
                  summary: salesSummary,
                  hotel: dailySalesHotel,
                  restaurant: dailySalesRestaurant,
                  totalDiscount: salesData.totalDiscount as number | undefined,
                  cashReconciliation: (salesData as { cashReconciliation?: PaperSalesInput['cashReconciliation'] })
                    .cashReconciliation,
                  headOfficeRemittances: (salesData as {
                    headOfficeRemittances?: Array<{
                      id: string
                      amount: number
                      method: string
                      reference?: string | null
                      notes?: string | null
                      sentBy?: string
                      at: string
                    }>
                  }).headOfficeRemittances,
                }}
              />
            ) : (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground text-sm">
                  No sales data for this business day
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="collections" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Net collected</p>
                  <p className="text-2xl font-bold text-purple-700">
                    ৳{(((collectionsData?.summary)?.netCollected) || 0).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Sent to head office (total)</p>
                  <p className="text-2xl font-bold text-amber-700">
                    ৳{(((collectionsData?.summary)?.depositTotal) || 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {(collectionsData?.summary)?.depositCount ?? 0} transfer(s)
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Cash on hand</p>
                  <p className="text-2xl font-bold text-sky-700">
                    ৳{(((collectionsData?.summary)?.cashOnHand) || 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Opening ৳{(((collectionsData?.summary)?.openingCash) || 0).toLocaleString()} + Cash column ৳
                    {(((collectionsData?.summary)?.cashCollected) || 0).toLocaleString()} − sent ৳
                    {(((collectionsData?.summary)?.cashRemitted) || 0).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Cash reconciliation (matches sales report &amp; Head Office)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                  <div className="space-y-2">
                    <p className="font-semibold text-muted-foreground">Collected (sales report columns)</p>
                    <div className="flex justify-between">
                      <span>Cash collected</span>
                      <span className="font-medium">৳{(((collectionsData?.summary)?.cashCollected) || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Card collected</span>
                      <span className="font-medium">৳{(((collectionsData?.summary)?.cardCollected) || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>M. banking collected</span>
                      <span className="font-medium">৳{(((collectionsData?.summary)?.mBankingCollected) || 0).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="font-semibold text-muted-foreground">Sent to head office</p>
                    <div className="flex justify-between">
                      <span>Cash</span>
                      <span className="font-medium text-amber-700">৳{(((collectionsData?.summary)?.cashRemitted) || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Card</span>
                      <span className="font-medium text-amber-700">৳{(((collectionsData?.summary)?.cardRemitted) || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>M. banking</span>
                      <span className="font-medium text-amber-700">৳{(((collectionsData?.summary)?.mBankingRemitted) || 0).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Collections by method</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-64 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Method</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loadingCollections ? (
                          <TableRow><TableCell colSpan={2}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                        ) : dailyCollectionsByMethod?.length ? dailyCollectionsByMethod.map((row, i) => (
                          <TableRow key={i}>
                            <TableCell>{row.method}</TableCell>
                            <TableCell className="text-right text-emerald-600">৳{row.amount.toLocaleString()}</TableCell>
                          </TableRow>
                        )) : (
                          <TableRow><TableCell colSpan={2} className="text-center py-4 text-muted-foreground">No collections</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Payment transactions</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-64 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead>
                          <TableHead>Purpose</TableHead>
                          <TableHead>Room</TableHead>
                          <TableHead>Method</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loadingCollections ? (
                          <TableRow><TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                        ) : dailyCollectionPayments?.length ? dailyCollectionPayments.map((p) => (
                          <TableRow key={String(p.id ?? p.at)}>
                            <TableCell className="text-xs">
                              {p.at ? format(parseISO(String(p.at)), 'dd MMM · HH:mm') : '—'}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {String(p.purpose || '—')}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {String(p.roomNumber || '—')}
                            </TableCell>
                            <TableCell>{String(p.method)}</TableCell>
                            <TableCell className="text-right">৳{Number(p.amount || 0).toLocaleString()}</TableCell>
                          </TableRow>
                        )) : (
                          <TableRow><TableCell colSpan={5} className="text-center py-4 text-muted-foreground">No payments</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Sent to head office</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-64 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date & time</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead>Sent by</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loadingCollections ? (
                        <TableRow><TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                      ) : dailyHeadOfficeRemittances?.length ? dailyHeadOfficeRemittances.map((d) => (
                        <TableRow key={String(d.id ?? d.at)}>
                          <TableCell className="text-xs whitespace-nowrap">
                            {d.at ? format(parseISO(String(d.at)), 'dd MMM yyyy · HH:mm') : '—'}
                          </TableCell>
                          <TableCell>{String(d.method)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">
                            {String(d.reference || d.notes || '—')}
                          </TableCell>
                          <TableCell className="text-xs">{String(d.sentBy || '—')}</TableCell>
                          <TableCell className="text-right font-medium text-amber-700">
                            ৳{Number(d.amount || 0).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      )) : (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-4 text-muted-foreground">
                            No head office transfers for this period. Record under Billing → Head Office.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="discounts" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Hotel discounts</p>
                  <p className="text-2xl font-bold text-red-600">
                    ৳{(dailyDiscountSummary?.hotelDiscountTotal ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {dailyDiscountSummary?.hotelCount ?? 0} invoice(s)
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Restaurant discounts</p>
                  <p className="text-2xl font-bold text-red-600">
                    ৳{(dailyDiscountSummary?.restaurantDiscountTotal ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {dailyDiscountSummary?.restaurantCount ?? 0} order(s)
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Total discount</p>
                  <p className="text-2xl font-bold text-red-700">
                    ৳{(dailyDiscountSummary?.totalDiscount ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {dailyDiscountSummary?.lineCount ?? 0} line(s)
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2 space-y-3">
                <CardTitle className="text-base">Discount transactions</CardTitle>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                  <div className="relative md:col-span-5 min-w-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search guest, reference, room, company…"
                      value={discountSearchInput}
                      onChange={(e) => setDiscountSearchInput(e.target.value)}
                      className="pl-9 h-9 bg-background"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <Select
                      value={discountSourceFilter}
                      onValueChange={(v) => setDiscountSourceFilter(v as 'all' | 'hotel' | 'restaurant')}
                    >
                      <SelectTrigger className="w-full h-9 bg-background">
                        <SelectValue placeholder="Source" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All sources</SelectItem>
                        <SelectItem value="hotel">Hotel invoice</SelectItem>
                        <SelectItem value="restaurant">Restaurant POS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-4">
                    <Select
                      value={discountDatePreset}
                      onValueChange={(v) => setDiscountDatePreset(v as BookingDatePreset)}
                    >
                      <SelectTrigger className="w-full h-9 bg-background">
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
                  </div>
                </div>
                {discountDatePreset === 'custom' && (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      type="date"
                      value={discountCustomDateFrom}
                      onChange={(e) => setDiscountCustomDateFrom(e.target.value)}
                      className="h-9"
                    />
                    <Input
                      type="date"
                      value={discountCustomDateTo}
                      onChange={(e) => setDiscountCustomDateTo(e.target.value)}
                      min={discountCustomDateFrom || undefined}
                      className="h-9"
                    />
                  </div>
                )}
                {hasDiscountFilters && (
                  <p className="text-xs text-muted-foreground">
                    Showing {filteredDiscountLines.length} of {dailyDiscountLines.length} transaction
                    {dailyDiscountLines.length === 1 ? '' : 's'}
                    {fetchingDiscounts && !loadingDiscounts ? ' · Updating…' : ''}
                  </p>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[520px] overflow-auto">
                  <Table className="table-fixed min-w-[1080px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[96px]">Time</TableHead>
                        <TableHead className="w-[112px] whitespace-normal">Purpose</TableHead>
                        <TableHead className="w-[112px]">Reference</TableHead>
                        <TableHead className="w-[128px] whitespace-normal">Guest</TableHead>
                        <TableHead className="w-[88px] whitespace-normal">Room</TableHead>
                        <TableHead className="w-[220px] whitespace-normal">Details</TableHead>
                        <TableHead className="w-[128px] whitespace-normal">Company</TableHead>
                        <TableHead className="w-[88px] text-right">Gross</TableHead>
                        <TableHead className="w-[88px] text-right">Discount</TableHead>
                        <TableHead className="w-[88px] text-right">Net</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loadingDiscounts ? (
                        <TableRow>
                          <TableCell colSpan={10}>
                            <Skeleton className="h-8 w-full" />
                          </TableCell>
                        </TableRow>
                      ) : filteredDiscountLines.length ? (
                        filteredDiscountLines.map((line) => (
                          <TableRow key={line.id}>
                            <TableCell className="text-xs whitespace-nowrap align-top">
                              {line.at ? format(parseISO(line.at), 'dd MMM · HH:mm') : '—'}
                            </TableCell>
                            <TableCell className="text-xs whitespace-normal break-words align-top">
                              {line.purpose}
                            </TableCell>
                            <TableCell className="font-mono text-xs break-all align-top">
                              {line.reference}
                            </TableCell>
                            <TableCell className="text-xs whitespace-normal break-words align-top">
                              {line.guestName || '—'}
                            </TableCell>
                            <TableCell className="font-mono text-xs whitespace-normal break-words align-top">
                              {line.roomNumber || '—'}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-normal break-words align-top leading-snug [overflow-wrap:anywhere]">
                              <span title={line.detail || undefined}>{line.detail || '—'}</span>
                            </TableCell>
                            <TableCell className="text-xs whitespace-normal break-words align-top">
                              {line.company || '—'}
                            </TableCell>
                            <TableCell className="text-right text-xs whitespace-nowrap align-top tabular-nums">
                              ৳{line.grossAmount.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right text-xs text-red-600 font-medium whitespace-nowrap align-top tabular-nums">
                              ৳{line.discountAmount.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right text-xs whitespace-nowrap align-top tabular-nums">
                              ৳{line.netAmount.toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                            {dailyDiscountLines.length
                              ? 'No discount transactions match your search or filters'
                              : 'No discounts recorded for this period'}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="checkin-checkout" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Arrivals / Check-ins</p>
                  <p className="text-2xl font-bold text-emerald-700">
                    {(arrivalsData?.actualCheckIns as number) ?? 0}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Expected: {(arrivalsData?.expectedArrivals as number) ?? 0}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Departures / Check-outs</p>
                  <p className="text-2xl font-bold text-sky-700">
                    {(departuresData?.actualCheckOuts as number) ?? 0}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Listed: {(departuresData?.totalListed as number) ?? 0}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Daily arrivals / Check-ins</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-72 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Guest</TableHead>
                          <TableHead>Room</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loadingArrivals ? (
                          <TableRow><TableCell colSpan={3}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                        ) : dailyArrivalsGuests?.length ? dailyArrivalsGuests.map((g, i) => (
                          <TableRow key={i}>
                            <TableCell>
                              <p className="font-medium">{String(g.guestName)}</p>
                              <p className="text-xs text-muted-foreground">{String(g.phone || '')}</p>
                            </TableCell>
                            <TableCell className="font-mono">{String(g.roomNumber)}</TableCell>
                            <TableCell>{String(g.status)}</TableCell>
                          </TableRow>
                        )) : (
                          <TableRow><TableCell colSpan={3} className="text-center py-4 text-muted-foreground">No arrivals</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Daily departures / Check-outs</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-72 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Guest</TableHead>
                          <TableHead>Room</TableHead>
                          <TableHead className="text-right">Due</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loadingDepartures ? (
                          <TableRow><TableCell colSpan={3}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                        ) : dailyDeparturesGuests?.length ? dailyDeparturesGuests.map((g, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium">{String(g.guestName)}</TableCell>
                            <TableCell className="font-mono">{String(g.roomNumber)}</TableCell>
                            <TableCell className="text-right">৳{Number(g.dueAmount || 0).toLocaleString()}</TableCell>
                          </TableRow>
                        )) : (
                          <TableRow><TableCell colSpan={3} className="text-center py-4 text-muted-foreground">No departures</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
