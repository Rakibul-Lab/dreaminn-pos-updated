'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/lib/auth-store'
import { useToast } from '@/hooks/use-toast'
import {
  buildDepositsExportQuery,
  downloadDepositsPdf,
  type DepositExportRecord,
} from '@/lib/deposits-export'
import { formatBdt } from '@/lib/currency'
import {
  DEPOSIT_METHOD_OPTIONS,
  depositRequiresBank,
  depositRequiresLastFour,
  formatDepositMethodDetail,
  formatDepositMethodLabel,
  isValidAccountLastFour,
} from '@/lib/deposit-form'
import { BankSearchSelect } from './BankSearchSelect'
import {
  BOOKING_DATE_PRESET_OPTIONS,
  resolveBookingDateRange,
  type BookingDatePreset,
} from '@/lib/booking-date-filter'
import { getPaginationPages } from '@/lib/pagination-pages'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
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
  CalendarRange,
  FileDown,
  Landmark,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Wallet,
} from 'lucide-react'
import { useBusinessDate } from '@/hooks/use-business-date'

interface HotelDeposit {
  id: string
  amount: number
  method: string
  bankName: string | null
  accountLastFour: string | null
  reference: string | null
  notes: string | null
  depositedAt: string
  createdAt: string
  depositor: { id: string; name: string; role?: string }
}

const methodColors: Record<string, string> = {
  CASH: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  BANK: 'bg-blue-50 text-blue-700 border-blue-200',
  CARD: 'bg-sky-50 text-sky-700 border-sky-200',
  BKASH: 'bg-pink-50 text-pink-700 border-pink-200',
  NAGAD: 'bg-orange-50 text-orange-700 border-orange-200',
  UPAY: 'bg-indigo-50 text-indigo-700 border-indigo-200',
}

function defaultDepositForm() {
  return {
    amount: '',
    method: 'CASH',
    bankName: '',
    accountLastFour: '',
    reference: '',
    notes: '',
    depositedDate: format(new Date(), 'yyyy-MM-dd'),
    depositedTime: format(new Date(), 'HH:mm'),
  }
}

