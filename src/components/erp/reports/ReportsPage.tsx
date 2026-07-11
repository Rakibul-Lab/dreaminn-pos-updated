'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useAuthStore, canAccessHotel, canAccessRestaurant, canAccessAdmin } from '@/lib/auth-store'
import { format, parseISO } from 'date-fns'
import {
  BarChart, PieChart, Bar, Pie, Cell,
  XAxis, YAxis, CartesianGrid
} from 'recharts'
import {
  BarChart3, Download, CalendarRange, FileDown, Loader2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import {
  resolveBookingDateRange,
  type BookingDatePreset,
} from '@/lib/booking-date-filter'
import {
  downloadReportsPdf,
  REPORT_DATE_PRESET_OPTIONS,
  type ReportsExportTab,
} from '@/lib/reports-export'
import { useBusinessDate } from '@/hooks/use-business-date'
import { toast } from 'sonner'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart'

const CHART_COLORS = ['#d97706', '#059669', '#0891b2', '#7c3aed', '#dc2626', '#ea580c', '#65a30d', '#0d9488']

const barChartConfig: ChartConfig = {
  sales: { label: 'Sales', color: '#d97706' },
  revenue: { label: 'Revenue', color: '#059669' },
  hotelRevenue: { label: 'Hotel Revenue', color: '#d97706' },
  restaurantRevenue: { label: 'Restaurant Revenue', color: '#059669' },
}

const lineChartConfig: ChartConfig = {
  occupancy: { label: 'Occupancy Rate', color: '#0891b2' },
  trend: { label: 'Trend', color: '#d97706' },
}

const pieChartConfig: ChartConfig = {
  PENDING: { label: 'Pending', color: '#d97706' },
  COOKING: { label: 'Cooking', color: '#0891b2' },
  READY: { label: 'Ready', color: '#059669' },
  DELIVERED: { label: 'Delivered', color: '#7c3aed' },
  CANCELLED: { label: 'Cancelled', color: '#dc2626' },
}

function buildReportQueryParams(
  type: string,
  dateFrom?: string,
  dateTo?: string,
  businessDate?: string
): string {
  const params = new URLSearchParams({ type })
  if (dateFrom) params.set('startDate', dateFrom)
  if (dateTo) params.set('endDate', dateTo)
  if (businessDate) params.set('businessDate', businessDate)
  return `/reports?${params.toString()}`
}

export default function ReportsPage() {
  const { user } = useAuthStore()
  const [datePreset, setDatePreset] = useState<BookingDatePreset>('today')
  const [customDateFrom, setCustomDateFrom] = useState('')
  const [customDateTo, setCustomDateTo] = useState('')
  const [exportingPdf, setExportingPdf] = useState(false)

  const isHotel = canAccessHotel(user?.role)
  const isRestaurant = canAccessRestaurant(user?.role)
  const isAdmin = canAccessAdmin(user?.role)

  const defaultTab: ReportsExportTab = isRestaurant || isAdmin
    ? 'restaurant'
    : isHotel
      ? 'hotel'
      : 'restaurant'
  const [activeTab, setActiveTab] = useState<ReportsExportTab>(defaultTab)

  const { data: businessDateRes } = useBusinessDate()
  const businessNow = useMemo(() => {
    const bd = businessDateRes?.data?.businessDate
    if (!bd) return new Date()
    return parseISO(`${bd}T12:00:00`)
  }, [businessDateRes?.data?.businessDate])

  const dateRange = useMemo(
    () => resolveBookingDateRange(datePreset, customDateFrom, customDateTo, businessNow),
    [datePreset, customDateFrom, customDateTo, businessNow]
  )

  const reportBusinessDate = useMemo(() => {
    if (dateRange.dateFrom && dateRange.dateTo && dateRange.dateFrom === dateRange.dateTo) {
      return dateRange.dateFrom
    }
    return businessDateRes?.data?.businessDate
  }, [dateRange.dateFrom, dateRange.dateTo, businessDateRes?.data?.businessDate])

  const reportQueryKey = [datePreset, dateRange.dateFrom, dateRange.dateTo, reportBusinessDate] as const

  // Restaurant daily sales
  const { data: restaurantDaily, isLoading: loadingDaily } = useQuery({
    queryKey: ['report-restaurant-daily', ...reportQueryKey],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(
        buildReportQueryParams('restaurant-daily', dateRange.dateFrom, dateRange.dateTo)
      )
      return res.data
    },
    enabled: isRestaurant || isAdmin,
  })

  const { data: restaurantMonthly, isLoading: loadingMonthly } = useQuery({
    queryKey: ['report-restaurant-monthly', ...reportQueryKey],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(
        buildReportQueryParams('restaurant-monthly', dateRange.dateFrom, dateRange.dateTo)
      )
      return res.data
    },
    enabled: isRestaurant || isAdmin,
  })

  const { data: orderStatus, isLoading: loadingOrderStatus } = useQuery({
    queryKey: ['report-order-status', ...reportQueryKey],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(
        buildReportQueryParams('order-status', dateRange.dateFrom, dateRange.dateTo)
      )
      return res.data
    },
    enabled: isRestaurant || isAdmin,
  })

  const { data: hotelRevenue, isLoading: loadingHotelRevenue } = useQuery({
    queryKey: ['report-hotel-revenue', ...reportQueryKey],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(
        buildReportQueryParams('hotel-revenue', dateRange.dateFrom, dateRange.dateTo)
      )
      return res.data
    },
    enabled: isHotel || isAdmin,
  })

  const { data: hotelOccupancy, isLoading: loadingOccupancy } = useQuery({
    queryKey: ['report-hotel-occupancy', ...reportQueryKey],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(
        buildReportQueryParams('hotel-occupancy', dateRange.dateFrom, dateRange.dateTo)
      )
      return res.data
    },
    enabled: isHotel || isAdmin,
  })

  const { data: foodCharges, isLoading: loadingFoodCharges } = useQuery({
    queryKey: ['report-food-charges', ...reportQueryKey],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(
        buildReportQueryParams('food-charges-by-room', dateRange.dateFrom, dateRange.dateTo)
      )
      return res.data
    },
    enabled: isHotel || isAdmin,
  })

  const { data: hotelDailySales, isLoading: loadingDailySales } = useQuery({
    queryKey: ['report-hotel-daily-sales', ...reportQueryKey],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(
        buildReportQueryParams('hotel-daily-sales', undefined, undefined, reportBusinessDate)
      )
      return res.data
    },
    enabled: (isHotel || isAdmin) && !!reportBusinessDate,
  })

  const { data: hotelDailyArrivals, isLoading: loadingDailyArrivals } = useQuery({
    queryKey: ['report-hotel-daily-arrivals', ...reportQueryKey],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(
        buildReportQueryParams('hotel-daily-arrivals', undefined, undefined, reportBusinessDate)
      )
      return res.data
    },
    enabled: (isHotel || isAdmin) && !!reportBusinessDate,
  })

  const { data: hotelDailyDepartures, isLoading: loadingDailyDepartures } = useQuery({
    queryKey: ['report-hotel-daily-departures', ...reportQueryKey],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(
        buildReportQueryParams('hotel-daily-departures', undefined, undefined, reportBusinessDate)
      )
      return res.data
    },
    enabled: (isHotel || isAdmin) && !!reportBusinessDate,
  })

  const { data: hotelDailyCollections, isLoading: loadingDailyCollections } = useQuery({
    queryKey: ['report-hotel-daily-collections', ...reportQueryKey],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(
        buildReportQueryParams('hotel-daily-collections', undefined, undefined, reportBusinessDate)
      )
      return res.data
    },
    enabled: (isHotel || isAdmin) && !!reportBusinessDate,
  })

  const { data: combinedRevenue, isLoading: loadingCombined } = useQuery({
    queryKey: ['report-combined-revenue', ...reportQueryKey],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(
        buildReportQueryParams('combined-revenue', dateRange.dateFrom, dateRange.dateTo)
      )
      return res.data
    },
    enabled: isAdmin,
  })

  const { data: adminSummary, isLoading: loadingAdminSummary } = useQuery({
    queryKey: ['report-admin-summary', ...reportQueryKey],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(
        buildReportQueryParams('admin-summary', dateRange.dateFrom, dateRange.dateTo)
      )
      return res.data
    },
    enabled: isAdmin,
  })

  const exportCSV = (data: Record<string, unknown>[], filename: string) => {
    if (!data.length) return
    const headers = Object.keys(data[0])
    const csv = [
      headers.join(','),
      ...data.map((row) => headers.map((h) => JSON.stringify(row[h] ?? '')).join(',')),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${filename}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Build chart data from daily breakdown
  const dailyBreakdown = restaurantMonthly?.dailyBreakdown as Record<string, { orders: number; sales: number }> | undefined
  const dailyChartData = dailyBreakdown
    ? Object.entries(dailyBreakdown).map(([date, val]) => ({ date: format(new Date(date), 'MMM dd'), sales: val.sales, orders: val.orders }))
    : []

  // Build pie chart data from order status
  const statusDist = orderStatus?.statusDistribution as Record<string, { count: number; totalAmount: number }> | undefined
  const pieData = statusDist
    ? Object.entries(statusDist).map(([status, val]) => ({ name: status, value: val.count, amount: val.totalAmount }))
    : []

  // Build revenue by type chart data
  const revenueByType = hotelRevenue?.revenueByType as Record<string, { bookings: number; revenue: number }> | undefined
  const revenueByTypeData = revenueByType
    ? Object.entries(revenueByType).map(([type, val]) => ({ type, revenue: val.revenue, bookings: val.bookings }))
    : []

  // Top selling items
  const topItems = (restaurantDaily?.topSellingItems || restaurantMonthly?.topSellingItems) as Array<{ name: string; quantity: number; revenue: number }> | undefined

  // Food charges by room
  const roomsData = foodCharges?.rooms as Array<{ roomNumber: string; totalOrders: number; totalCharges: number }> | undefined

  const dailySalesHotel = hotelDailySales?.hotel as Record<string, number> | undefined
  const dailySalesRestaurant = hotelDailySales?.restaurant as Record<string, number> | undefined
  const dailyArrivalsGuests = hotelDailyArrivals?.guests as Array<Record<string, unknown>> | undefined
  const dailyDeparturesGuests = hotelDailyDepartures?.guests as Array<Record<string, unknown>> | undefined
  const dailyCollectionsByMethod = hotelDailyCollections?.byMethod as Array<{ method: string; amount: number }> | undefined
  const dailyCollectionPayments = hotelDailyCollections?.payments as Array<Record<string, unknown>> | undefined

  // Combined revenue data
  const combinedData = combinedRevenue ? [
    { name: 'Hotel', revenue: (combinedRevenue.hotelRevenue as number) || 0 },
    { name: 'Restaurant', revenue: (combinedRevenue.restaurantRevenue as number) || 0 },
    { name: 'Extra', revenue: (combinedRevenue.extraRevenue as number) || 0 },
  ] : []

  // Top customers
  const topCustomers = adminSummary?.topCustomers as Array<{ name: string; totalSpent: number; bookingCount: number }> | undefined

  const paymentsByMethod = combinedRevenue?.paymentsByMethod as Record<string, number> | undefined
  const paymentsByMethodData = paymentsByMethod
    ? Object.entries(paymentsByMethod).map(([method, amount]) => ({ method, amount }))
    : []

  const handleExportPdf = async () => {
    setExportingPdf(true)
    const toastId = toast.loading('Preparing PDF export…')
    try {
      if (activeTab === 'restaurant' && !(isRestaurant || isAdmin)) {
        throw new Error('No restaurant report data available')
      }
      if (activeTab === 'hotel' && !(isHotel || isAdmin)) {
        throw new Error('No hotel report data available')
      }
      if (activeTab === 'combined' && !isAdmin) {
        throw new Error('Combined reports are admin only')
      }

      await downloadReportsPdf(
        {
          restaurant:
            activeTab === 'restaurant'
              ? {
                  totalSales: (restaurantDaily?.totalSales as number) ?? 0,
                  totalOrders: (restaurantDaily?.totalOrders as number) ?? 0,
                  averageOrderValue: (restaurantDaily?.averageOrderValue as number) ?? 0,
                  dailyBreakdown: restaurantMonthly?.dailyBreakdown as Record<string, { orders: number; sales: number }>,
                  statusDistribution: orderStatus?.statusDistribution as Record<string, { count: number; totalAmount: number }>,
                  topSellingItems: topItems,
                }
              : undefined,
          hotel:
            activeTab === 'hotel'
              ? {
                  totalRevenue: (hotelRevenue?.totalRevenue as number) ?? 0,
                  totalBookings: (hotelRevenue?.totalBookings as number) ?? 0,
                  averageRate: (hotelRevenue?.averageRate as number) ?? 0,
                  occupancyRate: (hotelOccupancy?.occupancyRate as number) ?? 0,
                  revenueByType: hotelRevenue?.revenueByType as Record<string, { bookings: number; revenue: number }>,
                  occupancy: {
                    totalRooms: (hotelOccupancy?.totalRooms as number) ?? 0,
                    availableRooms: (hotelOccupancy?.availableRooms as number) ?? 0,
                    occupiedRooms: (hotelOccupancy?.occupiedRooms as number) ?? 0,
                    cleaningRooms: (hotelOccupancy?.cleaningRooms as number) ?? 0,
                    maintenanceRooms: (hotelOccupancy?.maintenanceRooms as number) ?? 0,
                    todayCheckins: (hotelOccupancy?.todayCheckins as number) ?? 0,
                    todayCheckouts: (hotelOccupancy?.todayCheckouts as number) ?? 0,
                  },
                  foodCharges: roomsData,
                  foodGrandTotal: (foodCharges?.grandTotal as number) ?? undefined,
                }
              : undefined,
          combined:
            activeTab === 'combined'
              ? {
                  totalRevenue: (combinedRevenue?.totalRevenue as number) ?? 0,
                  hotelRevenue: (combinedRevenue?.hotelRevenue as number) ?? 0,
                  restaurantRevenue: (combinedRevenue?.restaurantRevenue as number) ?? 0,
                  extraRevenue: (combinedRevenue?.extraRevenue as number) ?? 0,
                  profitSummary: adminSummary?.profitSummary as {
                    totalPaymentsReceived?: number
                    outstandingDues?: number
                    netPosition?: number
                  },
                  topCustomers,
                }
              : undefined,
        },
        {
          tab: activeTab,
          datePreset,
          customDateFrom,
          customDateTo,
          generatedBy: user ? { name: user.name, email: user.email, role: user.role } : undefined,
        }
      )
      toast.success('Report exported to PDF', { id: toastId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed'
      toast.error(msg, { id: toastId })
    } finally {
      setExportingPdf(false)
    }
  }

  const isReportLoading =
    (activeTab === 'restaurant' && (loadingDaily || loadingMonthly || loadingOrderStatus)) ||
    (activeTab === 'hotel' &&
      (loadingHotelRevenue ||
        loadingOccupancy ||
        loadingFoodCharges ||
        loadingDailySales ||
        loadingDailyArrivals ||
        loadingDailyDepartures ||
        loadingDailyCollections)) ||
    (activeTab === 'combined' && (loadingCombined || loadingAdminSummary))

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-amber-600" />
            Reports & Analytics
          </h2>
          <p className="text-muted-foreground text-sm mt-1">Comprehensive business insights</p>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Period</Label>
            <Select
              value={datePreset}
              onValueChange={(v) => setDatePreset(v as BookingDatePreset)}
            >
              <SelectTrigger className="w-44">
                <CalendarRange className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Period" />
              </SelectTrigger>
              <SelectContent>
                {REPORT_DATE_PRESET_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {datePreset === 'custom' && (
            <>
              <div className="space-y-1">
                <Label htmlFor="report-date-from" className="text-xs text-muted-foreground">From</Label>
                <Input
                  id="report-date-from"
                  type="date"
                  value={customDateFrom}
                  onChange={(e) => setCustomDateFrom(e.target.value)}
                  className="w-40"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="report-date-to" className="text-xs text-muted-foreground">To</Label>
                <Input
                  id="report-date-to"
                  type="date"
                  value={customDateTo}
                  onChange={(e) => setCustomDateTo(e.target.value)}
                  className="w-40"
                />
              </div>
            </>
          )}
          <Button
            variant="outline"
            onClick={() => void handleExportPdf()}
            disabled={exportingPdf || isReportLoading}
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

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ReportsExportTab)}>
        <TabsList>
          {(isRestaurant || isAdmin) && <TabsTrigger value="restaurant">Restaurant</TabsTrigger>}
          {(isHotel || isAdmin) && <TabsTrigger value="hotel">Hotel</TabsTrigger>}
          {isAdmin && <TabsTrigger value="combined">Combined</TabsTrigger>}
        </TabsList>

        {/* Restaurant Reports */}
        {(isRestaurant || isAdmin) && (
          <TabsContent value="restaurant" className="space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Total Sales</p>
                  <p className="text-2xl font-bold text-amber-700">
                    ৳{((restaurantDaily?.totalSales || 0) as number).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Total Orders</p>
                  <p className="text-2xl font-bold text-emerald-700">
                    {((restaurantDaily?.totalOrders || 0) as number)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Avg Order Value</p>
                  <p className="text-2xl font-bold text-sky-700">
                    ৳{((restaurantDaily?.averageOrderValue || 0) as number).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Daily Sales Bar Chart */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-base">Daily Sales Trend</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => exportCSV(dailyChartData, 'daily-sales')}>
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {loadingMonthly ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <ChartContainer config={barChartConfig} className="h-64 w-full">
                    <BarChart data={dailyChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="sales" fill="var(--color-sales)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            {/* Order Status Pie Chart */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Order Status Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingOrderStatus ? (
                    <Skeleton className="h-64 w-full" />
                  ) : pieData.length > 0 ? (
                    <ChartContainer config={pieChartConfig} className="h-64 w-full">
                      <PieChart>
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          dataKey="value"
                          nameKey="name"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {pieData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <ChartLegend content={<ChartLegendContent nameKey="name" />} />
                      </PieChart>
                    </ChartContainer>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">No order data available</p>
                  )}
                </CardContent>
              </Card>

              {/* Top Selling Items */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-base">Top Selling Items</CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => exportCSV(topItems || [], 'top-items')}>
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-64 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Revenue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topItems?.length ? topItems.map((item, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium">{item.name}</TableCell>
                            <TableCell className="text-right">{item.quantity}</TableCell>
                            <TableCell className="text-right text-emerald-600">৳{item.revenue.toLocaleString()}</TableCell>
                          </TableRow>
                        )) : (
                          <TableRow><TableCell colSpan={3} className="text-center py-4 text-muted-foreground">No data</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}

        {/* Hotel Reports */}
        {(isHotel || isAdmin) && (
          <TabsContent value="hotel" className="space-y-4">
            {reportBusinessDate && (
              <p className="text-sm text-muted-foreground">
                Daily operations for business date:{' '}
                <span className="font-medium text-foreground">
                  {(hotelDailySales?.businessDateDisplay as string) || reportBusinessDate}
                </span>
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Daily Sales (Hotel)</p>
                  <p className="text-2xl font-bold text-amber-700">
                    ৳{((dailySalesHotel?.hotelSalesTotal ?? dailySalesHotel?.invoiceTotal ?? 0) as number).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Restaurant: ৳{((dailySalesRestaurant?.grossSales || 0) as number).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Arrivals</p>
                  <p className="text-2xl font-bold text-emerald-700">
                    {(hotelDailyArrivals?.actualCheckIns as number) ?? 0}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Expected: {(hotelDailyArrivals?.expectedArrivals as number) ?? 0}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Departures</p>
                  <p className="text-2xl font-bold text-sky-700">
                    {(hotelDailyDepartures?.actualCheckOuts as number) ?? 0}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Listed: {(hotelDailyDepartures?.totalListed as number) ?? 0}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Collections</p>
                  <p className="text-2xl font-bold text-purple-700">
                    ৳{(((hotelDailyCollections?.summary as Record<string, number>)?.netCollected) || 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Gross: ৳{(((hotelDailyCollections?.summary as Record<string, number>)?.grossCollected) || 0).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-base">Daily Sales Breakdown</CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        exportCSV(
                          [
                            { category: 'Room sales', amount: dailySalesHotel?.roomSales ?? 0 },
                            { category: 'Food (invoice)', amount: dailySalesHotel?.foodSales ?? 0 },
                            { category: 'Extras', amount: dailySalesHotel?.extraSales ?? 0 },
                            {
                              category: 'Hotel beverage (walk-in)',
                              amount: dailySalesHotel?.beverageWalkInSales ?? 0,
                            },
                            {
                              category: 'Hotel sales total',
                              amount:
                                dailySalesHotel?.hotelSalesTotal ?? dailySalesHotel?.invoiceTotal ?? 0,
                            },
                            {
                              category: 'Transport sales',
                              amount: dailySalesHotel?.transportSales ?? 0,
                            },
                            { category: 'Discount', amount: dailySalesHotel?.discount ?? 0 },
                            { category: 'VAT', amount: dailySalesHotel?.vat ?? 0 },
                            { category: 'Restaurant POS', amount: dailySalesRestaurant?.grossSales ?? 0 },
                            { category: 'Grand total', amount: hotelDailySales?.grandTotal ?? 0 },
                          ],
                          `daily-sales-${reportBusinessDate}`
                        )
                      }
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {loadingDailySales ? (
                    <Skeleton className="h-40 w-full" />
                  ) : (
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between"><span>Room sales</span><span>৳{((dailySalesHotel?.roomSales || 0) as number).toLocaleString()}</span></div>
                      <div className="flex justify-between"><span>Food (invoice)</span><span>৳{((dailySalesHotel?.foodSales || 0) as number).toLocaleString()}</span></div>
                      <div className="flex justify-between"><span>Extras</span><span>৳{((dailySalesHotel?.extraSales || 0) as number).toLocaleString()}</span></div>
                      <div className="flex justify-between"><span>Hotel beverage (walk-in)</span><span>৳{((dailySalesHotel?.beverageWalkInSales || 0) as number).toLocaleString()}</span></div>
                      <div className="flex justify-between font-medium"><span>Hotel sales total</span><span>৳{((dailySalesHotel?.hotelSalesTotal ?? dailySalesHotel?.invoiceTotal ?? 0) as number).toLocaleString()}</span></div>
                      <div className="flex justify-between"><span>Transport sales</span><span>৳{((dailySalesHotel?.transportSales || 0) as number).toLocaleString()}</span></div>
                      <div className="flex justify-between"><span>Discount</span><span>৳{((dailySalesHotel?.discount || 0) as number).toLocaleString()}</span></div>
                      <div className="flex justify-between"><span>VAT</span><span>৳{((dailySalesHotel?.vat || 0) as number).toLocaleString()}</span></div>
                      <div className="flex justify-between"><span>Restaurant POS</span><span>৳{((dailySalesRestaurant?.grossSales || 0) as number).toLocaleString()}</span></div>
                      <hr />
                      <div className="flex justify-between font-semibold"><span>Grand total</span><span>৳{((hotelDailySales?.grandTotal || 0) as number).toLocaleString()}</span></div>
                      <div className="flex justify-between text-muted-foreground"><span>Collections</span><span>৳{((hotelDailySales?.collections || 0) as number).toLocaleString()}</span></div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-base">Collections by Method</CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => exportCSV(dailyCollectionsByMethod || [], `daily-collections-${reportBusinessDate}`)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
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
                        {dailyCollectionsByMethod?.length ? dailyCollectionsByMethod.map((row, i) => (
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
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-base">Daily Arrivals / Check-ins</CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => exportCSV(dailyArrivalsGuests || [], `daily-arrivals-${reportBusinessDate}`)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
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
                        {loadingDailyArrivals ? (
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
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-base">Daily Departures / Check-outs</CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => exportCSV(dailyDeparturesGuests || [], `daily-departures-${reportBusinessDate}`)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
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
                        {loadingDailyDepartures ? (
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

            {dailyCollectionPayments && dailyCollectionPayments.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-base">Payment Register</CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => exportCSV(dailyCollectionPayments, `payment-register-${reportBusinessDate}`)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
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
                          <TableHead>Received by</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dailyCollectionPayments.map((p, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-xs">
                              {p.at ? format(parseISO(String(p.at)), 'h:mm a') : '—'}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {String(p.purpose || '—')}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {String(p.roomNumber || '—')}
                            </TableCell>
                            <TableCell>{String(p.method)}</TableCell>
                            <TableCell>{String(p.receivedBy)}</TableCell>
                            <TableCell className="text-right">৳{Number(p.amount || 0).toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Total Revenue</p>
                  <p className="text-2xl font-bold text-amber-700">
                    ৳{((hotelRevenue?.totalRevenue || 0) as number).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Occupancy Rate</p>
                  <p className="text-2xl font-bold text-emerald-700">
                    {(hotelOccupancy?.occupancyRate || 0 as number).toFixed(1)}%
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Total Bookings</p>
                  <p className="text-2xl font-bold text-sky-700">{((hotelRevenue?.totalBookings || 0) as number)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Avg Daily Rate</p>
                  <p className="text-2xl font-bold text-purple-700">
                    ৳{((hotelRevenue?.averageRate || 0) as number).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Revenue by Room Type Chart */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-base">Revenue by Room Type</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => exportCSV(revenueByTypeData, 'room-revenue')}>
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {loadingHotelRevenue ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <ChartContainer config={barChartConfig} className="h-64 w-full">
                    <BarChart data={revenueByTypeData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="type" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="revenue" fill="var(--color-hotelRevenue)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            {/* Occupancy Info & Food Charges */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Room Status Overview</CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingOccupancy ? (
                    <Skeleton className="h-48 w-full" />
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-between"><span className="text-muted-foreground">Total Rooms</span><span className="font-semibold">{(hotelOccupancy?.totalRooms || 0) as number}</span></div>
                      <div className="flex justify-between"><span className="text-emerald-600">Available</span><span className="font-semibold">{(hotelOccupancy?.availableRooms || 0) as number}</span></div>
                      <div className="flex justify-between"><span className="text-amber-600">Occupied</span><span className="font-semibold">{(hotelOccupancy?.occupiedRooms || 0) as number}</span></div>
                      <div className="flex justify-between"><span className="text-sky-600">Cleaning</span><span className="font-semibold">{(hotelOccupancy?.cleaningRooms || 0) as number}</span></div>
                      <div className="flex justify-between"><span className="text-red-600">Maintenance</span><span className="font-semibold">{(hotelOccupancy?.maintenanceRooms || 0) as number}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Today Check-ins</span><span className="font-semibold">{(hotelOccupancy?.todayCheckins || 0) as number}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Today Check-outs</span><span className="font-semibold">{(hotelOccupancy?.todayCheckouts || 0) as number}</span></div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-base">Food Charges by Room</CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => exportCSV(roomsData || [], 'food-by-room')}>
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-64 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Room</TableHead>
                          <TableHead className="text-right">Orders</TableHead>
                          <TableHead className="text-right">Charges</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {roomsData?.length ? roomsData.map((r, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono">{r.roomNumber}</TableCell>
                            <TableCell className="text-right">{r.totalOrders}</TableCell>
                            <TableCell className="text-right text-emerald-600">৳{r.totalCharges.toLocaleString()}</TableCell>
                          </TableRow>
                        )) : (
                          <TableRow><TableCell colSpan={3} className="text-center py-4 text-muted-foreground">No data</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}

        {/* Combined Reports - ADMIN only */}
        {isAdmin && (
          <TabsContent value="combined" className="space-y-4">
            {/* Revenue Breakdown */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Total Revenue</p>
                  <p className="text-2xl font-bold text-foreground">
                    ৳{((combinedRevenue?.totalRevenue || 0) as number).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Hotel Revenue</p>
                  <p className="text-2xl font-bold text-amber-700">
                    ৳{((combinedRevenue?.hotelRevenue || 0) as number).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Restaurant Revenue</p>
                  <p className="text-2xl font-bold text-emerald-700">
                    ৳{((combinedRevenue?.restaurantRevenue || 0) as number).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Revenue Breakdown Bar Chart */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-base">Revenue Breakdown</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => exportCSV(combinedData, 'combined-revenue')}>
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {loadingCombined ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <ChartContainer config={barChartConfig} className="h-64 w-full">
                    <BarChart data={combinedData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                        {combinedData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            {/* Profit Summary & Top Customers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Profit Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingAdminSummary ? (
                    <Skeleton className="h-48 w-full" />
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-between"><span className="text-muted-foreground">Total Revenue</span><span className="font-semibold">৳{((adminSummary?.totalRevenue || 0) as number).toLocaleString()}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Total Payments Received</span><span className="font-semibold text-emerald-600">৳{((adminSummary?.profitSummary as Record<string, number>)?.totalPaymentsReceived || 0).toLocaleString()}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Outstanding Dues</span><span className="font-semibold text-red-600">৳{((adminSummary?.profitSummary as Record<string, number>)?.outstandingDues || 0).toLocaleString()}</span></div>
                      <hr />
                      <div className="flex justify-between"><span className="text-foreground font-medium">Net Position</span><span className={`font-bold ${((adminSummary?.profitSummary as Record<string, number>)?.netPosition || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>৳{((adminSummary?.profitSummary as Record<string, number>)?.netPosition || 0).toLocaleString()}</span></div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-base">Collections by Method</CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => exportCSV(paymentsByMethodData, 'payments-by-method')}>
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
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
                        {paymentsByMethodData.length ? paymentsByMethodData.map((row, i) => (
                          <TableRow key={i}>
                            <TableCell>{row.method}</TableCell>
                            <TableCell className="text-right text-emerald-600">৳{row.amount.toLocaleString()}</TableCell>
                          </TableRow>
                        )) : (
                          <TableRow><TableCell colSpan={2} className="text-center py-4 text-muted-foreground">No payment data</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="md:col-span-2">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-base">Top Customers</CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => exportCSV(topCustomers || [], 'top-customers')}>
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-64 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead className="text-right">Bookings</TableHead>
                          <TableHead className="text-right">Total Spent</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topCustomers?.length ? topCustomers.map((c, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium">{c.name}</TableCell>
                            <TableCell className="text-right">{c.bookingCount}</TableCell>
                            <TableCell className="text-right text-emerald-600">৳{c.totalSpent.toLocaleString()}</TableCell>
                          </TableRow>
                        )) : (
                          <TableRow><TableCell colSpan={3} className="text-center py-4 text-muted-foreground">No data</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
