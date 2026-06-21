'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { Loader2, Scale } from 'lucide-react'
import { formatBdt } from '@/lib/currency'
import { computeRoomBookingTotals } from '@/lib/booking-totals'
import { countHotelStayNights } from '@/lib/hotel-times'
import { getRoomNightlyTotal } from '@/lib/room-pricing'
import {
  buildRoomsAvailabilityQueryUrl,
  type RoomsAvailabilityResponse,
} from '@/lib/rooms-availability-query'

type EntryLine = {
  id: string
  roomTypeId: string
  roomTypeName: string
  roomId: string | null
  roomNumber: string | null
  quantity: number
  unfulfilledCount: number
}

type EntryDetail = {
  id: string
  guestName: string | null
  guestPhone: string | null
  confirmationNumber?: string | null
  checkIn: string
  checkOut: string
  entryStatus: string
  unfulfilledRooms: number
  totalRooms: number
  totalAmount: number
  advancePayment: number
  dueAmount: number
  discountEnabled: boolean
  discountType: string | null
  discountValue: number
  lines: EntryLine[]
}

type RoomOption = {
  id: string
  roomNumber: string
  typeId: string
  totalPrice: number
  type: { name: string }
}

type ConvertSlot = {
  key: string
  lineId: string
  lineIndex: number
  roomTypeId: string
  roomTypeName: string
  presetRoomNumber: string | null
  roomId: string
}

type SlotFinancials = ConvertSlot & {
  roomNumber: string
  roomCharge: number
  discountAmount: number
  totalWithVat: number
  advance: number
  due: number
}

type Props = {
  entryId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConverted?: () => void
}

function slotKey(lineId: string, index: number) {
  return `${lineId}:${index}`
}

function proportionalAdvances(
  slots: Array<{ key: string; totalWithVat: number }>,
  pool: number
): Record<string, string> {
  const total = slots.reduce((sum, slot) => sum + slot.totalWithVat, 0)
  const result: Record<string, string> = {}
  let assigned = 0

  slots.forEach((slot, index) => {
    if (index === slots.length - 1) {
      result[slot.key] = Math.max(0, pool - assigned).toFixed(2)
      return
    }
    const share = total > 0 ? (slot.totalWithVat / total) * pool : pool / slots.length
    const rounded = Math.round(share * 100) / 100
    assigned += rounded
    result[slot.key] = rounded.toFixed(2)
  })

  return result
}

function formatDiscountSummary(entry: EntryDetail): string | null {
  if (!entry.discountEnabled) return null
  if (entry.discountType === 'FIXED') {
    return `${formatBdt(entry.discountValue)} per room`
  }
  return `${entry.discountValue}% per room`
}