export default function DepositsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)

  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const [methodFilter, setMethodFilter] = useState('all')
  const [datePreset, setDatePreset] = useState<BookingDatePreset>('month')
  const [customDateFrom, setCustomDateFrom] = useState('')
  const [customDateTo, setCustomDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [form, setForm] = useState(defaultDepositForm)

  const { data: businessDateRes } = useBusinessDate()
  const businessDate = businessDateRes?.data?.businessDate

  const { data: todayCollectionsRes } = useQuery({
    queryKey: ['deposits-today-collections', businessDate],
    enabled: Boolean(businessDate),
    queryFn: () =>
      api.get<{
        success: boolean
        data: {
          summary?: {
            cashCollected?: number
            cardCollected?: number
            mBankingCollected?: number
            cashRemitted?: number
            cardRemitted?: number
            mBankingRemitted?: number
            cashOnHand?: number
            depositTotal?: number
            openingCash?: number
          }
        }
      }>(`/reports?type=hotel-daily-collections&businessDate=${encodeURIComponent(businessDate!)}`),
  })
  const todayCollections = todayCollectionsRes?.data?.summary

  const dateRange = useMemo(
    () => resolveBookingDateRange(datePreset, customDateFrom, customDateTo),
    [datePreset, customDateFrom, customDateTo]
  )

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: [
      'deposits',
      page,
      pageSize,
      methodFilter,
      search,
      datePreset,
      dateRange.dateFrom,
      dateRange.dateTo,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
      })
      if (methodFilter !== 'all') params.set('method', methodFilter)
      if (search.trim()) params.set('search', search.trim())
      if (dateRange.dateFrom) params.set('startDate', dateRange.dateFrom)
      if (dateRange.dateTo) params.set('endDate', dateRange.dateTo)
      return api.get<{
        success: boolean
        data: HotelDeposit[]
        meta: { total: number; sumAmount?: number }
      }>(`/deposits?${params.toString()}`)
    },
  })

  const deposits = data?.data ?? []
  const total = data?.meta?.total ?? 0
  const sumAmount = data?.meta?.sumAmount ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const paginationPages = getPaginationPages(page, totalPages)

  const createMutation = useMutation({
    mutationFn: (payload: {
      amount: number
      method: string
      bankName: string | null
      accountLastFour: string | null
      reference: string | null
      notes: string | null
      depositedAt: string
    }) => api.post('/deposits', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deposits'] })
      queryClient.invalidateQueries({ queryKey: ['deposits-today-collections'] })
      queryClient.invalidateQueries({ queryKey: ['business-day-collections'] })
      toast({ title: 'Deposit recorded', description: 'Money deposit has been saved.' })
      setShowAddDialog(false)
      setForm(defaultDepositForm())
    },
    onError: (err: Error) => {
      toast({
        title: 'Failed to record deposit',
        description: err?.message || 'Could not save deposit',
        variant: 'destructive',
      })
    },
  })

  const submitDeposit = () => {
    const amount = Number(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({
        title: 'Invalid amount',
        description: 'Enter a deposit amount greater than 0',
        variant: 'destructive',
      })
      return
    }
    const depositedAt = new Date(`${form.depositedDate}T${form.depositedTime}`)
    if (Number.isNaN(depositedAt.getTime())) {
      toast({
        title: 'Invalid date/time',
        description: 'Check the deposit date and time',
        variant: 'destructive',
      })
      return
    }
    if (depositRequiresBank(form.method) && !form.bankName.trim()) {
      toast({
        title: 'Bank required',
        description: 'Please search and select a bank',
        variant: 'destructive',
      })
      return
    }
    if (
      depositRequiresLastFour(form.method) &&
      !isValidAccountLastFour(form.accountLastFour)
    ) {
      toast({
        title: 'Last 4 digits required',
        description: 'Enter exactly 4 digits for card / bKash / Nagad / Upay',
        variant: 'destructive',
      })
      return
    }

    createMutation.mutate({
      amount,
      method: form.method,
      bankName: depositRequiresBank(form.method) ? form.bankName.trim() : null,
      accountLastFour: depositRequiresLastFour(form.method)
        ? form.accountLastFour.trim()
        : null,
      reference: form.reference.trim() || null,
      notes: form.notes.trim() || null,
      depositedAt: depositedAt.toISOString(),
    })
  }

  const handleMethodChange = (method: string) => {
    setForm((f) => ({
      ...f,
      method,
      bankName: '',
      accountLastFour: '',
    }))
  }

  const handleExportPdf = async () => {
    setExporting(true)
    try {
      const url = buildDepositsExportQuery({
        method: methodFilter,
        search: search.trim() || undefined,
        dateFrom: dateRange.dateFrom,
        dateTo: dateRange.dateTo,
      })
      const res = await api.get<{ success: boolean; data: DepositExportRecord[] }>(url)
      if (!res?.success || !res.data?.length) {
        toast({
          title: 'No deposits',
          description: 'No deposit records to export for the selected filters',
          variant: 'destructive',
        })
        return
      }
      await downloadDepositsPdf(res.data, {
        exportedAt: new Date(),
        generatedBy: user
          ? { name: user.name, email: user.email, role: user.role }
          : undefined,
        datePreset,
        customDateFrom,
        customDateTo,
        method: methodFilter,
        search: search.trim() || undefined,
      })
      toast({ title: 'Exported', description: 'Deposits PDF downloaded' })
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Could not export deposits',
        variant: 'destructive',
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Landmark className="h-7 w-7 text-amber-600" />
            Head Office
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Record money sent from the hotel to head office — cash, bank, bKash, etc. — with date, time, and receipt reference.
            Appears on the daily Collections report and Business Day reports.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
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
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('h-4 w-4 mr-2', isFetching && 'animate-spin')} />
            Refresh
          </Button>
          <Button
            size="sm"
            className="bg-amber-600 hover:bg-amber-700 text-white"
            onClick={() => setShowAddDialog(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Record transfer
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center">
              <Wallet className="h-5 w-5 text-emerald-700" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Cash collected (sales report)</p>
              <p className="text-2xl font-bold text-emerald-700">
                {formatBdt(todayCollections?.cashCollected ?? 0)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-sky-100 flex items-center justify-center">
              <Wallet className="h-5 w-5 text-sky-700" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Card collected (sales report)</p>
              <p className="text-2xl font-bold text-sky-700">
                {formatBdt(todayCollections?.cardCollected ?? 0)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-indigo-100 flex items-center justify-center">
              <Wallet className="h-5 w-5 text-indigo-700" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">M. banking collected (sales report)</p>
              <p className="text-2xl font-bold text-indigo-700">
                {formatBdt(todayCollections?.mBankingCollected ?? 0)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-sky-100 flex items-center justify-center">
              <Wallet className="h-5 w-5 text-sky-700" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Cash on hand</p>
              <p className="text-2xl font-bold text-sky-700">
                {formatBdt(todayCollections?.cashOnHand ?? 0)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Opening + Cash column − cash sent
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <Landmark className="h-5 w-5 text-amber-700" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Sent to HO today (total)</p>
              <p className="text-2xl font-bold text-amber-700">
                {formatBdt(todayCollections?.depositTotal ?? 0)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <Landmark className="h-5 w-5 text-amber-700" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Sent to HO (cash)</p>
              <p className="text-2xl font-bold text-amber-700">
                {formatBdt(todayCollections?.cashRemitted ?? 0)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <Landmark className="h-5 w-5 text-amber-700" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Sent to HO (card)</p>
              <p className="text-2xl font-bold text-amber-700">
                {formatBdt(todayCollections?.cardRemitted ?? 0)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <Landmark className="h-5 w-5 text-amber-700" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Sent to HO (m. banking)</p>
              <p className="text-2xl font-bold text-amber-700">
                {formatBdt(todayCollections?.mBankingRemitted ?? 0)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center">
              <Landmark className="h-5 w-5 text-slate-700" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total sent (filtered list)</p>
              <p className="text-2xl font-bold">{formatBdt(sumAmount)}</p>
              <p className="text-xs text-muted-foreground">{total} record(s)</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search receipt, notes, or recorded by…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
              />
            </div>
            <Select
              value={methodFilter}
              onValueChange={(v) => {
                setMethodFilter(v)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full lg:w-44">
                <SelectValue placeholder="Method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All methods</SelectItem>
                {DEPOSIT_METHOD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={datePreset}
              onValueChange={(v) => {
                setDatePreset(v as BookingDatePreset)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full lg:w-44">
                <CalendarRange className="h-4 w-4 mr-2 shrink-0" />
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
          </div>

          {datePreset === 'custom' && (
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">From</Label>
                <Input
                  type="date"
                  value={customDateFrom}
                  onChange={(e) => {
                    setCustomDateFrom(e.target.value)
                    setPage(1)
                  }}
                />
              </div>
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">To</Label>
                <Input
                  type="date"
                  value={customDateTo}
                  onChange={(e) => {
                    setCustomDateTo(e.target.value)
                    setPage(1)
                  }}
                />
              </div>
            </div>
          )}

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Bank / account</TableHead>
                  <TableHead>Receipt / ref.</TableHead>
                  <TableHead>Recorded by</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 8 }).map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : deposits.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                      No deposit records found for the selected filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  deposits.map((deposit) => {
                    const depositedAt = new Date(deposit.depositedAt)
                    return (
                      <TableRow key={deposit.id}>
                        <TableCell className="font-medium whitespace-nowrap">
                          {format(depositedAt, 'dd MMM yyyy')}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {format(depositedAt, 'hh:mm a')}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-amber-700">
                          {formatBdt(deposit.amount)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={methodColors[deposit.method] ?? ''}
                          >
                            {formatDepositMethodLabel(deposit.method)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDepositMethodDetail(
                            deposit.method,
                            deposit.bankName,
                            deposit.accountLastFour
                          ) || '—'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {deposit.reference || '—'}
                        </TableCell>
                        <TableCell className="text-sm">{deposit.depositor.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {deposit.notes || '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {total > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    setPageSize(Number(v))
                    setPage(1)
                  }}
                >
                  <SelectTrigger className="w-20 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 20, 50].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Prev
                </Button>
                {paginationPages.map((p, i) =>
                  p === '…' ? (
                    <span key={`ellipsis-${i}`} className="px-1 text-muted-foreground">
                      …
                    </span>
                  ) : (
                    <Button
                      key={p}
                      variant={page === p ? 'default' : 'outline'}
                      size="sm"
                      className="min-w-8"
                      onClick={() => setPage(p as number)}
                    >
                      {p}
                    </Button>
                  )
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={showAddDialog}
        onOpenChange={(open) => {
          setShowAddDialog(open)
          if (!open) setForm(defaultDepositForm())
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader className="pb-2">
            <DialogTitle>Send to head office</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-1">
            <div className="space-y-2">
              <Label htmlFor="deposit-amount" className="text-sm font-medium">
                Amount (BDT)
              </Label>
              <Input
                id="deposit-amount"
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                className="h-10"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Transfer method</Label>
              <Select value={form.method} onValueChange={handleMethodChange}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEPOSIT_METHOD_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {depositRequiresBank(form.method) && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Bank</Label>
                <BankSearchSelect
                  value={form.bankName}
                  onChange={(bankName) => setForm((f) => ({ ...f, bankName }))}
                />
              </div>
            )}

            {depositRequiresLastFour(form.method) && (
              <div className="space-y-2">
                <Label htmlFor="deposit-last-four" className="text-sm font-medium">
                  Last 4 digits <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="deposit-last-four"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="e.g. 4521"
                  className="h-10 tracking-widest"
                  value={form.accountLastFour}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      accountLastFour: e.target.value.replace(/\D/g, '').slice(0, 4),
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Required for {form.method === 'CARD' ? 'card' : form.method.toLowerCase()} deposits
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="deposit-date" className="text-sm font-medium">
                  Deposit date
                </Label>
                <Input
                  id="deposit-date"
                  type="date"
                  className="h-10"
                  value={form.depositedDate}
                  onChange={(e) => setForm((f) => ({ ...f, depositedDate: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="deposit-time" className="text-sm font-medium">
                  Deposit time
                </Label>
                <Input
                  id="deposit-time"
                  type="time"
                  className="h-10"
                  value={form.depositedTime}
                  onChange={(e) => setForm((f) => ({ ...f, depositedTime: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="deposit-reference" className="text-sm font-medium">
                Receipt / transaction no.{' '}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="deposit-reference"
                className="h-10"
                placeholder={
                  depositRequiresBank(form.method)
                    ? 'e.g. deposit slip number'
                    : 'e.g. transaction ID'
                }
                value={form.reference}
                onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="deposit-notes" className="text-sm font-medium">
                Notes{' '}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="deposit-notes"
                rows={2}
                className="resize-none"
                placeholder="Branch, account type, purpose…"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={createMutation.isPending}
              onClick={submitDeposit}
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save deposit'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
