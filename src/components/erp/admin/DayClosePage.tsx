'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { api } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'
import { useBusinessDate } from '@/hooks/use-business-date'
import type { DailySalesBalances } from '@/lib/daily-sales-balance'
import { BusinessDaySummarySection } from '@/components/erp/admin/BusinessDaySummarySection'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { CalendarClock, Lock, RefreshCw } from 'lucide-react'

type DayCloseStatus = {
  status: string
  businessDate: string
  openedAt: string
  suggestedOpeningBalance?: number
  carriedOpeningBalance?: number | null
  hasOpeningOverride?: boolean
  savedOpeningBalance?: number | null
  cashClosingBalancePreview?: number | null
}

type ReportResponse = {
  success: boolean
  data?: Record<string, unknown>
}

function buildReportUrl(type: string, businessDate: string): string {
  const params = new URLSearchParams({ type, businessDate })
  return `/reports?${params.toString()}`
}

function BalancePreview({ balances }: { balances: DailySalesBalances }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {[
        { label: 'Opening balance', value: balances.openingBalance },
        { label: "Today's sales", value: balances.salesTotal },
        { label: 'Grand total', value: balances.grandTotal },
        { label: 'Company bill', value: balances.companyBillTotal },
        { label: 'Closing balance', value: balances.closingBalance },
      ].map((row) => (
        <div key={row.label} className="rounded-md border bg-card p-3">
          <p className="text-xs text-muted-foreground">{row.label}</p>
          <p className="text-lg font-semibold mt-1">৳{row.value.toLocaleString()}</p>
        </div>
      ))}
    </div>
  )
}

