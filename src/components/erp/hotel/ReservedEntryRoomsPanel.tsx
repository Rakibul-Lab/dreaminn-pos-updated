'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { CalendarRange, Search, Eye, FileText } from 'lucide-react'
import { api } from '@/lib/api-client'
import { useBusinessDate } from '@/hooks/use-business-date'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { StatusBadge } from '../shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { ReservationEntryDetailsDialog } from './ReservationEntryDetailsDialog'
import { useHotelTimes } from '@/hooks/use-hotel-times'
import { formatListBookingCheckIn, formatListBookingCheckOut } from '@/lib/hotel-times'
import {
  BOOKING_DATE_PRESET_OPTIONS,
  formatBookingDateFilterLabel,
  resolveBookingDateRangeWithBusinessDate,
  type BookingDatePreset,
} from '@/lib/booking-date-filter'
import type { ReservationEntryListRow } from '@/lib/reservation-entry'

type SummaryResponse = {
  success: boolean
  data?: {
    businessDate: string
    byType: Array<{
      roomTypeId: string
      roomTypeName: string
      totalQuantity: number
      entries: ReservationEntryListRow[]
    }>
  }
}

function buildSummaryQuery(input: {
  businessDate?: string
  datePreset: BookingDatePreset
  customDateFrom: string
  customDateTo: string
  search: string
}) {
  const params = new URLSearchParams({ summary: 'true' })
  if (input.businessDate) {
    params.set('businessDate', input.businessDate)
  }

  if (input.datePreset === 'today') {
    params.set('scope', 'business_day')
  } else {
    params.set('scope', 'all')
    const range = resolveBookingDateRangeWithBusinessDate(
      input.datePreset,
      input.customDateFrom,
      input.customDateTo,
      input.businessDate
    )
    if (range.dateFrom) params.set('dateFrom', range.dateFrom)
    if (range.dateTo) params.set('dateTo', range.dateTo)
  }

  if (input.search.trim()) {
    params.set('search', input.search.trim())
  }

  return `/reservation-entries?${params.toString()}`
}

export function ReservedEntryRoomsPanel() {
  const { data: businessDateRes } = useBusinessDate()
  const businessDate = businessDateRes?.data?.businessDate
  const { times } = useHotelTimes()

  const [datePreset, setDatePreset] = useState<BookingDatePreset>('today')
  const [customDateFrom, setCustomDateFrom] = useState('')
  const [customDateTo, setCustomDateTo] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [detailsEntryId, setDetailsEntryId] = useState<string | null>(null)
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const needsBusinessDate = datePreset === 'today' || datePreset === 'yesterday'
  const businessDateReady = !needsBusinessDate || !!businessDate

  const queryUrl = useMemo(
    () =>
      buildSummaryQuery({
        businessDate,
        datePreset,
        customDateFrom,
        customDateTo,
        search: searchQuery,
      }),
    [businessDate, datePreset, customDateFrom, customDateTo, searchQuery]
  )

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'reservation-entries-summary',
      businessDate,
      datePreset,
      customDateFrom,
      customDateTo,
      searchQuery,
    ],
    queryFn: () => api.get<SummaryResponse>(queryUrl),
    enabled: businessDateReady,
  })

  const byType = data?.data?.byType ?? []
  const totalBlocked = byType.reduce((sum, row) => sum + row.totalQuantity, 0)
  const totalEntries = byType.reduce((sum, row) => sum + row.entries.length, 0)

  const filterLabel = formatBookingDateFilterLabel(datePreset, customDateFrom, customDateTo)

  const openDetails = (entryId: string) => {
    setDetailsEntryId(entryId)
    setDetailsDialogOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search guest, phone, reg. no., room…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={datePreset}
          onValueChange={(v) => setDatePreset(v as BookingDatePreset)}
        >
          <SelectTrigger className="w-48">
            <CalendarRange className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
            <SelectValue placeholder="Date range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Business today</SelectItem>
            <SelectItem value="all">All time</SelectItem>
            {BOOKING_DATE_PRESET_OPTIONS.filter(
              (opt) => opt.value !== 'today' && opt.value !== 'all'
            ).map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {datePreset === 'custom' && (
          <>
            <div className="space-y-1">
              <Label htmlFor="re-date-from" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input
                id="re-date-from"
                type="date"
                value={customDateFrom}
                onChange={(e) => setCustomDateFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="re-date-to" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input
                id="re-date-to"
                type="date"
                value={customDateTo}
                min={customDateFrom || undefined}
                onChange={(e) => setCustomDateTo(e.target.value)}
                className="w-40"
              />
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Open business day</p>
            <p className="text-lg font-semibold">
              {businessDate
                ? format(parseISO(`${businessDate}T12:00:00`), 'dd MMM yyyy')
                : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Filter</p>
            <p className="text-sm font-medium">{filterLabel}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Categories blocked</p>
            <p className="text-2xl font-bold text-amber-700">{byType.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total rooms blocked</p>
            <p className="text-2xl font-bold text-amber-700">{totalBlocked}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {totalEntries} entr{totalEntries === 1 ? 'y' : 'ies'}
              {isFetching && !isLoading ? ' · updating…' : ''}
            </p>
          </CardContent>
        </Card>
      </div>

      {!businessDateReady || isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : byType.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No reservation entries match the current filters
            {searchQuery ? ` for “${searchQuery}”` : ''}
            {datePreset !== 'all' ? ` (${filterLabel})` : ''}.
          </CardContent>
        </Card>
      ) : (
        byType.map((group) => (
          <Card key={group.roomTypeId}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between gap-2">
                <span>{group.roomTypeName}</span>
                <span className="text-sm font-normal text-amber-700">
                  {group.totalQuantity} room{group.totalQuantity === 1 ? '' : 's'} blocked
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Guest</TableHead>
                    <TableHead>Reg. No.</TableHead>
                    <TableHead>Stay</TableHead>
                    <TableHead>Lines</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created by</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right w-[88px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        <div className="font-medium">{entry.guestName || '—'}</div>
                        <div className="text-muted-foreground">{entry.guestPhone || ''}</div>
                      </TableCell>
                      <TableCell className="text-xs font-mono whitespace-nowrap">
                        {entry.registrationNumber ?? entry.guestRegistrationNumber ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        <div>
                          {formatListBookingCheckIn(
                            { checkIn: entry.checkIn, status: 'RESERVED' },
                            times
                          )}
                        </div>
                        <div className="text-muted-foreground">
                          {formatListBookingCheckOut(
                            { checkOut: entry.checkOut, status: 'RESERVED' },
                            times
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{entry.lineSummary}</TableCell>
                      <TableCell>
                        <StatusBadge status={entry.status} className="text-xs" />
                      </TableCell>
                      <TableCell className="text-sm">{entry.creator.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                        {entry.notes || '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            title="View details"
                            onClick={() => openDetails(entry.id)}
                          >
                            <Eye className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 shrink-0 border-sky-500 text-sky-700 hover:bg-sky-50"
                            title="Reservation entry confirmation"
                            onClick={() =>
                              window.open(
                                `/reservation-entry/${entry.id}`,
                                '_blank',
                                'noopener,noreferrer'
                              )
                            }
                          >
                            <FileText className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}

      <ReservationEntryDetailsDialog
        entryId={detailsEntryId}
        open={detailsDialogOpen}
        onOpenChange={(open) => {
          setDetailsDialogOpen(open)
          if (!open) setDetailsEntryId(null)
        }}
      />
    </div>
  )
}
