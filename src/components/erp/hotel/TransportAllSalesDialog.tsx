'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Search } from 'lucide-react'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatBdt } from '@/lib/currency'
import { openTransportInvoiceTab } from '@/lib/transport-invoice-navigation'

type TransportSaleRow = {
  id: string
  saleNumber: string
  saleType: 'WALK_IN' | 'ROOM'
  customerName: string
  customerPhone: string | null
  routeFrom: string | null
  routeTo: string | null
  roomNumber?: string | null
  totalAmount: number
  createdAt: string
  room?: { roomNumber: string } | null
  invoice?: { id: string; invoiceNumber: string; status: string } | null
}

type TransportAllSalesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TransportAllSalesDialog({ open, onOpenChange }: TransportAllSalesDialogProps) {
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['transport-sales-all', search, dateFrom, dateTo],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '100' })
      if (search.trim()) params.set('search', search.trim())
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      return api.get<{
        success: boolean
        data: TransportSaleRow[]
        meta?: { totalAmount?: number; total?: number }
      }>(`/transport-sales?${params.toString()}`)
    },
    enabled: open,
  })

  const sales = data?.data ?? []
  const totalAmount = data?.meta?.totalAmount ?? 0
  const totalCount = data?.meta?.total ?? sales.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="shrink-0 border-b px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
          <DialogTitle>All transport sales</DialogTitle>
        </DialogHeader>

        <div className="shrink-0 space-y-3 border-b bg-muted/30 px-5 py-4 sm:px-6">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
            <div className="relative min-w-0 md:col-span-6">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search guest, sale or invoice no."
                className="h-9 bg-background pl-9"
              />
            </div>
            <div className="md:col-span-3">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 bg-background"
              />
            </div>
            <div className="md:col-span-3">
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                min={dateFrom || undefined}
                className="h-9 bg-background"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{totalCount}</span> sale
            {totalCount === 1 ? '' : 's'}
            {totalAmount > 0 ? (
              <>
                {' '}
                · <span className="font-semibold text-foreground">{formatBdt(totalAmount)}</span> total
              </>
            ) : null}
            {isFetching && !isLoading ? ' · Updating…' : ''}
          </p>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="overflow-x-auto px-5 py-2 sm:px-6">
            {isLoading ? (
              <div className="space-y-2 py-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : sales.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No transport sales found
              </p>
            ) : (
              <table className="w-full min-w-[760px] text-sm">
                <thead className="sticky top-0 z-10 bg-background">
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium whitespace-nowrap">Date</th>
                    <th className="min-w-[140px] py-2 pr-4 font-medium">Guest</th>
                    <th className="py-2 pr-4 font-medium whitespace-nowrap">Sale #</th>
                    <th className="py-2 pr-4 font-medium whitespace-nowrap">Invoice #</th>
                    <th className="max-w-[180px] py-2 pr-4 font-medium">Route</th>
                    <th className="py-2 pr-4 text-right font-medium whitespace-nowrap">Amount</th>
                    <th className="w-[88px] py-2 text-right font-medium whitespace-nowrap">Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => {
                    const roomLabel = sale.roomNumber ?? sale.room?.roomNumber
                    const route =
                      [sale.routeFrom, sale.routeTo].filter(Boolean).join(' → ') || '—'

                    return (
                      <tr key={sale.id} className="border-b align-top last:border-0 hover:bg-muted/30">
                        <td className="py-2.5 pr-4 text-xs whitespace-nowrap">
                          {format(new Date(sale.createdAt), 'dd MMM yyyy')}
                        </td>
                        <td className="py-2.5 pr-4">
                          <p className="font-medium">{sale.customerName}</p>
                          {roomLabel ? (
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              Room {roomLabel}
                            </p>
                          ) : sale.customerPhone ? (
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {sale.customerPhone}
                            </p>
                          ) : null}
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-xs whitespace-nowrap">
                          {sale.saleNumber}
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-xs whitespace-nowrap">
                          {sale.invoice?.invoiceNumber ?? '—'}
                        </td>
                        <td className="max-w-[180px] py-2.5 pr-4 text-xs text-muted-foreground">
                          <span className="line-clamp-2 break-words">{route}</span>
                        </td>
                        <td className="py-2.5 pr-4 text-right font-medium whitespace-nowrap">
                          {formatBdt(sale.totalAmount)}
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => openTransportInvoiceTab(sale.id, false)}
                          >
                            View
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </ScrollArea>

        <div className="flex shrink-0 justify-end border-t px-5 py-3 text-sm font-semibold sm:px-6">
          Total: {formatBdt(totalAmount)}
        </div>
      </DialogContent>
    </Dialog>
  )
}
