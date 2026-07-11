'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmailInput } from '@/components/ui/email-input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Trash2, CheckCircle2 } from 'lucide-react'
import { ReservationEntryDocumentView } from './ReservationEntryDocumentView'
import { useHotelTimes } from '@/hooks/use-hotel-times'
import {
  countHotelStayNights,
  describeStayPeriod,
  isStayDatePickerRangeValid,
  minCheckoutDatePickerValue,
} from '@/lib/hotel-times'
import { CompanyLedgerSearchField } from './CompanyLedgerSearchField'
import { DEFAULT_GUEST_COMPANY } from '@/lib/reservation-terms'
import { formatPaymentMethod, PAYMENT_METHOD_OPTIONS } from '@/lib/payment-method'
import { getRoomNightlyTotal } from '@/lib/room-pricing'
import { computeRoomBookingTotals } from '@/lib/booking-totals'
import type { BookingDiscountType } from '@/lib/booking-discount'
import { getPhoneValidationMessage } from '@/lib/phone'
import { formatBdt } from '@/lib/currency'
import {
  buildRoomsAvailabilityQueryUrl,
  type RoomsAvailabilityResponse,
} from '@/lib/rooms-availability-query'
import { filterSellableRooms } from '@/lib/room-sellability'
import { NationalityField } from '@/components/erp/shared/NationalityField'
import { GuestIdTypeField } from '@/components/erp/hotel/GuestIdTypeField'
import type { IdDocumentType } from '@/lib/id-ocr'
import { getIdTypeOptionsForNationality } from '@/lib/id-type-label'
import { isKnownNationality } from '@/lib/nationalities'

type RoomType = { id: string; name: string }

type RoomOption = {
  id: string
  roomNumber: string
  typeId: string
  totalPrice: number
  type: { name: string }
}

type EntryLineDraft = {
  id: string
  roomTypeId: string
  roomId: string
  quantity: string
}

type EntryPaymentLine = {
  id: string
  amount: number
  method: string
}

function newLine(): EntryLineDraft {
  return {
    id: crypto.randomUUID(),
    roomTypeId: '',
    roomId: '',
    quantity: '1',
  }
}

function parseLineQuantity(value: string): number {
  return Math.max(1, parseInt(value, 10) || 1)
}

function categoryQtyUsedByOtherLines(
  lineId: string,
  roomTypeId: string,
  allLines: EntryLineDraft[]
): number {
  return allLines
    .filter(
      (other) =>
        other.id !== lineId &&
        !other.roomId &&
        other.roomTypeId === roomTypeId
    )
    .reduce((sum, other) => sum + parseLineQuantity(other.quantity), 0)
}

function maxQuantityForLine(
  line: EntryLineDraft,
  allLines: EntryLineDraft[],
  categoryCapacityByType: Map<
    string,
    { available: number; total: number; entryHeld: number; maintenance: number; typeName: string }
  >
): number {
  if (!line.roomTypeId || line.roomId) return 1
  const cap = categoryCapacityByType.get(line.roomTypeId)
  const availableInCategory = cap?.available ?? 0
  const usedByOthers = categoryQtyUsedByOtherLines(line.id, line.roomTypeId, allLines)
  return Math.max(0, availableInCategory - usedByOthers)
}

function defaultDates() {
  const checkIn = new Date()
  const checkOut = new Date()
  checkOut.setDate(checkOut.getDate() + 1)
  return {
    checkIn: format(checkIn, 'yyyy-MM-dd'),
    checkOut: format(checkOut, 'yyyy-MM-dd'),
  }
}

const STEP_LABELS = ['Entry', 'Payment', 'Confirm']

