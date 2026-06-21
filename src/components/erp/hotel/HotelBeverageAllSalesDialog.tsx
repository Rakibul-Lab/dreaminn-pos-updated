'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { Download, FileSpreadsheet, FileText, Search } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/lib/auth-store'
import { useBusinessDate } from '@/hooks/use-business-date'
import {
  type BookingDatePreset,
} from '@/lib/booking-date-filter'
import {
  buildBeverageSalesExportQuery,
  buildBeverageSalesFilterLabels,
  buildBeverageSalesListQuery,
  resolveBeverageSalesDateRange,
} from '@/lib/hotel-beverage-sales-list'
import {
  downloadBeverageSalesExcel,
  downloadBeverageSalesPdf,
  type BeverageSaleExportRecord,
} from '@/lib/hotel-beverage-sales-export'
import { openHotelBeverageReceiptTab } from '@/lib/hotel-beverage-receipt-navigation'
import { formatBdt } from '@/lib/currency'
import { formatPaymentMethod } from '@/lib/payment-method'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
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

type BeverageSaleListItem = BeverageSaleExportRecord

type SalesListResponse = {
  success: boolean
  data: BeverageSaleListItem[]
  meta?: {
    total?: number
    page?: number
    limit?: number
    totalPages?: number
    totalAmount?: number
  }
}