export default function DayClosePage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [notes, setNotes] = useState('')
  const [openingBalance, setOpeningBalance] = useState('')
  const [openingLoaded, setOpeningLoaded] = useState(false)
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  const { data: bdRes } = useBusinessDate()

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['day-close-status'],
    queryFn: () =>
      api.get<{ success: boolean; data: DayCloseStatus }>('/day-close?limit=1'),
  })

  const status = data?.data
  const businessDate = status?.businessDate

  useEffect(() => {
    if (!status || openingLoaded) return
    const saved = status.savedOpeningBalance
    const suggested = status.suggestedOpeningBalance ?? status.carriedOpeningBalance ?? 0
    if (saved !== null && saved !== undefined) {
      setOpeningBalance(String(saved))
    } else if (suggested > 0) {
      setOpeningBalance(String(suggested))
    } else {
      setOpeningBalance('')
    }
    setOpeningLoaded(true)
  }, [status, openingLoaded])

  const openingValue =
    openingBalance.trim() === '' ? 0 : Math.max(0, Number(openingBalance) || 0)

  const { data: salesRes, isLoading: loadingSales, isFetching: fetchingSales } = useQuery({
    queryKey: ['day-close-sales-preview', businessDate],
    queryFn: () =>
      api.get<ReportResponse>(buildReportUrl('hotel-daily-sales', businessDate!)),
    enabled: Boolean(businessDate),
  })

  const { data: collectionsRes, isLoading: loadingCollections, isFetching: fetchingCollections } =
    useQuery({
      queryKey: ['day-close-collections-preview', businessDate],
      queryFn: () =>
        api.get<ReportResponse>(buildReportUrl('hotel-daily-collections', businessDate!)),
      enabled: Boolean(businessDate),
    })

  const { data: arrivalsRes, isLoading: loadingArrivals, isFetching: fetchingArrivals } =
    useQuery({
      queryKey: ['day-close-arrivals-preview', businessDate],
      queryFn: () =>
        api.get<ReportResponse>(buildReportUrl('hotel-daily-arrivals', businessDate!)),
      enabled: Boolean(businessDate),
    })

  const { data: departuresRes, isLoading: loadingDepartures, isFetching: fetchingDepartures } =
    useQuery({
      queryKey: ['day-close-departures-preview', businessDate],
      queryFn: () =>
        api.get<ReportResponse>(buildReportUrl('hotel-daily-departures', businessDate!)),
      enabled: Boolean(businessDate),
    })

  const salesData = salesRes?.data
  const salesBalances = salesData?.balances as DailySalesBalances | undefined
  const collectionsData = collectionsRes?.data

  const projectedBalances = useMemo((): DailySalesBalances | null => {
    if (!salesBalances) return null
    const salesTotal = salesBalances.salesTotal
    const companyBillTotal = salesBalances.companyBillTotal
    const grandTotal = openingValue + salesTotal
    return {
      openingBalance: openingValue,
      salesTotal,
      grandTotal,
      companyBillTotal,
      closingBalance: grandTotal - companyBillTotal,
    }
  }, [salesBalances, openingValue])

  const isLoadingSummary =
    isLoading || loadingSales || loadingCollections || loadingArrivals || loadingDepartures

  const isFetchingSummary =
    isFetching || fetchingSales || fetchingCollections || fetchingArrivals || fetchingDepartures

  const saveOpeningMutation = useMutation({
    mutationFn: async () => {
      const parsed = openingBalance.trim() === '' ? 0 : Math.max(0, Number(openingBalance) || 0)
      return api.patch<{ success?: boolean; message?: string }>('/day-close', {
        openingBalance: parsed,
      })
    },
    onSuccess: (res: { success?: boolean; message?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['day-close-status'] })
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      queryClient.invalidateQueries({ queryKey: ['business-day-sales'] })
      toast({
        title: 'Opening balance saved',
        description: res.message || 'Daily sales reports will use this opening balance.',
      })
    },
    onError: (err: Error) => {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' })
    },
  })

  const closeMutation = useMutation({
    mutationFn: async () => {
      const parsed =
        openingBalance.trim() === '' ? 0 : Math.max(0, Number(openingBalance) || 0)
      return api.post<{ success?: boolean; message?: string; data?: { nextBusinessDate?: string } }>(
        '/day-close',
        {
          notes: notes.trim() || null,
          openingBalance: parsed,
        }
      )
    },
    onSuccess: (res: { success?: boolean; message?: string; data?: { nextBusinessDate?: string } }) => {
      queryClient.invalidateQueries({ queryKey: ['day-close-status'] })
      queryClient.invalidateQueries({ queryKey: ['day-close-history'] })
      queryClient.invalidateQueries({ queryKey: ['business-date'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      toast({
        title: 'Business day closed',
        description: res.message || `Next business date: ${res.data?.nextBusinessDate}`,
      })
      setNotes('')
      setOpeningBalance('')
      setOpeningLoaded(false)
      setConfirmCloseOpen(false)
    },
    onError: (err: Error) => {
      toast({ title: 'Day close failed', description: err.message, variant: 'destructive' })
      setConfirmCloseOpen(false)
    },
  })

  const calendarDate = bdRes?.data?.calendarDate
  const openedLabel = status?.openedAt
    ? format(parseISO(status.openedAt), 'MMM dd, yyyy · h:mm a')
    : '—'

  const refreshAll = () => {
    refetch()
    queryClient.invalidateQueries({ queryKey: ['day-close-sales-preview', businessDate] })
    queryClient.invalidateQueries({ queryKey: ['day-close-collections-preview', businessDate] })
    queryClient.invalidateQueries({ queryKey: ['day-close-arrivals-preview', businessDate] })
    queryClient.invalidateQueries({ queryKey: ['day-close-departures-preview', businessDate] })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Lock className="h-6 w-6 text-amber-600" />
            Day Close
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Close the current business day and advance the hotel operating date.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll} disabled={isFetchingSummary}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetchingSummary ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Card className="border-amber-200 bg-amber-50/40">
        <CardContent className="p-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-amber-700" />
            <span className="text-sm text-muted-foreground">Current business date</span>
            <Badge className="bg-amber-600 text-white text-base px-3 py-1">
              {businessDate || bdRes?.data?.businessDate || '…'}
            </Badge>
          </div>
          {calendarDate && calendarDate !== businessDate && (
            <span className="text-xs text-muted-foreground">
              Calendar today: {calendarDate}
            </span>
          )}
          <span className="text-xs text-muted-foreground">Opened: {openedLabel}</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open day summary (before close)</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && !businessDate ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <BusinessDaySummarySection
              isLoading={isLoadingSummary}
              salesBalances={projectedBalances ?? salesBalances ?? null}
              grandTotal={(salesData?.grandTotal as number | undefined) ?? 0}
              hotel={salesData?.hotel as Record<string, number> | undefined}
              restaurant={salesData?.restaurant as { grossSales?: number; discount?: number } | undefined}
              totalDiscount={(salesData?.totalDiscount as number | undefined) ?? undefined}
              collectionsSummary={collectionsData?.summary as Record<string, number> | undefined}
              collectionsByMethod={
                (collectionsData?.byMethod as Array<{ method: string; amount: number }>) ?? []
              }
              guestMovement={{
                actualCheckIns: arrivalsRes?.data?.actualCheckIns as number | undefined,
                expectedArrivals: arrivalsRes?.data?.expectedArrivals as number | undefined,
                totalListed: arrivalsRes?.data?.totalListed as number | undefined,
                actualCheckOuts: departuresRes?.data?.actualCheckOuts as number | undefined,
              }}
              openingBalanceOverride={openingValue}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Close business day</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Closing locks this business day&apos;s totals and moves operations to the next date.
            Actual transaction timestamps are preserved for audit.
          </p>
          <div className="space-y-2 max-w-md">
            <Label htmlFor="day-close-opening">Opening cash (drawer)</Label>
            <div className="flex gap-2">
              <Input
                id="day-close-opening"
                type="number"
                min={0}
                step="0.01"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                placeholder={
                  status?.carriedOpeningBalance
                    ? String(status.carriedOpeningBalance)
                    : '0'
                }
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                disabled={saveOpeningMutation.isPending}
                onClick={() => saveOpeningMutation.mutate()}
              >
                {saveOpeningMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {status?.carriedOpeningBalance
                ? `Carried from previous day close: ৳${status.carriedOpeningBalance.toLocaleString()} (cash on hand). Adjust after physical count if needed.`
                : 'First day or no prior close — enter cash in drawer at shift start, then Save.'}
            </p>
            {status?.cashClosingBalancePreview != null ? (
              <p className="text-xs text-sky-700">
                If you close now, cash on hand (tomorrow&apos;s opening) will be ৳
                {status.cashClosingBalancePreview.toLocaleString()} — based on current opening,
                collections, and head-office transfers.
              </p>
            ) : null}
          </div>
          {projectedBalances && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Projected daily sales balances</p>
              <BalancePreview balances={projectedBalances} />
            </div>
          )}
          <div className="space-y-2 max-w-md">
            <Label htmlFor="day-close-notes">Notes (optional)</Label>
            <Input
              id="day-close-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Shift handover notes"
            />
          </div>
          <Button
            className="bg-amber-600 hover:bg-amber-700 text-white"
            disabled={closeMutation.isPending}
            onClick={() => setConfirmCloseOpen(true)}
          >
            {closeMutation.isPending ? 'Closing…' : `Close business day ${businessDate || ''}`}
          </Button>
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmCloseOpen}
        onOpenChange={(open) => {
          if (!closeMutation.isPending) setConfirmCloseOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close business day {businessDate || ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to close the day? The daily sales report will be locked
              as it stands now and cannot be reopened.
              {status?.cashClosingBalancePreview != null
                ? ` Cash on hand carried to the next day: ৳${status.cashClosingBalancePreview.toLocaleString()}.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closeMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={closeMutation.isPending}
              onClick={(event) => {
                event.preventDefault()
                closeMutation.mutate()
              }}
            >
              {closeMutation.isPending ? 'Closing…' : 'Yes, close the day'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