export function ReservationEntryConvertDialog({
  entryId,
  open,
  onOpenChange,
  onConverted,
}: Props) {
  const queryClient = useQueryClient()
  const [checkInNow, setCheckInNow] = useState(false)
  const [roomAssignments, setRoomAssignments] = useState<Record<string, string[]>>({})
  const [advanceBySlot, setAdvanceBySlot] = useState<Record<string, string>>({})
  const [advanceManual, setAdvanceManual] = useState(false)

  const { data: entryRes, isLoading: entryLoading } = useQuery({
    queryKey: ['reservation-entry', entryId],
    queryFn: () =>
      api.get<{ success: boolean; data: EntryDetail }>(`/reservation-entries/${entryId}`),
    enabled: open && !!entryId,
  })

  const entry = entryRes?.data

  const checkInDate = entry?.checkIn?.slice(0, 10) ?? ''
  const checkOutDate = entry?.checkOut?.slice(0, 10) ?? ''

  const nights = useMemo(() => {
    if (!checkInDate || !checkOutDate) return 1
    return Math.max(
      1,
      countHotelStayNights(
        new Date(`${checkInDate}T12:00:00`),
        new Date(`${checkOutDate}T12:00:00`)
      )
    )
  }, [checkInDate, checkOutDate])

  const { data: roomsRes, isLoading: roomsLoading } = useQuery({
    queryKey: ['rooms-for-entry-convert', entryId, checkInDate, checkOutDate],
    queryFn: () =>
      api.get<RoomsAvailabilityResponse<RoomOption>>(
        buildRoomsAvailabilityQueryUrl({
          checkIn: checkInDate,
          checkOut: checkOutDate,
          forReservationEntry: true,
          excludeEntryId: entryId!,
        })
      ),
    enabled: open && !!entryId && !!checkInDate && !!checkOutDate,
  })

  const rooms = roomsRes?.data ?? []
  const roomById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms])

  const unfulfilledLines = useMemo(
    () => (entry?.lines ?? []).filter((line) => line.unfulfilledCount > 0),
    [entry?.lines]
  )

  useEffect(() => {
    if (!open || !entry) return
    const next: Record<string, string[]> = {}
    for (const line of unfulfilledLines) {
      if (line.roomId && line.unfulfilledCount === 1) {
        next[line.id] = [line.roomId]
      } else {
        next[line.id] = Array.from({ length: line.unfulfilledCount }, () => '')
      }
    }
    setRoomAssignments(next)
    setAdvanceBySlot({})
    setAdvanceManual(false)
    setCheckInNow(false)
  }, [open, entry?.id, unfulfilledLines])

  const convertSlots = useMemo((): ConvertSlot[] => {
    const slots: ConvertSlot[] = []
    for (const line of unfulfilledLines) {
      const picks = roomAssignments[line.id] ?? []
      picks.forEach((roomId, index) => {
        slots.push({
          key: slotKey(line.id, index),
          lineId: line.id,
          lineIndex: index,
          roomTypeId: line.roomTypeId,
          roomTypeName: line.roomTypeName,
          presetRoomNumber:
            line.roomId && line.unfulfilledCount === 1 ? line.roomNumber : null,
          roomId,
        })
      })
    }
    return slots
  }, [unfulfilledLines, roomAssignments])

  const discountOptions = useMemo(
    () =>
      entry
        ? {
            discountEnabled: entry.discountEnabled,
            discountType: entry.discountType === 'FIXED' ? ('FIXED' as const) : ('PERCENTAGE' as const),
            discountValue: entry.discountValue,
          }
        : undefined,
    [entry]
  )

  const slotFinancials = useMemo((): SlotFinancials[] => {
    if (!entry) return []
    return convertSlots.map((slot) => {
      const room = slot.roomId ? roomById.get(slot.roomId) : undefined
      const roomCharge = room ? getRoomNightlyTotal(room) * nights : 0
      const advance = Math.max(0, parseFloat(advanceBySlot[slot.key] ?? '0') || 0)
      const totals = computeRoomBookingTotals(
        roomCharge,
        advance,
        { vatApplied: false, vatPercent: 15 },
        discountOptions
      )
      return {
        ...slot,
        roomNumber: room?.roomNumber ?? slot.presetRoomNumber ?? '—',
        roomCharge,
        discountAmount: totals.discountAmount,
        totalWithVat: totals.totalWithVat,
        advance,
        due: totals.dueAmount,
      }
    })
  }, [convertSlots, roomById, nights, advanceBySlot, entry, discountOptions])

  const assignedSlots = slotFinancials.filter((slot) => Boolean(slot.roomId))

  const assignmentSignature = assignedSlots
    .map((s) => `${s.key}:${s.roomId}:${s.totalWithVat}`)
    .join('|')

  useEffect(() => {
    if (!entry || advanceManual || assignedSlots.length === 0) return
    const withTotals = assignedSlots.filter((slot) => slot.roomId && slot.totalWithVat > 0)
    if (!withTotals.length) return
    setAdvanceBySlot(
      proportionalAdvances(
        withTotals.map((slot) => ({ key: slot.key, totalWithVat: slot.totalWithVat })),
        entry.advancePayment
      )
    )
  }, [entry?.advancePayment, assignmentSignature, advanceManual, entry, assignedSlots.length])

  const summary = useMemo(() => {
    const roomCharges = assignedSlots.reduce((sum, slot) => sum + slot.roomCharge, 0)
    const discountTotal = assignedSlots.reduce((sum, slot) => sum + slot.discountAmount, 0)
    const grandTotal = assignedSlots.reduce((sum, slot) => sum + slot.totalWithVat, 0)
    const allocatedAdvance = assignedSlots.reduce((sum, slot) => sum + slot.advance, 0)
    const balanceDue = assignedSlots.reduce((sum, slot) => sum + slot.due, 0)
    const advancePool = entry?.advancePayment ?? 0
    const unallocatedAdvance = Math.max(0, advancePool - allocatedAdvance)
    return {
      roomCharges,
      discountTotal,
      grandTotal,
      allocatedAdvance,
      balanceDue,
      advancePool,
      unallocatedAdvance,
    }
  }, [assignedSlots, entry?.advancePayment])

  const convertMutation = useMutation({
    mutationFn: () => {
      const assignments = unfulfilledLines.map((line) => {
        const roomIds = (roomAssignments[line.id] ?? []).filter(Boolean)
        const advanceShares = (roomAssignments[line.id] ?? []).map((_, index) => {
          const key = slotKey(line.id, index)
          return Math.max(0, parseFloat(advanceBySlot[key] ?? '0') || 0)
        })
        return { lineId: line.id, roomIds, advanceShares }
      })
      return api.post(`/reservation-entries/${entryId}`, {
        action: 'convert',
        checkInNow,
        assignments,
      })
    },
    onSuccess: (res: {
      success?: boolean
      error?: string
      message?: string
      data?: { bookings?: Array<{ confirmationNumber?: string | null; roomNumber: string }> }
    }) => {
      if (!res?.success) {
        toast.error(res?.error || res?.message || 'Failed to convert reservation entry')
        return
      }
      queryClient.invalidateQueries({ queryKey: ['bookings'] })
      queryClient.invalidateQueries({ queryKey: ['reservation-entries'] })
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
      const count = res.data?.bookings?.length ?? 0
      toast.success(
        count > 0
          ? `Created ${count} booking${count === 1 ? '' : 's'} from reservation entry`
          : 'Reservation entry converted'
      )
      onOpenChange(false)
      onConverted?.()
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to convert reservation entry')
    },
  })

  const roomsForLine = (line: EntryLine, slotIndex: number, currentRoomId: string) => {
    const pickedElsewhere = new Set<string>()
    for (const [lineId, picks] of Object.entries(roomAssignments)) {
      for (const [index, roomId] of picks.entries()) {
        if (!roomId) continue
        if (lineId === line.id && index === slotIndex) continue
        pickedElsewhere.add(roomId)
      }
    }
    return rooms.filter(
      (room) =>
        room.typeId === line.roomTypeId &&
        (!pickedElsewhere.has(room.id) || room.id === currentRoomId)
    )
  }

  const allRoomsAssigned =
    unfulfilledLines.length > 0 &&
    unfulfilledLines.every((line) => {
      const picks = roomAssignments[line.id] ?? []
      if (picks.length !== line.unfulfilledCount) return false
      if (picks.some((id) => !id)) return false
      return new Set(picks).size === picks.length
    })

  const advanceOverAllocated = summary.allocatedAdvance - summary.advancePool > 0.009

  const canSubmit = allRoomsAssigned && !advanceOverAllocated && assignedSlots.length > 0

  const handleDistributeAdvance = () => {
    if (!entry || assignedSlots.length === 0) return
    setAdvanceBySlot(
      proportionalAdvances(
        assignedSlots.map((slot) => ({ key: slot.key, totalWithVat: slot.totalWithVat })),
        entry.advancePayment
      )
    )
    setAdvanceManual(false)
  }

  const handleAdvanceChange = (key: string, value: string) => {
    setAdvanceManual(true)
    setAdvanceBySlot((prev) => ({ ...prev, [key]: value }))
  }

  const discountSummary = entry ? formatDiscountSummary(entry) : null
  const showMultiRoomNote = (entry?.totalRooms ?? 0) > 1

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b px-6 py-5 pr-14">
          <DialogTitle className="text-xl font-semibold tracking-tight">
            Convert reservation entry to bookings
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {entryLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading entry…
          </div>
        ) : !entry ? (
          <p className="text-sm text-muted-foreground py-4">Reservation entry not found.</p>
        ) : entry.unfulfilledRooms <= 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            All rooms on this entry are already converted.
          </p>
        ) : (
          <div className="space-y-6">
            <div className="rounded-xl border bg-gradient-to-br from-muted/40 to-muted/10 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <p className="text-lg font-semibold leading-tight">{entry.guestName || 'Guest'}</p>
                  <p className="text-sm text-muted-foreground">
                    {checkInDate} → {checkOutDate}
                    <span className="mx-2 text-border">|</span>
                    {nights} night{nights === 1 ? '' : 's'}
                    <span className="mx-2 text-border">|</span>
                    {entry.unfulfilledRooms} room{entry.unfulfilledRooms === 1 ? '' : 's'} to convert
                  </p>
                </div>
                {entry.confirmationNumber ? (
                  <div className="shrink-0 rounded-lg border bg-background px-3 py-2 text-center shadow-sm">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                      Confirmation
                    </p>
                    <p className="font-mono text-sm font-semibold text-foreground mt-0.5">
                      {entry.confirmationNumber}
                    </p>
                  </div>
                ) : null}
              </div>
              {showMultiRoomNote ? (
                <p className="text-xs text-amber-900 mt-4 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2.5 leading-relaxed">
                  Each room becomes its own booking with a separate guest profile and registration
                  number. All bookings keep the entry confirmation number above.
                </p>
              ) : null}
            </div>

            <Card className="border-slate-200/80 shadow-sm overflow-hidden">
              <CardContent className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-slate-50/80 px-5 py-3.5">
                  <p className="text-sm font-semibold text-slate-900">Financial summary</p>
                  {discountSummary ? (
                    <span className="text-xs rounded-full bg-violet-100 text-violet-800 px-3 py-1 font-medium">
                      Discount: {discountSummary}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap divide-y sm:divide-y-0 sm:divide-x divide-border">
                  <SummaryStat label="Room charges" value={formatBdt(summary.roomCharges)} className="flex-1 min-w-[9.5rem]" />
                  {entry.discountEnabled ? (
                    <SummaryStat
                      label="Discount"
                      value={`−${formatBdt(summary.discountTotal)}`}
                      valueClassName="text-violet-700"
                      className="flex-1 min-w-[9.5rem]"
                    />
                  ) : null}
                  <SummaryStat
                    label="Total (incl. VAT)"
                    value={formatBdt(summary.grandTotal)}
                    valueClassName="font-semibold"
                    className="flex-1 min-w-[9.5rem]"
                  />
                  <SummaryStat
                    label="Advance pool"
                    value={formatBdt(summary.advancePool)}
                    valueClassName="text-emerald-700 font-semibold"
                    className="flex-1 min-w-[9.5rem]"
                  />
                  <SummaryStat
                    label="Allocated advance"
                    value={formatBdt(summary.allocatedAdvance)}
                    valueClassName={
                      advanceOverAllocated
                        ? 'text-red-600 font-semibold'
                        : 'text-emerald-700 font-semibold'
                    }
                    className="flex-1 min-w-[9.5rem]"
                  />
                  <SummaryStat
                    label="Balance due"
                    value={formatBdt(summary.balanceDue)}
                    valueClassName="text-amber-800 font-semibold"
                    className="flex-1 min-w-[9.5rem]"
                  />
                </div>
                {(summary.unallocatedAdvance > 0.009 && !advanceOverAllocated) || advanceOverAllocated ? (
                  <div className="border-t px-5 py-3 bg-muted/20">
                    {summary.unallocatedAdvance > 0.009 && !advanceOverAllocated ? (
                      <p className="text-xs text-muted-foreground">
                        {formatBdt(summary.unallocatedAdvance)} advance remains unallocated on the
                        entry after convert.
                      </p>
                    ) : null}
                    {advanceOverAllocated ? (
                      <p className="text-xs text-red-600 font-medium">
                        Allocated advance exceeds the available pool by{' '}
                        {formatBdt(summary.allocatedAdvance - summary.advancePool)}.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Label className="text-sm font-semibold">Room assignment & payment split</Label>
                {assignedSlots.length > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 gap-2 shrink-0"
                    onClick={handleDistributeAdvance}
                    disabled={!allRoomsAssigned}
                  >
                    <Scale className="h-4 w-4" />
                    Split advance by room total
                  </Button>
                ) : null}
              </div>

              {roomsLoading ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Loading available rooms…
                </p>
              ) : (
                <div className="overflow-x-auto">
                <div className="min-w-[42rem] rounded-xl border overflow-hidden bg-card shadow-sm">
                  <div className="grid grid-cols-[minmax(7rem,1fr)_minmax(9rem,1.4fr)_minmax(6.5rem,0.9fr)_minmax(7.5rem,1fr)_minmax(6.5rem,0.9fr)] gap-4 px-5 py-3 bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <span>Room</span>
                    <span>Category</span>
                    <span className="text-right">Total</span>
                    <span className="text-right">Advance (BDT)</span>
                    <span className="text-right">Due</span>
                  </div>
                  <Separator />
                  {convertSlots.map((slot) => {
                    const line = unfulfilledLines.find((row) => row.id === slot.lineId)
                    if (!line) return null
                    const financial = slotFinancials.find((row) => row.key === slot.key)
                    const isPreset = Boolean(slot.presetRoomNumber && line.unfulfilledCount === 1)

                    return (
                      <div
                        key={slot.key}
                        className="grid grid-cols-[minmax(7rem,1fr)_minmax(9rem,1.4fr)_minmax(6.5rem,0.9fr)_minmax(7.5rem,1fr)_minmax(6.5rem,0.9fr)] gap-4 px-5 py-4 border-b last:border-b-0 items-center bg-background even:bg-muted/10"
                      >
                        <div className="min-w-0">
                          {isPreset ? (
                            <p className="text-base font-semibold">{slot.presetRoomNumber}</p>
                          ) : (
                            <Select
                              value={slot.roomId || undefined}
                              onValueChange={(value) => {
                                setRoomAssignments((prev) => {
                                  const next = [...(prev[line.id] ?? [])]
                                  next[slot.lineIndex] = value
                                  return { ...prev, [line.id]: next }
                                })
                              }}
                            >
                              <SelectTrigger className="w-full h-10 text-sm font-medium">
                                <SelectValue placeholder="Select room" />
                              </SelectTrigger>
                              <SelectContent>
                                {roomsForLine(line, slot.lineIndex, slot.roomId).map((room) => (
                                  <SelectItem key={room.id} value={room.id}>
                                    Room {room.roomNumber}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>

                        <div className="min-w-0">
                          <p className="text-sm text-foreground leading-snug">{slot.roomTypeName}</p>
                        </div>

                        <div>
                          <p className="text-sm font-medium tabular-nums text-right">
                            {financial?.roomId ? formatBdt(financial.totalWithVat) : '—'}
                          </p>
                        </div>

                        <div>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            className="h-10 w-full min-w-[6.5rem] text-right tabular-nums text-sm font-medium"
                            value={advanceBySlot[slot.key] ?? ''}
                            placeholder="0.00"
                            disabled={!slot.roomId}
                            onChange={(e) => handleAdvanceChange(slot.key, e.target.value)}
                          />
                        </div>

                        <div>
                          <p className="text-sm font-semibold tabular-nums text-right text-amber-800">
                            {financial?.roomId ? formatBdt(financial.due) : '—'}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between rounded-xl border bg-muted/20 px-5 py-4">
              <div>
                <p className="text-sm font-medium">Check in immediately</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Mark converted rooms as checked in on arrival day
                </p>
              </div>
              <Switch checked={checkInNow} onCheckedChange={setCheckInNow} />
            </div>
          </div>
        )}
        </div>

        <DialogFooter className="shrink-0 gap-3 border-t bg-muted/20 px-6 py-4 sm:justify-end">
          <Button variant="outline" className="min-w-[6rem]" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => convertMutation.mutate()}
            disabled={
              !canSubmit || convertMutation.isPending || entryLoading || entry?.unfulfilledRooms === 0
            }
            className="min-w-[10rem] bg-amber-600 hover:bg-amber-700"
          >
            {convertMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Converting…
              </>
            ) : (
              `Convert ${assignedSlots.length || entry?.unfulfilledRooms || 0} room${
                (assignedSlots.length || entry?.unfulfilledRooms || 0) === 1 ? '' : 's'
              }`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SummaryStat({
  label,
  value,
  valueClassName = '',
  className = '',
}: {
  label: string
  value: string
  valueClassName?: string
  className?: string
}) {
  return (
    <div className={`px-5 py-4 min-w-0 ${className}`}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </p>
      <p className={`text-base tabular-nums mt-1.5 ${valueClassName}`}>{value}</p>
    </div>
  )
}