const DATE_PRESET_OPTIONS: { value: BookingDatePreset; label: string }[] = [
  { value: 'all', label: 'All dates' },
  { value: 'today', label: 'Business today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'custom', label: 'Custom range' },
]

type HotelBeverageAllSalesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function HotelBeverageAllSalesDialog({
  open,
  onOpenChange,
}: HotelBeverageAllSalesDialogProps) {
  const user = useAuthStore((s) => s.user)
  const { data: businessDateRes } = useBusinessDate()
  const businessDate = businessDateRes?.data?.businessDate

  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [datePreset, setDatePreset] = useState<BookingDatePreset>('today')
  const [customDateFrom, setCustomDateFrom] = useState('')
  const [customDateTo, setCustomDateTo] = useState('')
  const [saleTypeFilter, setSaleTypeFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)
  const pageSize = 25

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [searchInput, open])

  useEffect(() => {
    if (!open) return
    setPage(1)
  }, [searchQuery, datePreset, customDateFrom, customDateTo, saleTypeFilter, open])

  const dateRange = useMemo(
    () => resolveBeverageSalesDateRange(datePreset, customDateFrom, customDateTo, businessDate),
    [datePreset, customDateFrom, customDateTo, businessDate]
  )

  const needsBusinessDate = datePreset === 'today' || datePreset === 'yesterday'
  const businessDateReady = !needsBusinessDate || !!businessDate

  const listQuery = useMemo(
    () =>
      buildBeverageSalesListQuery({
        page,
        limit: pageSize,
        search: searchQuery || undefined,
        saleType: saleTypeFilter !== 'all' ? saleTypeFilter : undefined,
        dateFrom: dateRange.dateFrom,
        dateTo: dateRange.dateTo,
      }),
    [page, searchQuery, saleTypeFilter, dateRange.dateFrom, dateRange.dateTo]
  )

  const { data: salesRes, isLoading, isFetching } = useQuery({
    queryKey: ['hotel-beverage-sales-all', listQuery],
    queryFn: () => api.get<SalesListResponse>(listQuery),
    enabled: open && businessDateReady,
  })

  const sales = salesRes?.data ?? []
  const total = salesRes?.meta?.total ?? 0
  const totalPages = salesRes?.meta?.totalPages ?? 1
  const filteredTotalAmount = salesRes?.meta?.totalAmount ?? 0

  const buildExportMeta = () => ({
    filters: buildBeverageSalesFilterLabels({
      datePreset,
      customDateFrom,
      customDateTo,
      saleType: saleTypeFilter,
      search: searchQuery,
      businessDate,
    }),
    exportedAt: new Date(),
    generatedBy: user
      ? { name: user.name, email: user.email, role: user.role }
      : undefined,
  })

  const fetchSalesForExport = async () => {
    const url = buildBeverageSalesExportQuery({
      search: searchQuery || undefined,
      saleType: saleTypeFilter !== 'all' ? saleTypeFilter : undefined,
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
    })
    const res = await api.get<SalesListResponse>(url)
    if (!res?.success) throw new Error('Failed to fetch sales for export')
    return res.data ?? []
  }

  const handleExportExcel = async () => {
    setExporting('excel')
    const toastId = toast.loading('Preparing Excel export…')
    try {
      const rows = await fetchSalesForExport()
      if (!rows.length) {
        toast.error('No sales match the current filters', { id: toastId })
        return
      }
      await downloadBeverageSalesExcel(rows, buildExportMeta())
      toast.success(`Exported ${rows.length} sale(s) to Excel`, { id: toastId })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed', { id: toastId })
    } finally {
      setExporting(null)
    }
  }

  const handleExportPdf = async () => {
    setExporting('pdf')
    const toastId = toast.loading('Preparing PDF export…')
    try {
      const rows = await fetchSalesForExport()
      if (!rows.length) {
        toast.error('No sales match the current filters', { id: toastId })
        return
      }
      await downloadBeverageSalesPdf(rows, buildExportMeta())
      toast.success(`Exported ${rows.length} sale(s) to PDF`, { id: toastId })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed', { id: toastId })
    } finally {
      setExporting(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-0 p-0 overflow-hidden w-[calc(100vw-1.5rem)] sm:max-w-6xl max-h-[92vh]">
        <DialogHeader className="px-5 sm:px-6 pt-5 sm:pt-6 pb-4 border-b shrink-0 bg-emerald-50/50">
          <DialogTitle className="text-emerald-950">All beverage sales</DialogTitle>
        </DialogHeader>

        <div className="px-5 sm:px-6 py-4 border-b bg-muted/30 shrink-0 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
            <div className="relative md:col-span-5 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search sale #, guest, room, phone, items…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9 h-9 bg-background"
              />
            </div>
            <div className="md:col-span-3">
              <Select value={saleTypeFilter} onValueChange={setSaleTypeFilter}>
                <SelectTrigger className="w-full h-9 bg-background">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="WALK_IN">Walk-in</SelectItem>
                  <SelectItem value="ROOM">Room charge</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-4">
              <Select
                value={datePreset}
                onValueChange={(v) => setDatePreset(v as BookingDatePreset)}
              >
                <SelectTrigger className="w-full h-9 bg-background">
                  <SelectValue placeholder="Date" />
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
          </div>

          {datePreset === 'custom' && (
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                type="date"
                value={customDateFrom}
                onChange={(e) => setCustomDateFrom(e.target.value)}
                className="h-9"
              />
              <Input
                type="date"
                value={customDateTo}
                onChange={(e) => setCustomDateTo(e.target.value)}
                min={customDateFrom || undefined}
                className="h-9"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-foreground/80">
              <span className="font-semibold text-emerald-800">{total}</span> sale
              {total === 1 ? '' : 's'}
              {filteredTotalAmount > 0 ? (
                <>
                  {' '}
                  · <span className="font-semibold text-emerald-800">{formatBdt(filteredTotalAmount)}</span> total
                </>
              ) : null}
              {isFetching && !isLoading ? ' · Updating…' : ''}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                disabled={exporting !== null}
                onClick={handleExportExcel}
              >
                {exporting === 'excel' ? (
                  <Download className="h-3.5 w-3.5 animate-pulse" />
                ) : (
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                )}
                Excel
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                disabled={exporting !== null}
                onClick={handleExportPdf}
              >
                {exporting === 'pdf' ? (
                  <Download className="h-3.5 w-3.5 animate-pulse" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                PDF
              </Button>
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-5 sm:px-6 py-2 overflow-x-auto">
            {isLoading ? (
              <div className="space-y-2 py-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : sales.length === 0 ? (
              <p className="text-sm text-muted-foreground py-12 text-center">
                No beverage sales match your filters.
              </p>
            ) : (
              <table className="w-full min-w-[880px] text-sm">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium whitespace-nowrap">Sale #</th>
                    <th className="py-2 pr-4 font-medium whitespace-nowrap">Date</th>
                    <th className="py-2 pr-4 font-medium whitespace-nowrap">Type</th>
                    <th className="py-2 pr-4 font-medium min-w-[160px]">Guest / Room</th>
                    <th className="py-2 pr-4 font-medium whitespace-nowrap">Payment</th>
                    <th className="py-2 pr-4 font-medium text-right whitespace-nowrap">Amount</th>
                    <th className="py-2 font-medium text-right whitespace-nowrap w-[88px]">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => (
                    <tr key={sale.id} className="border-b last:border-0 align-top hover:bg-muted/30">
                      <td className="py-2.5 pr-4 font-mono text-xs whitespace-nowrap">{sale.saleNumber}</td>
                      <td className="py-2.5 pr-4 text-xs whitespace-nowrap">
                        {format(parseISO(sale.createdAt), 'dd MMM yyyy · HH:mm')}
                      </td>
                      <td className="py-2.5 pr-4 whitespace-nowrap">
                        <Badge
                          variant="outline"
                          className={
                            sale.saleType === 'ROOM'
                              ? 'border-sky-300 bg-sky-50 text-sky-800'
                              : 'border-emerald-300 bg-emerald-50 text-emerald-800'
                          }
                        >
                          {sale.saleType === 'ROOM' ? 'Room' : 'Walk-in'}
                        </Badge>
                      </td>
                      <td className="py-2.5 pr-4">
                        <p className="font-medium">
                          {sale.saleType === 'ROOM'
                            ? sale.room?.roomNumber
                              ? `Room ${sale.room.roomNumber}`
                              : '—'
                            : sale.customerName || 'Walk-in'}
                        </p>
                        {sale.items?.length ? (
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {sale.items.map((i) => `${i.quantity}× ${i.itemName}`).join(', ')}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-4 text-xs whitespace-nowrap">
                        {sale.saleType === 'WALK_IN'
                          ? formatPaymentMethod(sale.paymentMethod ?? 'CASH')
                          : 'Room folio'}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-semibold text-emerald-700 whitespace-nowrap">
                        {formatBdt(sale.totalAmount)}
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        {sale.saleType === 'WALK_IN' ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                            onClick={() => openHotelBeverageReceiptTab(sale.id)}
                          >
                            Receipt
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </ScrollArea>

        <div className="px-5 sm:px-6 py-3 border-t flex items-center justify-between shrink-0 bg-background">
          <p className="text-xs text-muted-foreground">
            Page {page} of {Math.max(1, totalPages)}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isLoading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