export function ReservationEntryWizard() {
  const queryClient = useQueryClient()
  const { times } = useHotelTimes()
  const dates = defaultDates()
  const [step, setStep] = useState(1)
  const [checkInDate, setCheckInDate] = useState(dates.checkIn)
  const [checkOutDate, setCheckOutDate] = useState(dates.checkOut)
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<EntryLineDraft[]>([newLine()])
  const [completedEntryId, setCompletedEntryId] = useState<string | null>(null)

  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [guestEmail, setGuestEmail] = useState('')
  const [guestAddress, setGuestAddress] = useState('')
  const [guestNationality, setGuestNationality] = useState('Bangladesh')
  const [guestIdType, setGuestIdType] = useState<IdDocumentType | ''>('')
  const [guestIdNumber, setGuestIdNumber] = useState('')
  const [companyLedgerId, setCompanyLedgerId] = useState('')
  const [guestCompany, setGuestCompany] = useState(DEFAULT_GUEST_COMPANY)
  const [typedCompany, setTypedCompany] = useState('')

  const [discountEnabled, setDiscountEnabled] = useState(false)
  const [discountType, setDiscountType] = useState<BookingDiscountType>('PERCENTAGE')
  const [discountValue, setDiscountValue] = useState('')
  const [advancePayment, setAdvancePayment] = useState('0')
  const [advancePaymentMethod, setAdvancePaymentMethod] = useState('CASH')
  const [paymentLines, setPaymentLines] = useState<EntryPaymentLine[]>([])

  const datesValid = isStayDatePickerRangeValid(checkInDate, checkOutDate)

  const { data: roomTypesData } = useQuery({
    queryKey: ['room-types'],
    queryFn: () => api.get<{ success: boolean; data: RoomType[] }>('/room-types'),
  })
  const roomTypes = roomTypesData?.data ?? []

  const { data: roomsData, isLoading: roomsLoading } = useQuery({
    queryKey: ['available-rooms-entry', checkInDate, checkOutDate],
    queryFn: () =>
      api.get<RoomsAvailabilityResponse<RoomOption>>(
        buildRoomsAvailabilityQueryUrl({
          checkIn: checkInDate,
          checkOut: checkOutDate,
          forReservationEntry: true,
        })
      ),
    enabled: datesValid,
  })
  const availableRooms = filterSellableRooms(roomsData?.data ?? [])
  const categoryCapacityByType = useMemo(() => {
    const map = new Map<
      string,
      { typeName: string; total: number; available: number; entryHeld: number; maintenance: number }
    >()
    for (const row of roomsData?.meta?.categoryCapacity ?? []) {
      map.set(row.roomTypeId, row)
    }
    return map
  }, [roomsData?.meta?.categoryCapacity])

  const roomsByType = useMemo(() => {
    const map = new Map<string, RoomOption[]>()
    for (const room of availableRooms) {
      const list = map.get(room.typeId) ?? []
      list.push(room)
      map.set(room.typeId, list)
    }
    return map
  }, [availableRooms])

  useEffect(() => {
    const rooms = roomsData?.data
    if (!rooms?.length) return
    const availableIds = new Set(rooms.map((room) => room.id))
    setLines((prev) => {
      let changed = false
      const next = prev.map((line) => {
        if (line.roomId && !availableIds.has(line.roomId)) {
          changed = true
          return { ...line, roomId: '' }
        }
        return line
      })
      return changed ? next : prev
    })
  }, [roomsData?.data])

  useEffect(() => {
    if (!roomsData?.data) return
    setLines((prev) => {
      let changed = false
      const next = prev.map((line) => {
        if (line.roomId || !line.roomTypeId) return line
        const maxQty = maxQuantityForLine(line, prev, categoryCapacityByType)
        const current = parseLineQuantity(line.quantity)
        if (maxQty === 0 && line.quantity !== '1') {
          changed = true
          return { ...line, quantity: '1' }
        }
        if (maxQty > 0 && current > maxQty) {
          changed = true
          return { ...line, quantity: String(maxQty) }
        }
        return line
      })
      return changed ? next : prev
    })
  }, [roomsData?.data, categoryCapacityByType])

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ success: boolean; data: { id: string } }>('/reservation-entries', body),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] })
      queryClient.invalidateQueries({ queryKey: ['reservation-entries'] })
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
      queryClient.invalidateQueries({ queryKey: ['available-rooms-entry'] })
      queryClient.invalidateQueries({ queryKey: ['reservation-entries-summary'] })
      queryClient.invalidateQueries({ queryKey: ['company-ledger'] })
      setCompletedEntryId(res.data?.id ?? null)
      setStep(4)
      toast.success('Reservation entry saved')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to save reservation entry'),
  })

  const lineSummary = useMemo(
    () =>
      lines
        .filter((line) => line.roomTypeId)
        .map((line) => {
          const typeName = roomTypes.find((t) => t.id === line.roomTypeId)?.name ?? 'Category'
          if (line.roomId) {
            const room = availableRooms.find((r) => r.id === line.roomId)
            return `${typeName} · ${room?.roomNumber ?? 'Room'}`
          }
          return `${line.quantity || '1'}× ${typeName}`
        }),
    [lines, roomTypes, availableRooms]
  )

  const estimatedRoomCharge = useMemo(() => {
    if (!datesValid) return 0
    const nights = countHotelStayNights(
      new Date(`${checkInDate}T12:00:00`),
      new Date(`${checkOutDate}T12:00:00`)
    )
    let nightly = 0
    for (const line of lines.filter((l) => l.roomTypeId)) {
      const qty = line.roomId ? 1 : Math.max(1, parseInt(line.quantity, 10) || 1)
      const room = line.roomId
        ? availableRooms.find((r) => r.id === line.roomId)
        : availableRooms.find((r) => r.typeId === line.roomTypeId)
      if (room) nightly += getRoomNightlyTotal(room) * qty
    }
    return nightly * nights
  }, [lines, availableRooms, checkInDate, checkOutDate, datesValid])

  const totalAdvancePaid = () => paymentLines.reduce((sum, line) => sum + line.amount, 0)

  const estimatedTotals = useMemo(
    () =>
      computeRoomBookingTotals(
        estimatedRoomCharge,
        totalAdvancePaid(),
        { vatApplied: false, vatPercent: 15 },
        {
          discountEnabled,
          discountType,
          discountValue: parseFloat(discountValue) || 0,
        }
      ),
    [estimatedRoomCharge, paymentLines, discountEnabled, discountType, discountValue]
  )

  const resolvedCompanyLabel = companyLedgerId
    ? guestCompany
    : typedCompany.trim() || guestCompany

  const requiresGuestIdFields = !companyLedgerId

  const handleNationalityChange = (nationality: string) => {
    setGuestNationality(nationality)
    setGuestIdType((prev) => {
      const options = getIdTypeOptionsForNationality(nationality)
      return options.some((opt) => opt.value === prev) ? prev : ''
    })
  }

  const validateEntryStep = (): string | null => {
    if (!datesValid) return 'Select valid check-in and check-out dates'
    if (!guestName.trim()) return 'Guest name is required'
    const phoneError = getPhoneValidationMessage(guestPhone)
    if (phoneError) return phoneError
    if (requiresGuestIdFields) {
      if (!isKnownNationality(guestNationality)) return 'Nationality is required'
    }
    const validLines = lines.filter((line) => line.roomTypeId)
    if (!validLines.length) return 'Add at least one room category line'
    const requestedByType = new Map<string, number>()
    for (const line of validLines) {
      if (line.roomId) {
        const stillAvailable = availableRooms.some((room) => room.id === line.roomId)
        if (!stillAvailable) {
          return 'One or more selected rooms are no longer free for these dates'
        }
      } else {
        const qty = parseInt(line.quantity, 10)
        if (!qty || qty < 1) return 'Quantity must be at least 1 for category-only lines'
        requestedByType.set(
          line.roomTypeId,
          (requestedByType.get(line.roomTypeId) ?? 0) + qty
        )
      }
    }
    for (const [typeId, qty] of requestedByType) {
      const cap = categoryCapacityByType.get(typeId)
      const freeInCategory = cap?.available ?? 0
      if (qty > freeInCategory) {
        const typeName = cap?.typeName ?? roomTypes.find((t) => t.id === typeId)?.name ?? 'category'
        return `Only ${freeInCategory} ${typeName} room(s) available for these dates (${qty} requested)`
      }
    }
    return null
  }

  const handleRecordPayment = () => {
    const amount = parseFloat(advancePayment) || 0
    if (amount <= 0) {
      toast.error('Enter a payment amount greater than 0')
      return
    }
    if (advancePaymentMethod === 'NONE') {
      toast.error('Select a payment method')
      return
    }
    setPaymentLines((prev) => [
      ...prev,
      { id: crypto.randomUUID(), amount, method: advancePaymentMethod },
    ])
    setAdvancePayment('0')
  }

  const handleSubmit = () => {
    const error = validateEntryStep()
    if (error) {
      toast.error(error)
      return
    }

    createMutation.mutate({
      checkIn: checkInDate,
      checkOut: checkOutDate,
      notes: notes.trim() || undefined,
      guestName: guestName.trim(),
      guestPhone: guestPhone.trim(),
      guestEmail: guestEmail.trim() || undefined,
      guestAddress: guestAddress.trim() || undefined,
      guestNationality: requiresGuestIdFields ? guestNationality.trim() : undefined,
      guestIdType: requiresGuestIdFields && guestIdType ? guestIdType : undefined,
      guestIdNumber: requiresGuestIdFields ? guestIdNumber.trim() || undefined : undefined,
      nidPhysicallyReceived: !companyLedgerId,
      company: companyLedgerId ? undefined : resolvedCompanyLabel,
      companyLedgerId: companyLedgerId || null,
      discountEnabled,
      discountType: discountEnabled ? discountType : null,
      discountValue: discountEnabled ? parseFloat(discountValue) || 0 : 0,
      entryPayments: paymentLines.map((line) => ({
        amount: line.amount,
        method: line.method,
      })),
      lines: lines
        .filter((line) => line.roomTypeId)
        .map((line) => ({
          roomTypeId: line.roomTypeId,
          roomId: line.roomId || null,
          quantity: line.roomId ? 1 : parseInt(line.quantity, 10) || 1,
        })),
    })
  }

  const resetForm = () => {
    const d = defaultDates()
    setCheckInDate(d.checkIn)
    setCheckOutDate(d.checkOut)
    setNotes('')
    setLines([newLine()])
    setGuestName('')
    setGuestPhone('')
    setGuestEmail('')
    setGuestAddress('')
    setGuestNationality('Bangladesh')
    setGuestIdType('')
    setGuestIdNumber('')
    setCompanyLedgerId('')
    setGuestCompany(DEFAULT_GUEST_COMPANY)
    setTypedCompany('')
    setDiscountEnabled(false)
    setDiscountType('PERCENTAGE')
    setDiscountValue('')
    setAdvancePayment('0')
    setAdvancePaymentMethod('CASH')
    setPaymentLines([])
    setCompletedEntryId(null)
    setStep(1)
  }

  const updateLine = (id: string, patch: Partial<EntryLineDraft>) => {
    setLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, ...patch } : line))
    )
  }

  if (step === 4 && completedEntryId) {
    return (
      <div className="space-y-6">
        <Card className="border-emerald-200 bg-emerald-50 print:hidden">
          <CardContent className="p-4 flex items-start gap-3">
            <CheckCircle2 className="h-8 w-8 text-emerald-600 shrink-0" />
            <div>
              <h2 className="font-semibold text-emerald-900">Reservation entry saved</h2>
              <p className="text-sm text-emerald-800 mt-1">
                Room inventory is blocked for the selected dates. A registration number and
                confirmation document have been generated — print or download below.
                {companyLedgerId
                  ? ' Balance due has been posted to the company ledger.'
                  : totalAdvancePaid() > 0
                    ? ` Advance received: ${formatBdt(totalAdvancePaid())}.`
                    : ''}
              </p>
            </div>
          </CardContent>
        </Card>

        <ReservationEntryDocumentView
          entryId={completedEntryId}
          showToolbar
          onClose={() => window.close()}
        />

        <div className="flex flex-wrap gap-3 print:hidden">
          <Button variant="outline" className="gap-2" onClick={resetForm}>
            <Plus className="h-4 w-4" />
            Create another entry
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              window.open(`/reservation-entry/${completedEntryId}`, '_blank', 'noopener,noreferrer')
            }
          >
            Open confirmation in new tab
          </Button>
          <Button variant="outline" onClick={() => window.close()}>
            Close
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {STEP_LABELS.map((label, i) => {
          const s = i + 1
          return (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${
                  step >= s ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground'
                }`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                    step >= s ? 'bg-amber-600 text-white' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {step > s ? '✓' : s}
                </span>
                {label}
              </div>
              {s < STEP_LABELS.length && (
                <div className={`hidden sm:block w-6 h-0.5 ${step > s ? 'bg-amber-500' : 'bg-border'}`} />
              )}
            </div>
          )
        })}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Block room inventory by category with guest and company details. Advance payments and
            company ledger billing can be recorded on the next step.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Full name *</Label>
              <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Phone *</Label>
              <Input value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <EmailInput value={guestEmail} onChange={setGuestEmail} optional />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input value={guestAddress} onChange={(e) => setGuestAddress(e.target.value)} />
            </div>
          </div>

          {!companyLedgerId ? (
            <div
              className="grid grid-cols-1 gap-4 md:grid-cols-3"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: '1rem',
              }}
            >
              <div className="min-w-0">
                <NationalityField
                  value={guestNationality}
                  onChange={handleNationalityChange}
                  label="Nationality *"
                  placeholder="Select nationality…"
                />
              </div>
              <div className="min-w-0">
                <GuestIdTypeField
                  nationality={guestNationality}
                  idType={guestIdType}
                  onIdTypeChange={setGuestIdType}
                  allowUnset
                />
              </div>
              <div className="min-w-0 space-y-2">
                <Label>ID / Passport number</Label>
                <Input
                  value={guestIdNumber}
                  onChange={(e) => setGuestIdNumber(e.target.value)}
                  placeholder="Optional — can be added later"
                  className="h-9 bg-card"
                />
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Company (ledger)</Label>
              <CompanyLedgerSearchField
                selectedLedgerId={companyLedgerId}
                selectedLabel={guestCompany}
                onSelect={(company) => {
                  setCompanyLedgerId(company.id)
                  setGuestCompany(company.name)
                  setTypedCompany('')
                }}
                onClear={() => {
                  setCompanyLedgerId('')
                  setGuestCompany(DEFAULT_GUEST_COMPANY)
                }}
              />
              {companyLedgerId ? (
                <p className="text-xs text-muted-foreground">
                  Bill will be posted to this company ledger. Guest pays company; balance due goes
                  to the ledger account.
                </p>
              ) : null}
            </div>
            {!companyLedgerId && (
              <div className="space-y-2">
                <Label>Company (type manually)</Label>
                <Input
                  value={typedCompany}
                  onChange={(e) => setTypedCompany(e.target.value)}
                  placeholder="Optional company name"
                />
                <p className="text-xs text-muted-foreground">
                  Use when the company is not in the ledger list.
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Check-in *</Label>
              <Input
                type="date"
                value={checkInDate}
                onChange={(e) => {
                  const nextIn = e.target.value
                  setCheckInDate(nextIn)
                  const nextOut = minCheckoutDatePickerValue(nextIn)
                  if (nextOut) setCheckOutDate(nextOut)
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Check-out *</Label>
              <Input
                type="date"
                value={checkOutDate}
                min={minCheckoutDatePickerValue(checkInDate)}
                onChange={(e) => setCheckOutDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3">
            <Label>Room lines *</Label>

            {categoryCapacityByType.size > 0 && !roomsLoading ? (
              <div className="rounded-md border border-muted bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Category availability for selected dates: </span>
                {Array.from(categoryCapacityByType.values())
                  .filter((row) => row.total > 0)
                  .map((row) => (
                    <span key={row.typeName} className="mr-3 inline-block">
                      {row.typeName}:{' '}
                      <span className="font-medium text-foreground">{row.available} available</span>
                      {row.entryHeld > 0 ? ` (${row.entryHeld} in entry pool)` : ''}
                      {row.maintenance > 0 ? ` · ${row.maintenance} maintenance` : ''}
                      {' · '}
                      {row.total} total
                    </span>
                  ))}
              </div>
            ) : null}

            {lines.map((line, index) => {
              const selectedInOtherLines = new Set(
                lines
                  .filter((other) => other.id !== line.id && other.roomId)
                  .map((other) => other.roomId)
              )
              const typeRooms = (line.roomTypeId ? roomsByType.get(line.roomTypeId) ?? [] : []).filter(
                (room) => !selectedInOtherLines.has(room.id)
              )
              const maxQty = maxQuantityForLine(line, lines, categoryCapacityByType)
              const categoryOnly = !line.roomId && !!line.roomTypeId
              return (
                <div
                  key={line.id}
                  className="overflow-x-auto rounded-lg border p-3"
                >
                  <div className="grid min-w-[36rem] grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto] gap-3 items-end">
                  <div className="min-w-0 space-y-1">
                    <Label className="text-xs text-muted-foreground">Category</Label>
                    <Select
                      value={line.roomTypeId || 'none'}
                      onValueChange={(v) => {
                        const roomTypeId = v === 'none' ? '' : v
                        const nextMax = roomTypeId
                          ? maxQuantityForLine(
                              { ...line, roomTypeId, roomId: '' },
                              lines,
                              categoryCapacityByType
                            )
                          : 0
                        updateLine(line.id, {
                          roomTypeId,
                          roomId: '',
                          quantity:
                            nextMax > 0
                              ? String(Math.min(parseLineQuantity(line.quantity), nextMax))
                              : '1',
                        })
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Room category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Select category</SelectItem>
                        {roomTypes.map((rt) => {
                          const cap = categoryCapacityByType.get(rt.id)
                          const label = cap
                            ? `${rt.name} (${cap.available} of ${cap.total} available)`
                            : rt.name
                          return (
                          <SelectItem key={rt.id} value={rt.id}>
                            {label}
                          </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-0 space-y-1">
                    <Label className="text-xs text-muted-foreground">Room (optional)</Label>
                    <Select
                      value={line.roomId || 'none'}
                      onValueChange={(v) => updateLine(line.id, { roomId: v === 'none' ? '' : v })}
                      disabled={!line.roomTypeId || roomsLoading}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Any room" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Any / by quantity</SelectItem>
                        {typeRooms.map((room) => (
                          <SelectItem key={room.id} value={room.id}>
                            {room.roomNumber}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {line.roomTypeId && !roomsLoading && typeRooms.length === 0 ? (
                      <p className="text-xs text-amber-700">
                        No unbooked rooms in this category for the selected dates.
                      </p>
                    ) : line.roomTypeId && !roomsLoading && categoryOnly && maxQty === 0 ? (
                      <p className="text-xs text-amber-700">
                        Category inventory full for these dates (held by entries or bookings).
                      </p>
                    ) : null}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      {categoryOnly
                        ? maxQty > 0
                          ? (() => {
                              const cap = categoryCapacityByType.get(line.roomTypeId)
                              return cap
                                ? `No. of rooms (${maxQty} available · ${cap.entryHeld} in entry pool${cap.maintenance > 0 ? ` · ${cap.maintenance} maintenance` : ''} · ${cap.total} total)`
                                : `No. of rooms (${maxQty} available)`
                            })()
                          : 'No. of rooms (0 available)'
                        : 'No. of rooms'}
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      max={categoryOnly && maxQty > 0 ? maxQty : undefined}
                      value={line.quantity}
                      disabled={!!line.roomId || (categoryOnly && maxQty === 0)}
                      onChange={(e) => {
                        const raw = e.target.value
                        if (raw === '') {
                          updateLine(line.id, { quantity: raw })
                          return
                        }
                        const parsed = parseInt(raw, 10)
                        if (!Number.isFinite(parsed)) return
                        const capped =
                          categoryOnly && maxQty > 0
                            ? Math.min(Math.max(1, parsed), maxQty)
                            : Math.max(1, parsed)
                        updateLine(line.id, { quantity: String(capped) })
                      }}
                    />
                    {categoryOnly && maxQty === 0 && !roomsLoading ? (
                      <p className="text-xs text-amber-700">
                        No rooms left in this category for the selected dates.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex justify-end self-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={lines.length === 1}
                      onClick={() => setLines((p) => p.filter((l) => l.id !== line.id))}
                      aria-label={`Remove line ${index + 1}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  </div>
                </div>
              )
            })}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines((p) => [...p, newLine()])}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add line
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes for this reservation entry"
              rows={2}
            />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Card className="border-emerald-200 bg-emerald-50/40">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-emerald-900">Discount</p>
                  <p className="text-xs text-muted-foreground">Optional discount on estimated room total</p>
                </div>
                <Switch checked={discountEnabled} onCheckedChange={setDiscountEnabled} />
              </div>
              {discountEnabled && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Discount type</Label>
                    <Select
                      value={discountType}
                      onValueChange={(v) => setDiscountType(v as BookingDiscountType)}
                    >
                      <SelectTrigger className="h-9 bg-card">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PERCENTAGE">Percentage (%)</SelectItem>
                        <SelectItem value="FIXED">Fixed amount (BDT)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">
                      {discountType === 'PERCENTAGE' ? 'Discount (%)' : 'Discount (BDT)'}
                    </Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                      className="h-9 bg-card"
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {estimatedRoomCharge > 0 && (
            <Card className="bg-amber-50 border-amber-200">
              <CardContent className="p-3 text-sm font-medium text-amber-800">
                Estimated room total: {formatBdt(estimatedTotals.totalWithVat)}
                {estimatedTotals.dueAmount > 0
                  ? ` · Balance due after payments: ${formatBdt(estimatedTotals.dueAmount)}`
                  : ' · Fully covered by payments'}
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 items-end">
            <div className="space-y-2">
              <Label>Advance payment (BDT)</Label>
              <Input
                type="number"
                min={0}
                value={advancePayment}
                onChange={(e) => setAdvancePayment(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Payment method</Label>
              <Select value={advancePaymentMethod} onValueChange={setAdvancePaymentMethod}>
                <SelectTrigger>
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHOD_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleRecordPayment}
            >
              Record payment
            </Button>
          </div>

          {paymentLines.length > 0 && (
            <Card className="border-emerald-200">
              <CardContent className="p-3 space-y-2">
                <p className="text-sm font-semibold text-emerald-900">Payments recorded</p>
                {paymentLines.map((line) => (
                  <div key={line.id} className="flex justify-between text-sm">
                    <span>{formatPaymentMethod(line.method)}</span>
                    <span className="font-medium">{formatBdt(line.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-semibold border-t pt-2">
                  <span>Total paid</span>
                  <span>{formatBdt(totalAdvancePaid())}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {companyLedgerId && estimatedTotals.dueAmount > 0 && (
            <p className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md px-3 py-2">
              Remaining balance ({formatBdt(estimatedTotals.dueAmount)}) will be billed to{' '}
              <strong>{guestCompany}</strong> on the company ledger.
            </p>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 rounded-lg border p-4">
          <h3 className="font-medium">Confirm reservation entry</h3>
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Guest</dt>
              <dd>
                {guestName}
                {guestPhone ? ` · ${guestPhone}` : ''}
              </dd>
            </div>
            {requiresGuestIdFields && guestNationality ? (
              <div>
                <dt className="text-muted-foreground">Nationality</dt>
                <dd>{guestNationality}</dd>
              </div>
            ) : null}
            {requiresGuestIdFields && guestIdType ? (
              <div>
                <dt className="text-muted-foreground">ID / Passport</dt>
                <dd>
                  {guestIdType === 'national_id'
                    ? 'National ID (NID)'
                    : guestIdType === 'passport'
                      ? 'Passport'
                      : guestIdType === 'driving_license'
                        ? 'Driving License'
                        : guestIdType}
                  {guestIdNumber.trim() ? ` · ${guestIdNumber.trim()}` : ''}
                </dd>
              </div>
            ) : guestIdNumber.trim() ? (
              <div>
                <dt className="text-muted-foreground">ID / Passport number</dt>
                <dd>{guestIdNumber.trim()}</dd>
              </div>
            ) : null}
            {guestAddress.trim() ? (
              <div>
                <dt className="text-muted-foreground">Address</dt>
                <dd>{guestAddress.trim()}</dd>
              </div>
            ) : null}
            {resolvedCompanyLabel && resolvedCompanyLabel !== DEFAULT_GUEST_COMPANY ? (
              <div>
                <dt className="text-muted-foreground">Company</dt>
                <dd>
                  {resolvedCompanyLabel}
                  {companyLedgerId ? ' (company ledger)' : ''}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted-foreground">Stay period</dt>
              <dd>{describeStayPeriod(checkInDate, checkOutDate, times)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Room lines</dt>
              <dd>{lineSummary.join(', ') || '—'}</dd>
            </div>
            {estimatedRoomCharge > 0 ? (
              <div>
                <dt className="text-muted-foreground">Estimated total</dt>
                <dd>
                  {formatBdt(estimatedTotals.totalWithVat)}
                  {totalAdvancePaid() > 0 ? ` · Paid ${formatBdt(totalAdvancePaid())}` : ''}
                  {estimatedTotals.dueAmount > 0
                    ? ` · Due ${formatBdt(estimatedTotals.dueAmount)}`
                    : ''}
                </dd>
              </div>
            ) : null}
            {notes.trim() ? (
              <div>
                <dt className="text-muted-foreground">Notes</dt>
                <dd>{notes.trim()}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      )}

      <div className="flex flex-wrap justify-between gap-3">
        <div>
          {step > 1 && step < 4 && (
            <Button variant="outline" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          {step === 1 && (
            <Button
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => {
                const error = validateEntryStep()
                if (error) {
                  toast.error(error)
                  return
                }
                setStep(2)
              }}
            >
              Continue to payment
            </Button>
          )}
          {step === 2 && (
            <Button className="bg-amber-600 hover:bg-amber-700" onClick={() => setStep(3)}>
              Review & confirm
            </Button>
          )}
          {step === 3 && (
            <Button
              className="bg-amber-600 hover:bg-amber-700"
              onClick={handleSubmit}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Saving…' : 'Save reservation entry'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
