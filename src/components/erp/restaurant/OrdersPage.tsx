'use client'

import { Fragment, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/lib/auth-store'
import { resolveBookingDateRange } from '@/lib/booking-date-filter'
import {
  ORDER_DATE_PRESET_OPTIONS,
  type OrderDatePreset,
} from '@/lib/restaurant-order-date-filter'
import {
  buildRestaurantOrdersExportQuery,
  downloadRestaurantOrdersExcel,
  downloadRestaurantOrdersPdf,
  type RestaurantOrderExportRecord,
} from '@/lib/restaurant-orders-export'
import { toast } from 'sonner'
import {
  UtensilsCrossed,
  ShoppingBag,
  BedDouble,
  Clock,
  ChefHat,
  CheckCircle2,
  AlertCircle,
  Eye,
  Flame,
  Search,
  CalendarRange,
  FileDown,
  Loader2,
  ArrowUpDown,
} from 'lucide-react'
import {
  formatOrderBillingDetail,
  isRoomServiceGuestOrder,
  resolveOrderBillingState,
} from '@/lib/restaurant-order-billing'
import { RestaurantOrderDeliveredActions } from './RestaurantOrderDeliveredActions'
import {
  RestaurantOrderPaymentDialog,
  type RestaurantOrderPaymentTarget,
} from './RestaurantOrderPaymentDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

// Types
interface OrderItem {
  id: string
  menuItemId: string
  quantity: number
  price: number
  notes: string | null
  kotStatus: string
  menuItem: {
    id: string
    name: string
    price: number
    isVeg: boolean
  }
}

interface RestaurantOrder {
  id: string
  orderNumber: string
  orderType: 'DINE_IN' | 'TAKEAWAY' | 'ROOM_SERVICE'
  status: 'PENDING' | 'COOKING' | 'READY' | 'DELIVERED' | 'CANCELLED'
  roomId: string | null
  tableId: string | null
  customerName: string | null
  customerPhone: string | null
  subtotal: number
  discount: number
  vatAmount: number
  vatPercent: number
  totalAmount: number
  billingDisposition?: 'PENDING' | 'HOTEL_BILL' | 'PAID_DIRECT'
  bookingId?: string | null
  notes: string | null
  createdAt: string
  items: OrderItem[]
  payments?: { amount: number; paymentType: string; settlementSource?: string | null }[]
  companyLedgerBill?: { id: string } | null
  booking?: { id: string } | null
  room: { id: string; roomNumber: string; status: string } | null
  table: { id: string; tableNumber: string; capacity: number; status: string } | null
  creator: { id: string; name: string; email: string } | null
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: typeof Clock; label: string }> = {
  PENDING: { color: 'text-yellow-700', bg: 'bg-yellow-100 border-yellow-200', icon: Clock, label: 'Pending' },
  COOKING: { color: 'text-orange-700', bg: 'bg-orange-100 border-orange-200', icon: Flame, label: 'Cooking' },
  READY: { color: 'text-green-700', bg: 'bg-green-100 border-green-200', icon: CheckCircle2, label: 'Ready' },
  DELIVERED: { color: 'text-muted-foreground', bg: 'bg-muted border-border', icon: CheckCircle2, label: 'Delivered' },
  CANCELLED: { color: 'text-red-600', bg: 'bg-red-100 border-red-200', icon: AlertCircle, label: 'Cancelled' },
}

const ORDER_TYPE_CONFIG: Record<string, { icon: typeof UtensilsCrossed; label: string; color: string }> = {
  DINE_IN: { icon: UtensilsCrossed, label: 'Dine-in', color: 'text-blue-600' },
  TAKEAWAY: { icon: ShoppingBag, label: 'Takeaway', color: 'text-purple-600' },
  ROOM_SERVICE: { icon: BedDouble, label: 'Room Svc', color: 'text-amber-600' },
}

type OrderSort = 'newest' | 'oldest'

function billingBadgeClass(state: string) {
  if (state === 'HOTEL_BILL') return 'bg-sky-50 text-sky-800 border-sky-200'
  if (state === 'PAID_DIRECT') return 'bg-emerald-50 text-emerald-800 border-emerald-200'
  return 'bg-amber-50 text-amber-800 border-amber-200'
}

function buildOrdersQueryParams(input: {
  activeTab: string
  filterType: string
  dateFrom?: string
  dateTo?: string
  sort: OrderSort
  limit?: number
}) {
  const params = new URLSearchParams({
    limit: String(input.limit ?? 500),
    sort: input.sort === 'oldest' ? 'asc' : 'desc',
  })
  if (input.activeTab !== 'ALL') params.set('status', input.activeTab)
  if (input.filterType !== 'all') params.set('orderType', input.filterType)
  if (input.dateFrom) params.set('dateFrom', input.dateFrom)
  if (input.dateTo) params.set('dateTo', input.dateTo)
  return params
}

function matchesOrderSearch(order: RestaurantOrder, query: string) {
  if (!query) return true
  const q = query.toLowerCase()
  return (
    order.orderNumber.toLowerCase().includes(q) ||
    order.customerName?.toLowerCase().includes(q) ||
    order.room?.roomNumber.toLowerCase().includes(q) ||
    order.table?.tableNumber.toLowerCase().includes(q)
  )
}

export default function OrdersPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [activeTab, setActiveTab] = useState('ALL')
  const [selectedOrder, setSelectedOrder] = useState<RestaurantOrder | null>(null)
  const [filterType, setFilterType] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [datePreset, setDatePreset] = useState<OrderDatePreset>('today')
  const [customDateFrom, setCustomDateFrom] = useState('')
  const [customDateTo, setCustomDateTo] = useState('')
  const [sortOrder, setSortOrder] = useState<OrderSort>('newest')
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)
  const [payTarget, setPayTarget] = useState<{
    order: RestaurantOrderPaymentTarget
    roomGuest: boolean
  } | null>(null)

  const dateRange = useMemo(
    () => resolveBookingDateRange(datePreset, customDateFrom, customDateTo),
    [datePreset, customDateFrom, customDateTo]
  )

  // Fetch orders
  const { data: ordersData, isLoading } = useQuery({
    queryKey: [
      'restaurant-orders',
      activeTab,
      filterType,
      datePreset,
      dateRange.dateFrom,
      dateRange.dateTo,
      sortOrder,
    ],
    queryFn: () => {
      const params = buildOrdersQueryParams({
        activeTab,
        filterType,
        dateFrom: dateRange.dateFrom,
        dateTo: dateRange.dateTo,
        sort: sortOrder,
      })
      return api.get<{ success: boolean; data: RestaurantOrder[]; meta?: { total: number } }>(
        `/restaurant-orders?${params.toString()}`
      )
    },
    refetchInterval: 15000,
  })

  const { data: statusStatsData } = useQuery({
    queryKey: [
      'restaurant-orders',
      'status-counts',
      filterType,
      datePreset,
      dateRange.dateFrom,
      dateRange.dateTo,
    ],
    queryFn: () => {
      const params = new URLSearchParams()
      if (filterType !== 'all') params.set('orderType', filterType)
      if (dateRange.dateFrom) params.set('dateFrom', dateRange.dateFrom)
      if (dateRange.dateTo) params.set('dateTo', dateRange.dateTo)
      return api.get<{
        success: boolean
        data: {
          counts: {
            ALL: number
            PENDING: number
            COOKING: number
            READY: number
            DELIVERED: number
            CANCELLED: number
          }
        }
      }>(`/restaurant-orders/stats?${params.toString()}`)
    },
    refetchInterval: 15000,
  })

  const orders = ordersData?.data || []

  // Status update mutation
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/restaurant-orders/${id}/status`, { status }),
    onSuccess: (_, variables) => {
      const nextStatus: Record<string, string> = {
        PENDING: 'Cooking',
        COOKING: 'Ready',
        READY: 'Delivered',
      }
      toast.success(`Order moved to ${nextStatus[variables.status] || variables.status}`)
      queryClient.invalidateQueries({ queryKey: ['restaurant-orders'] })
      queryClient.invalidateQueries({ queryKey: ['restaurant-orders', 'status-counts'] })
    },
    onError: (error: Error) => {
      toast.error('Failed to update order status', { description: error.message })
    },
  })

  const sendToHotelMutation = useMutation({
    mutationFn: (orderId: string) =>
      api.post(`/restaurant-orders/${orderId}/send-to-hotel`, {}),
    onSuccess: (res: { success?: boolean; message?: string; error?: string }) => {
      if (!res?.success) {
        toast.error(res?.error || 'Failed to send to hotel')
        return
      }
      toast.success(res.message || 'Order sent to hotel billing')
      queryClient.invalidateQueries({ queryKey: ['restaurant-orders'] })
      queryClient.invalidateQueries({ queryKey: ['cloudview-ledger'] })
      queryClient.invalidateQueries({ queryKey: ['company-ledger'] })
    },
    onError: (error: Error) => {
      toast.error('Failed to send to hotel', { description: error.message })
    },
  })

  const openPayForOrder = (order: RestaurantOrder) => {
    setPayTarget({
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        payments: order.payments,
      },
      roomGuest: isRoomServiceGuestOrder(order),
    })
  }

  const filteredOrders = orders.filter((order) => matchesOrderSearch(order, searchQuery))

  const statusCounts = statusStatsData?.data?.counts ?? {
    ALL: 0,
    PENDING: 0,
    COOKING: 0,
    READY: 0,
    DELIVERED: 0,
    CANCELLED: 0,
  }

  const getNextStatus = (current: string): string | null => {
    const flow: Record<string, string> = {
      PENDING: 'COOKING',
      COOKING: 'READY',
      READY: 'DELIVERED',
    }
    return flow[current] || null
  }

  const getNextStatusLabel = (current: string): string => {
    const labels: Record<string, string> = {
      PENDING: 'Start Cooking',
      COOKING: 'Mark Ready',
      READY: 'Mark Delivered',
    }
    return labels[current] || ''
  }

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const buildExportMeta = () => ({
    exportedAt: new Date(),
    generatedBy: user ? { name: user.name, email: user.email, role: user.role } : undefined,
    datePreset,
    customDateFrom,
    customDateTo,
    orderType: filterType,
    status: activeTab,
    sort: sortOrder,
    search: searchQuery.trim() || undefined,
  })

  const fetchExportRows = async (): Promise<RestaurantOrderExportRecord[]> => {
    const path = buildRestaurantOrdersExportQuery({
      status: activeTab,
      orderType: filterType,
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
      sort: sortOrder === 'oldest' ? 'asc' : 'desc',
    })
    const res = await api.get<{ success: boolean; data: RestaurantOrderExportRecord[] }>(path)
    return (res.data ?? []).filter((order) => matchesOrderSearch(order as RestaurantOrder, searchQuery))
  }

  const handleExportExcel = async () => {
    setExporting('excel')
    const toastId = toast.loading('Preparing Excel export…')
    try {
      const exportRows = await fetchExportRows()
      if (!exportRows.length) {
        toast.error('No orders to export', {
          id: toastId,
          description: 'Adjust filters or search to include orders in the export.',
        })
        return
      }
      await downloadRestaurantOrdersExcel(exportRows, buildExportMeta())
      toast.success(`Exported ${exportRows.length} order(s) to Excel`, { id: toastId })
    } catch (err) {
      toast.error('Export failed', {
        id: toastId,
        description: err instanceof Error ? err.message : 'Could not export orders',
      })
    } finally {
      setExporting(null)
    }
  }

  const handleExportPdf = async () => {
    setExporting('pdf')
    const toastId = toast.loading('Preparing PDF export…')
    try {
      const exportRows = await fetchExportRows()
      if (!exportRows.length) {
        toast.error('No orders to export', {
          id: toastId,
          description: 'Adjust filters or search to include orders in the export.',
        })
        return
      }
      await downloadRestaurantOrdersPdf(exportRows, buildExportMeta())
      toast.success(`Exported ${exportRows.length} order(s) to PDF`, { id: toastId })
    } catch (err) {
      toast.error('Export failed', {
        id: toastId,
        description: err instanceof Error ? err.message : 'Could not export orders',
      })
    } finally {
      setExporting(null)
    }
  }

  const timeElapsed = (dateStr: string) => {
    const now = new Date()
    const then = new Date(dateStr)
    const diff = Math.floor((now.getTime() - then.getTime()) / 60000)
    if (diff < 1) return 'Just now'
    if (diff < 60) return `${diff}m ago`
    return `${Math.floor(diff / 60)}h ${diff % 60}m ago`
  }

  return (
    <div className="h-full flex flex-col bg-muted">
      {/* Header */}
      <div className="bg-slate-900 text-white px-6 py-4 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500 flex items-center justify-center">
              <ChefHat className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Orders Management</h1>
              <p className="text-xs text-slate-300">CloudView Restaurant</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border border-slate-500 bg-slate-800/80 text-white hover:bg-slate-700 hover:text-white hover:border-slate-400"
              onClick={() => void handleExportExcel()}
              disabled={!!exporting || isLoading}
            >
              {exporting === 'excel' ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileDown className="h-4 w-4 mr-2" />
              )}
              Export Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border border-slate-500 bg-slate-800/80 text-white hover:bg-slate-700 hover:text-white hover:border-slate-400"
              onClick={() => void handleExportPdf()}
              disabled={!!exporting || isLoading}
            >
              {exporting === 'pdf' ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileDown className="h-4 w-4 mr-2" />
              )}
              Export PDF
            </Button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 bg-card border-b shrink-0 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search orders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-9"
            />
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue placeholder="Order Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="DINE_IN">Dine-in</SelectItem>
              <SelectItem value="TAKEAWAY">Takeaway</SelectItem>
              <SelectItem value="ROOM_SERVICE">Room Service</SelectItem>
            </SelectContent>
          </Select>
          <Select value={datePreset} onValueChange={(v) => setDatePreset(v as OrderDatePreset)}>
            <SelectTrigger className="h-9 w-[160px]">
              <CalendarRange className="h-4 w-4 mr-2 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORDER_DATE_PRESET_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as OrderSort)}>
            <SelectTrigger className="h-9 w-[160px]">
              <ArrowUpDown className="h-4 w-4 mr-2 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {datePreset === 'custom' && (
          <div className="flex flex-col sm:flex-row gap-3 max-w-lg">
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input
                type="date"
                value={customDateFrom}
                onChange={(e) => setCustomDateFrom(e.target.value)}
                className="h-9 mt-1"
              />
            </div>
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input
                type="date"
                value={customDateTo}
                onChange={(e) => setCustomDateTo(e.target.value)}
                className="h-9 mt-1"
              />
            </div>
          </div>
        )}
      </div>

      {/* Status Tabs */}
      <div className="px-6 pt-3 bg-card border-b shrink-0">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-muted">
            {(['ALL', 'PENDING', 'COOKING', 'READY', 'DELIVERED'] as const).map((key) => (
              <TabsTrigger key={key} value={key} className="text-xs gap-1.5">
                {key === 'ALL' ? 'All' : key.charAt(0) + key.slice(1).toLowerCase()}
                <Badge variant="secondary" className="h-4 min-w-4 text-[10px] px-1">
                  {statusCounts[key]}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Orders Table */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <ChefHat className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No orders found</p>
          </div>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Order #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Table/Room</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date &amp; Time</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map((order) => {
                  const statusCfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.PENDING
                  const typeCfg = ORDER_TYPE_CONFIG[order.orderType]
                  const TypeIcon = typeCfg.icon
                  const nextStatus = getNextStatus(order.status)
                  const isExpanded = expandedRow === order.id

                  return (
                    <Fragment key={order.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted"
                        onClick={() => setExpandedRow(isExpanded ? null : order.id)}
                      >
                        <TableCell className="font-mono font-semibold text-sm">
                          {order.orderNumber}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <TypeIcon className={`w-4 h-4 ${typeCfg.color}`} />
                            <span className="text-xs">{typeCfg.label}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {order.orderType === 'DINE_IN' && order.table && (
                            <span className="text-xs">T-{order.table.tableNumber}</span>
                          )}
                          {order.orderType === 'ROOM_SERVICE' && order.room && (
                            <span className="text-xs">R-{order.room.roomNumber}</span>
                          )}
                          {order.orderType === 'TAKEAWAY' && order.customerName && (
                            <span className="text-xs">{order.customerName}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {order.items.length}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-semibold text-sm">
                          ৳{order.totalAmount.toFixed(0)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge
                              variant="outline"
                              className={`${statusCfg.bg} ${statusCfg.color} border text-xs w-fit`}
                            >
                              {statusCfg.label}
                            </Badge>
                            {order.status === 'DELIVERED' && (
                              <Badge
                                variant="outline"
                                className={`${billingBadgeClass(resolveOrderBillingState(order))} text-[10px] w-fit`}
                              >
                                {formatOrderBillingDetail(order)}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(order.createdAt)}
                          <br />
                          <span className="text-[10px]">{timeElapsed(order.createdAt)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div
                            className="flex flex-row flex-nowrap items-center justify-end gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              title="View order"
                              onClick={() => setSelectedOrder(order)}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            {nextStatus && (
                              <Button
                                size="sm"
                                className="h-7 shrink-0 text-xs bg-amber-600 hover:bg-amber-700"
                                onClick={() =>
                                  statusMutation.mutate({ id: order.id, status: nextStatus })
                                }
                                disabled={statusMutation.isPending}
                              >
                                {getNextStatusLabel(order.status)}
                              </Button>
                            )}
                            {order.status === 'DELIVERED' && (
                              <RestaurantOrderDeliveredActions
                                order={order}
                                iconOnly
                                onPay={openPayForOrder}
                                onSendToHotel={(orderId) => sendToHotelMutation.mutate(orderId)}
                                sendToHotelPending={sendToHotelMutation.isPending}
                              />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${order.id}-detail`}>
                          <TableCell colSpan={8} className="bg-muted px-8 py-4">
                            <div className="space-y-2">
                              <h4 className="font-semibold text-sm text-foreground">Order Items</h4>
                              {order.items.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-center justify-between text-sm"
                                >
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={`w-2 h-2 rounded-full ${
                                        item.menuItem.isVeg ? 'bg-green-500' : 'bg-red-500'
                                      }`}
                                    />
                                    <span>{item.menuItem.name}</span>
                                    <span className="text-muted-foreground">× {item.quantity}</span>
                                  </div>
                                  <span className="font-medium">
                                    ৳{(item.price * item.quantity).toFixed(0)}
                                  </span>
                                </div>
                              ))}
                              <Separator />
                              <div className="flex justify-between text-xs text-muted-foreground">
                                <span>Subtotal: ৳{order.subtotal.toFixed(0)}</span>
                                <span>Discount: ৳{order.discount.toFixed(0)}</span>
                                <span>VAT: ৳{order.vatAmount.toFixed(0)}</span>
                                <span className="font-bold text-foreground">
                                  Total: ৳{order.totalAmount.toFixed(0)}
                                </span>
                              </div>
                              {order.notes && (
                                <div className="text-xs text-muted-foreground bg-amber-50 p-2 rounded">
                                  📝 {order.notes}
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      {/* Order Detail Dialog */}
      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Order {selectedOrder?.orderNumber}
              {selectedOrder && (() => {
                const cfg = STATUS_CONFIG[selectedOrder.status]
                return (
                  <Badge variant="outline" className={`${cfg.bg} ${cfg.color} border`}>
                    {cfg.label}
                  </Badge>
                )
              })()}
            </DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Type:</span>{' '}
                  {ORDER_TYPE_CONFIG[selectedOrder.orderType].label}
                </div>
                <div>
                  <span className="text-muted-foreground">Created:</span>{' '}
                  {formatDateTime(selectedOrder.createdAt)}
                </div>
                {selectedOrder.orderType === 'DINE_IN' && selectedOrder.table && (
                  <div>
                    <span className="text-muted-foreground">Table:</span>{' '}
                    {selectedOrder.table.tableNumber}
                  </div>
                )}
                {selectedOrder.orderType === 'ROOM_SERVICE' && selectedOrder.room && (
                  <div>
                    <span className="text-muted-foreground">Room:</span>{' '}
                    {selectedOrder.room.roomNumber}
                  </div>
                )}
                {selectedOrder.orderType === 'TAKEAWAY' && selectedOrder.customerName && (
                  <div>
                    <span className="text-muted-foreground">Customer:</span>{' '}
                    {selectedOrder.customerName}
                  </div>
                )}
                {selectedOrder.creator && (
                  <div>
                    <span className="text-muted-foreground">Created by:</span>{' '}
                    {selectedOrder.creator.name}
                  </div>
                )}
              </div>

              <Separator />

              <div>
                <h4 className="font-semibold text-sm mb-2">Items</h4>
                <div className="space-y-2">
                  {selectedOrder.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            item.menuItem.isVeg ? 'bg-green-500' : 'bg-red-500'
                          }`}
                        />
                        <span>{item.menuItem.name}</span>
                        <span className="text-muted-foreground">× {item.quantity}</span>
                      </div>
                      <span className="font-medium">
                        ৳{(item.price * item.quantity).toFixed(0)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>৳{selectedOrder.subtotal.toFixed(0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Discount</span>
                  <span>৳{selectedOrder.discount.toFixed(0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">VAT ({selectedOrder.vatPercent}%)</span>
                  <span>৳{selectedOrder.vatAmount.toFixed(0)}</span>
                </div>
                <Separator />
                <div className="flex justify-between font-bold">
                  <span>Total</span>
                  <span className="text-amber-700">৳{selectedOrder.totalAmount.toFixed(0)}</span>
                </div>
              </div>

              {selectedOrder.notes && (
                <div className="bg-amber-50 p-3 rounded-lg text-sm">
                  <span className="font-medium">Notes:</span> {selectedOrder.notes}
                </div>
              )}

              {getNextStatus(selectedOrder.status) && (
                <Button
                  onClick={() => {
                    statusMutation.mutate({
                      id: selectedOrder.id,
                      status: getNextStatus(selectedOrder.status)!,
                    })
                    setSelectedOrder(null)
                  }}
                  disabled={statusMutation.isPending}
                  className="w-full bg-amber-600 hover:bg-amber-700"
                >
                  {getNextStatusLabel(selectedOrder.status)}
                </Button>
              )}

              {selectedOrder.status === 'DELIVERED' && (
                <div className="space-y-2 pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    Billing: {formatOrderBillingDetail(selectedOrder)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <RestaurantOrderDeliveredActions
                      order={selectedOrder}
                      iconOnly
                      onPay={openPayForOrder}
                      onSendToHotel={(orderId) => sendToHotelMutation.mutate(orderId)}
                      sendToHotelPending={sendToHotelMutation.isPending}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <RestaurantOrderPaymentDialog
        order={payTarget?.order ?? null}
        open={!!payTarget}
        onOpenChange={(open) => {
          if (!open) setPayTarget(null)
        }}
        roomGuestOrder={payTarget?.roomGuest ?? false}
      />
    </div>
  )
}
