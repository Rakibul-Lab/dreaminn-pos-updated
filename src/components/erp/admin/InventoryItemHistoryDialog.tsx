'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  FileDown,
  History,
  Loader2,
  Trash2,
} from 'lucide-react'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/lib/auth-store'
import { useToast } from '@/hooks/use-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  downloadInventoryHistoryExcel,
  downloadInventoryHistoryPdf,
  type InventoryHistoryExportRow,
} from '@/lib/inventory-history-export'

type HistoryItem = {
  id: string
  name: string
  category: string | null
  unit: string
  quantity: number
  minQuantity: number
  costPerUnit: number | null
  supplier: string | null
}

type HistoryPayload = {
  item: HistoryItem
  history: InventoryHistoryExportRow[]
  summary: {
    stockIn: number
    stockOut: number
    waste: number
    movementCount: number
  }
}

type InventoryItemHistoryDialogProps = {
  itemId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function typeMeta(type: string) {
  if (type === 'in') {
    return {
      label: 'Stock In',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      icon: ArrowUpCircle,
    }
  }
  if (type === 'out') {
    return {
      label: 'Stock Out',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
      icon: ArrowDownCircle,
    }
  }
  return {
    label: 'Waste',
    className: 'border-rose-200 bg-rose-50 text-rose-700',
    icon: Trash2,
  }
}

export function InventoryItemHistoryDialog({
  itemId,
  open,
  onOpenChange,
}: InventoryItemHistoryDialogProps) {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['inventory-history', itemId, dateFrom, dateTo, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '2000' })
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      if (typeFilter !== 'all') params.set('type', typeFilter)
      return api.get<{ success: boolean; data: HistoryPayload }>(
        `/inventory/${itemId}/history?${params.toString()}`
      )
    },
    enabled: open && !!itemId,
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: false,
  })

  const payload = data?.data
  const rows = payload?.history ?? []
  const item = payload?.item
  const summary = payload?.summary
  // Item metadata (name/category) is stable across filter changes — avoid badge remount flicker.
  const itemCategory = item?.category?.trim() || null

  const exportMeta = useMemo(
    () => ({
      itemName: item?.name || 'Item',
      category: item?.category,
      unit: item?.unit,
      currentQuantity: item?.quantity,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      typeFilter,
      exportedAt: new Date(),
      generatedBy: user
        ? { name: user.name, email: user.email, role: user.role }
        : undefined,
    }),
    [item, dateFrom, dateTo, typeFilter, user]
  )

  const handleExportExcel = async () => {
    if (!rows.length) {
      toast({
        title: 'Nothing to export',
        description: 'No history rows match the current filters.',
        variant: 'destructive',
      })
      return
    }
    setExporting('excel')
    try {
      await downloadInventoryHistoryExcel(rows, exportMeta)
      toast({ title: 'Export complete', description: `Exported ${rows.length} movement(s) to Excel` })
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Could not export history',
        variant: 'destructive',
      })
    } finally {
      setExporting(null)
    }
  }

  const handleExportPdf = async () => {
    if (!rows.length) {
      toast({
        title: 'Nothing to export',
        description: 'No history rows match the current filters.',
        variant: 'destructive',
      })
      return
    }
    setExporting('pdf')
    try {
      await downloadInventoryHistoryPdf(rows, exportMeta)
      toast({ title: 'Export complete', description: `Exported ${rows.length} movement(s) to PDF` })
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Could not export history',
        variant: 'destructive',
      })
    } finally {
      setExporting(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setDateFrom('')
          setDateTo('')
          setTypeFilter('all')
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b bg-gradient-to-br from-amber-50 via-orange-50/70 to-stone-50 px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-200 bg-white/80 shadow-sm">
              <History className="h-5 w-5 text-amber-700" />
            </div>
            <div className="min-w-0 space-y-1">
              <DialogTitle className="truncate text-lg text-stone-900">
                {item?.name || 'Product history'}
              </DialogTitle>
              <DialogDescription className="text-stone-600">
                Stock movements with date filters and export options
                {item ? ` · Current stock: ${item.quantity} ${item.unit}` : ''}
              </DialogDescription>
            </div>
            {isFetching && !isLoading ? (
              <Loader2 className="ml-auto h-4 w-4 shrink-0 animate-spin text-amber-600/70" aria-hidden />
            ) : null}
          </div>
        </DialogHeader>

        <div className="shrink-0 space-y-3 border-b bg-muted/30 px-5 py-4 sm:px-6">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
            <div className="space-y-1 md:col-span-3">
              <Label className="text-xs text-muted-foreground">From date</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 bg-background"
              />
            </div>
            <div className="space-y-1 md:col-span-3">
              <Label className="text-xs text-muted-foreground">To date</Label>
              <Input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 bg-background"
              />
            </div>
            <div className="space-y-1 md:col-span-3">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-9 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="in">Stock In</SelectItem>
                  <SelectItem value="out">Stock Out</SelectItem>
                  <SelectItem value="waste">Waste</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 md:col-span-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 flex-1"
                disabled={!!exporting || isLoading || rows.length === 0}
                onClick={() => void handleExportExcel()}
              >
                {exporting === 'excel' ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileDown className="mr-1.5 h-3.5 w-3.5" />
                )}
                Excel
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 flex-1"
                disabled={!!exporting || isLoading || rows.length === 0}
                onClick={() => void handleExportPdf()}
              >
                {exporting === 'pdf' ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileDown className="mr-1.5 h-3.5 w-3.5" />
                )}
                PDF
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
              In: {summary?.stockIn ?? 0}
            </Badge>
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
              Out: {summary?.stockOut ?? 0}
            </Badge>
            <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
              Waste: {summary?.waste ?? 0}
            </Badge>
            <Badge variant="outline">
              {summary?.movementCount ?? 0} movement
              {(summary?.movementCount ?? 0) === 1 ? '' : 's'}
            </Badge>
            {itemCategory ? (
              <Badge variant="outline" className="border-stone-200 bg-stone-50 text-stone-700">
                {itemCategory}
              </Badge>
            ) : null}
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="px-5 py-3 sm:px-6">
            {isLoading ? (
              <div className="space-y-2 py-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No stock history found for this item and date range.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Recorded by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const meta = typeMeta(row.type)
                    const Icon = meta.icon
                    return (
                      <TableRow key={row.id} className="align-top">
                        <TableCell className="whitespace-nowrap text-xs">
                          {format(new Date(row.createdAt), 'dd MMM yyyy')}
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {format(new Date(row.createdAt), 'hh:mm a')}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('gap-1', meta.className)}>
                            <Icon className="h-3 w-3" />
                            {meta.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {row.type === 'in' ? '+' : '-'}
                          {row.quantity}
                          {item?.unit ? (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              {item.unit}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="max-w-[240px] text-sm text-muted-foreground">
                          <span className="line-clamp-2 break-words">
                            {row.notes?.trim() || '—'}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.createdByName || '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
