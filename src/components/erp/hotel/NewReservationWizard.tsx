'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { format, parseISO } from 'date-fns'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmailInput } from '@/components/ui/email-input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { IdDocumentScanner } from './IdDocumentScanner'
import { GuestSearchField, type GuestSearchResult } from './GuestSearchField'
import { CompanyLedgerSearchField } from './CompanyLedgerSearchField'
import { NationalityField } from '@/components/erp/shared/NationalityField'
import {
  DEFAULT_NATIONALITY,
  isBangladeshNationality,
  resolveIdTypeForNationality,
} from '@/lib/id-type-label'
import { NATIONALITY_OPTIONS } from '@/lib/nationalities'
import { ReservationDocumentView } from './ReservationDocumentView'
import type { IdDocumentType } from '@/lib/id-ocr'
import type { IdDocumentItem, IdScanResult } from './IdDocumentScanner'
import { Switch } from '@/components/ui/switch'
import { CheckCircle2, FilePenLine, LogIn, Plus } from 'lucide-react'
import {
  computeRoomBookingTotals,
  DEFAULT_VAT_PERCENT,
} from '@/lib/booking-totals'
import { formatPaymentMethod, PAYMENT_METHOD_OPTIONS } from '@/lib/payment-method'
import {
  DEFAULT_GUEST_COMPANY,
  formatGuestCompany,
  formatReservationMealPlan,
} from '@/lib/reservation-terms'
import { useHotelTimes } from '@/hooks/use-hotel-times'
import {
  getCompleteReservationMissingFields,
  getCorporateGuestMissingFields,
  getInitialReservationMissingFields,
  getPhysicalIdMissingFields,
} from '@/lib/reservation-completion-fields'
import {
  applyHotelTimeToBookingInput,
  countHotelStayNights,
  describeStayPeriod,
  formatBookingDateOnly,
  formatTime12h,
  isStayDatePickerRangeValid,
  minCheckoutDatePickerValue,
} from '@/lib/hotel-times'
import type { BookingDiscountType } from '@/lib/booking-discount'
import { getRoomNightlyTotal } from '@/lib/room-pricing'
import {
  buildAdultCompanionSlots,
  expectedCompanionCount,
  validateCompanionInputs,
  validateCorporateCompanionInputs,
  type CompanionInput,
} from '@/lib/booking-companions'
import {
  CompanionGuestFields,
  emptyCompanionDraft,
  type CompanionGuestDraft,
} from './CompanionGuestFields'
import {
  CorporateCompanionGuestFields,
  emptyCorporateCompanionDraft,
  type CorporateCompanionDraft,
} from './CorporateCompanionGuestFields'
import { INVOICE_SERVICE_CHARGE_PERCENT } from '@/lib/invoice-display'
import { hasBookingCompany } from '@/lib/booking-company'
import { getPhoneValidationMessage } from '@/lib/phone'
import {
  buildRoomsAvailabilityQueryUrl,
  type RoomsAvailabilityResponse,
} from '@/lib/rooms-availability-query'
import { ReservationEntryWizard } from './ReservationEntryWizard'

interface Room {
  id: string
  roomNumber: string
  status: string
  totalPrice: number
  type: { name: string }
}

const STEP_LABELS = ['Guest', 'Stay', 'Payment', 'Confirm', 'Document']

function defaultStayDates() {
  const checkIn = new Date()
  const checkOut = new Date()
  checkOut.setDate(checkOut.getDate() + 1)
  return {
    checkIn: format(checkIn, 'yyyy-MM-dd'),
    checkOut: format(checkOut, 'yyyy-MM-dd'),
  }
}

function stayDatesValid(checkIn: string, checkOut: string) {
  return isStayDatePickerRangeValid(checkIn, checkOut)
}

function getInitialReservationGuestMissingFields(
  mode: GuestMode,
  guest: {
    selectedCustomerId: string
    guestName: string
    guestPhone: string
    guestNationality: string
  }
): string[] {
  const missing = getInitialReservationMissingFields({
    guestName: guest.guestName,
    guestPhone: guest.guestPhone,
    guestNationality: guest.guestNationality,
  })
  if (mode === 'existing' && !guest.selectedCustomerId) {
    missing.unshift('Guest selection')
  }
  return missing
}

type GuestMode = 'new' | 'existing'

type GuestDraft = {
  selectedCustomerId: string
  guestName: string
  guestCompany: string
  companyLedgerId: string
  guestPhone: string
  guestEmail: string
  guestAddress: string
  guestDesignation: string
  guestNationality: string
  isCorporateGuest: boolean
  idType: IdDocumentType
  idNumber: string
  visaExpiryDate: string
  idDocuments: IdDocumentItem[]
  existingDocsStatus: 'idle' | 'loading' | 'none' | 'found'
  nidPhysicallyReceived: boolean
  companions: CompanionGuestDraft[]
  corporateCompanions: CorporateCompanionDraft[]
}

type StayDraft = {
  selectedRoomId: string
  checkInDate: string
  checkOutDate: string
  adults: string
  children: string
  withMeal: boolean
}

type PaymentDraft = {
  advancePayment: string
  advancePaymentMethod: string
  reservationNotes: string
  chargesEditEnabled: boolean
  vatPercent: string
  serviceChargePercent: string
  discountEnabled: boolean
  discountType: BookingDiscountType
  discountValue: string
}

type ReservationPaymentLine = {
  id: string
  amount: number
  method: string
}

type ReservationWizardDraft = {
  step: number
  guest: GuestDraft
  stay: StayDraft
  payment: PaymentDraft
}

function emptyGuestDraft(options?: { forExistingGuest?: boolean }): GuestDraft {
  return {
    selectedCustomerId: '',
    guestName: '',
    guestCompany: DEFAULT_GUEST_COMPANY,
    companyLedgerId: '',
    guestPhone: '',
    guestEmail: '',
    guestAddress: '',
    guestDesignation: '',
    guestNationality: DEFAULT_NATIONALITY,
    isCorporateGuest: false,
    idType: 'national_id',
    idNumber: '',
    visaExpiryDate: '',
    idDocuments: [],
    existingDocsStatus: 'idle',
    nidPhysicallyReceived: options?.forExistingGuest ? false : true,
    companions: [],
    corporateCompanions: [],
  }
}

function emptyReservationDraft(
  vatPercent = String(DEFAULT_VAT_PERCENT),
  forExistingGuest = false
): ReservationWizardDraft {
  const dates = defaultStayDates()
  return {
    step: 1,
    guest: emptyGuestDraft({ forExistingGuest }),
    stay: {
      selectedRoomId: '',
      checkInDate: dates.checkIn,
      checkOutDate: dates.checkOut,
      adults: '1',
      children: '0',
      withMeal: false,
    },
    payment: {
      advancePayment: '0',
      advancePaymentMethod: 'NONE',
      reservationNotes: '',
      chargesEditEnabled: false,
      vatPercent,
      serviceChargePercent: String(INVOICE_SERVICE_CHARGE_PERCENT),
      discountEnabled: false,
      discountType: 'PERCENTAGE',
      discountValue: '',
    },
  }
}

interface NewReservationWizardProps {
  editBookingId?: string
  initialRoomId?: string
  initialCheckInDate?: string
  initialCheckOutDate?: string
}

function toDatePickerValue(iso: string) {
  try {
    return format(parseISO(iso), 'yyyy-MM-dd')
  } catch {
    return format(new Date(iso), 'yyyy-MM-dd')
  }
}

export function NewReservationWizard({
  editBookingId,
  initialRoomId,
  initialCheckInDate,
  initialCheckOutDate,
}: NewReservationWizardProps = {}) {
  const queryClient = useQueryClient()
  const isEditMode = !!editBookingId
  const [completedReservationId, setCompletedReservationId] = useState<string | null>(null)
  const [checkedInOnConfirm, setCheckedInOnConfirm] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isInitialFlow, setIsInitialFlow] = useState(isEditMode)
  const [initialFlowFieldError, setInitialFlowFieldError] = useState<string[] | null>(null)
  const [guestMode, setGuestMode] = useState<GuestMode>(isEditMode ? 'existing' : 'new')
  const [flowMode, setFlowMode] = useState<'standard' | 'reservation_entry'>('standard')
  const [editDraftLoaded, setEditDraftLoaded] = useState(false)
  const [editFromReservationEntry, setEditFromReservationEntry] = useState(false)
  const [idEntryStarted, setIdEntryStarted] = useState(isEditMode)
  const [defaultVatPercent, setDefaultVatPercent] = useState(DEFAULT_VAT_PERCENT)
  const [defaultServicePercent, setDefaultServicePercent] = useState(INVOICE_SERVICE_CHARGE_PERCENT)
  const [paymentLines, setPaymentLines] = useState<ReservationPaymentLine[]>([])
  const [drafts, setDrafts] = useState<Record<GuestMode, ReservationWizardDraft>>(() => {
    const seedStayDates = (draft: ReservationWizardDraft): ReservationWizardDraft => {
      if (!initialCheckInDate || !initialCheckOutDate) return draft
      return {
        ...draft,
        stay: {
          ...draft.stay,
          checkInDate: initialCheckInDate,
          checkOutDate: initialCheckOutDate,
        },
      }
    }
    return {
      new: seedStayDates(emptyReservationDraft()),
      existing: seedStayDates(emptyReservationDraft(String(DEFAULT_VAT_PERCENT), true)),
    }
  })
  const { times, formatCheckIn, formatCheckOut } = useHotelTimes()
  const activeDraft = drafts[guestMode]
  const step = activeDraft.step
  const { guest, stay, payment } = activeDraft
  const {
    selectedCustomerId,
    guestName,
    guestCompany,
    companyLedgerId,
    guestPhone,
    guestEmail,
    guestAddress,
    guestDesignation,
    guestNationality,
    isCorporateGuest,
    idType,
    idNumber,
    visaExpiryDate,
    idDocuments,
    existingDocsStatus,
    nidPhysicallyReceived,
    companions,
    corporateCompanions,
  } = guest
  const hasCompanySelected = hasBookingCompany({
    companyLedgerId,
    company: guestCompany,
  })
  const { selectedRoomId, checkInDate, checkOutDate, adults, children, withMeal } = stay
  const {
    advancePayment,
    advancePaymentMethod,
    reservationNotes,
    chargesEditEnabled,
    vatPercent,
    serviceChargePercent,
    discountEnabled,
    discountType,
    discountValue,
  } = payment

  type DraftPatch = {
    step?: number
    guest?: Partial<GuestDraft>
    stay?: Partial<StayDraft>
    payment?: Partial<PaymentDraft>
  }

  const patchDraft = (patch: DraftPatch) => {
    setDrafts((prev) => {
      const cur = prev[guestMode]
      return {
        ...prev,
        [guestMode]: {
          ...cur,
          ...(patch.step !== undefined ? { step: patch.step } : {}),
          guest: patch.guest ? { ...cur.guest, ...patch.guest } : cur.guest,
          stay: patch.stay ? { ...cur.stay, ...patch.stay } : cur.stay,
          payment: patch.payment ? { ...cur.payment, ...patch.payment } : cur.payment,
        },
      }
    })
  }

  const patchDraftFor = (mode: GuestMode, patch: DraftPatch) => {
    setDrafts((prev) => {
      const cur = prev[mode]
      return {
        ...prev,
        [mode]: {
          ...cur,
          ...(patch.step !== undefined ? { step: patch.step } : {}),
          guest: patch.guest ? { ...cur.guest, ...patch.guest } : cur.guest,
          stay: patch.stay ? { ...cur.stay, ...patch.stay } : cur.stay,
          payment: patch.payment ? { ...cur.payment, ...patch.payment } : cur.payment,
        },
      }
    })
  }

  const patchGuest = (patch: Partial<GuestDraft>) => patchDraft({ guest: patch })

  const patchGuestStayCounts = (adultsValue: string, childrenValue: string) => {
    const nextAdults = Math.max(1, parseInt(adultsValue, 10) || 1)
    const nextChildren = Math.max(0, parseInt(childrenValue, 10) || 0)
    const guestPatch: Partial<GuestDraft> = isCorporateGuest
      ? {
          corporateCompanions: buildAdultCompanionSlots(nextAdults).map((_, index) => ({
            ...emptyCorporateCompanionDraft(),
            ...(corporateCompanions[index] ?? {}),
          })),
          companions: [],
        }
      : {
          companions: buildAdultCompanionSlots(nextAdults).map((_, index) => ({
            ...emptyCompanionDraft(),
            ...(companions[index] ?? {}),
          })),
          corporateCompanions: [],
        }
    patchDraft({
      stay: { adults: String(nextAdults), children: String(nextChildren) },
      guest: guestPatch,
    })
  }

  const handleNationalityChange = (value: string) => {
    const trimmed = value.trim()
    const isKnownCountry = NATIONALITY_OPTIONS.some(
      (country) => country.toLowerCase() === trimmed.toLowerCase()
    )
    const wasBangladesh = isBangladeshNationality(guestNationality)

    const guestPatch: Partial<GuestDraft> = { guestNationality: value }

    if (isKnownCountry) {
      const isNowBangladesh = isBangladeshNationality(trimmed)
      if (isNowBangladesh && !wasBangladesh) {
        guestPatch.idType = 'national_id'
      } else if (!isNowBangladesh) {
        guestPatch.idType = resolveIdTypeForNationality(trimmed, idType)
      } else {
        guestPatch.idType = resolveIdTypeForNationality(trimmed, idType)
      }
    }

    patchGuest(guestPatch)

    if (isKnownCountry && idDocuments.length === 0 && !idNumber.trim()) {
      revertToInitialStage(trimmed)
    }
  }
  const patchStay = (patch: Partial<StayDraft>) => {
    if (patch.adults !== undefined || patch.children !== undefined) {
      patchGuestStayCounts(
        patch.adults ?? adults,
        patch.children ?? children
      )
      return
    }
    patchDraft({ stay: patch })
  }

  const buildCompanionsPayload = (): CompanionInput[] => {
    const slots = buildAdultCompanionSlots(parseInt(adults, 10) || 1)
    return slots.map((slot, index) => {
      const companion = companions[index] ?? emptyCompanionDraft()
      return {
        companionType: slot.companionType,
        sortOrder: index,
        name: companion.name.trim(),
        phone: companion.phone.trim() || null,
        nationality: companion.guestNationality.trim() || DEFAULT_NATIONALITY,
        idType: companion.idType,
        idNumber: companion.idNumber.trim() || null,
        visaExpiryDate: null,
      }
    })
  }

  const buildCorporateCompanionsPayload = (): CompanionInput[] => {
    const slots = buildAdultCompanionSlots(parseInt(adults, 10) || 1)
    return slots.map((slot, index) => {
      const companion = corporateCompanions[index] ?? emptyCorporateCompanionDraft()
      return {
        companionType: slot.companionType,
        sortOrder: index,
        name: companion.name.trim(),
        company: companion.company.trim(),
        phone: companion.phone.trim(),
        designation: companion.designation.trim(),
        address: companion.address.trim(),
      }
    })
  }

  const companionValidationError = (): string | null => {
    const adultCount = parseInt(adults, 10) || 1
    const childCount = parseInt(children, 10) || 0
    if (isCorporateGuest) {
      const primaryMissing = getCorporateGuestMissingFields(corporateGuestFields())
      if (primaryMissing.length > 0) {
        return `Person 1: ${primaryMissing.join(', ')} required`
      }
      const primaryPhoneError = getPhoneValidationMessage(guestPhone, 'Person 1 phone')
      if (primaryPhoneError) return primaryPhoneError
      return validateCorporateCompanionInputs(
        adultCount,
        buildCorporateCompanionsPayload().map((c) => ({
          name: c.name,
          company: c.company ?? '',
          phone: c.phone ?? '',
          designation: c.designation ?? '',
          address: c.address ?? '',
        }))
      )
    }
    const expected = expectedCompanionCount(adultCount, childCount)
    if (expected === 0) return null
    return validateCompanionInputs(
      parseInt(adults, 10) || 1,
      parseInt(children, 10) || 0,
      buildCompanionsPayload(),
      { requireIdFields: !hasCompanySelected }
    )
  }
  const patchPayment = (patch: Partial<PaymentDraft>) => patchDraft({ payment: patch })
  const setStep = (nextStep: number) => patchDraft({ step: nextStep })

  const datesValid = stayDatesValid(checkInDate, checkOutDate)

  const { data: roomsData, isLoading: roomsLoading } = useQuery({
    queryKey: ['available-rooms', checkInDate, checkOutDate, editBookingId],
    queryFn: () =>
      api.get<RoomsAvailabilityResponse<Room>>(
        buildRoomsAvailabilityQueryUrl({
          checkIn: checkInDate,
          checkOut: checkOutDate,
          forBooking: true,
          excludeBookingId: isEditMode ? editBookingId : undefined,
        })
      ),
    enabled: datesValid,
  })

  const categoryCapacityByType = useMemo(() => {
    const map = new Map<
      string,
      { typeName: string; total: number; available: number; entryHeld: number }
    >()
    for (const row of roomsData?.meta?.categoryCapacity ?? []) {
      map.set(row.roomTypeId, row)
    }
    return map
  }, [roomsData?.meta?.categoryCapacity])

  const { data: editBookingData, isLoading: editBookingLoading } = useQuery({
    queryKey: ['edit-booking', editBookingId],
    queryFn: () =>
      api.get<{ success: boolean; data: Record<string, unknown> }>(`/bookings/${editBookingId}`),
    enabled: isEditMode,
  })

  useEffect(() => {
    if (!isEditMode || editDraftLoaded) return
    const booking = (editBookingData as { data?: Record<string, unknown> })?.data
    if (!booking) return

    const customer = booking.customer as Record<string, unknown> | undefined
    const room = booking.room as { id?: string } | undefined
    const idDocs = (booking.idDocuments as { filePath: string }[] | undefined) ?? []
    const adultCount = Math.max(1, parseInt(String(booking.adults ?? 1), 10) || 1)
    const childCount = Math.max(0, parseInt(String(booking.children ?? 0), 10) || 0)
    const rawCompanions =
      (booking.companions as Array<Record<string, unknown>> | undefined) ?? []
    const companionSlots = buildAdultCompanionSlots(adultCount)
    const adultOnlyCompanions = rawCompanions.filter(
      (c) => c.companionType !== 'CHILD'
    )
    const loadedCompanions = companionSlots.map((_, index) => {
      const companion = adultOnlyCompanions[index]
      if (!companion) return emptyCompanionDraft()
      const nationality = String(companion.nationality ?? DEFAULT_NATIONALITY)
      const idTypeRaw = companion.idType
      const resolvedType =
        idTypeRaw === 'passport' ||
        idTypeRaw === 'driving_license' ||
        idTypeRaw === 'national_id'
          ? (idTypeRaw as IdDocumentType)
          : 'national_id'
      return {
        name: String(companion.name ?? ''),
        phone: String(companion.phone ?? ''),
        guestNationality: nationality,
        idType: resolveIdTypeForNationality(nationality, resolvedType),
        idNumber: String(companion.idNumber ?? ''),
      }
    })
    const loadedCorporateCompanions = companionSlots.map((_, index) => {
      const companion = adultOnlyCompanions[index]
      if (!companion) return emptyCorporateCompanionDraft()
      return {
        name: String(companion.name ?? ''),
        company: String(companion.company ?? ''),
        phone: String(companion.phone ?? ''),
        designation: String(companion.designation ?? ''),
        address: String(companion.address ?? ''),
      }
    })

    setDrafts({
      new: emptyReservationDraft(String(booking.vatPercent ?? defaultVatPercent)),
      existing: {
        step: 1,
        guest: {
          selectedCustomerId: String(booking.customerId ?? ''),
          guestName: String(customer?.name ?? ''),
          guestCompany: formatGuestCompany(
            (booking.company as string | undefined) ?? (customer?.company as string | undefined)
          ),
          companyLedgerId: String(booking.companyLedgerId ?? ''),
          guestPhone: String(customer?.phone ?? ''),
          guestEmail: String(customer?.email ?? ''),
          guestAddress: String(customer?.address ?? ''),
          guestDesignation: String(customer?.designation ?? ''),
          guestNationality: String(customer?.nationality ?? DEFAULT_NATIONALITY),
          isCorporateGuest: booking.isCorporateGuest === true,
          idType: resolveIdTypeForNationality(
            String(customer?.nationality ?? DEFAULT_NATIONALITY),
            customer?.idType === 'passport' ||
              customer?.idType === 'driving_license' ||
              customer?.idType === 'national_id'
              ? (customer.idType as IdDocumentType)
              : 'national_id'
          ),
          idNumber: String(customer?.idNumber ?? ''),
          visaExpiryDate: '',
          idDocuments: idDocs.map((d) => ({ path: d.filePath, previewUrl: d.filePath })),
          existingDocsStatus: idDocs.length > 0 ? 'found' : 'none',
          nidPhysicallyReceived: booking.nidPhysicallyReceived === true,
          companions: booking.isCorporateGuest === true ? [] : loadedCompanions,
          corporateCompanions:
            booking.isCorporateGuest === true ? loadedCorporateCompanions : [],
        },
        stay: {
          selectedRoomId: String(room?.id ?? booking.roomId ?? ''),
          checkInDate: toDatePickerValue(String(booking.checkIn)),
          checkOutDate: toDatePickerValue(String(booking.checkOut)),
          adults: String(adultCount),
          children: String(childCount),
          withMeal: booking.withMeal === true,
        },
        payment: {
          advancePayment: '0',
          advancePaymentMethod: 'NONE',
          reservationNotes: String(booking.notes ?? ''),
          chargesEditEnabled: booking.vatApplied === true,
          vatPercent: String(booking.vatPercent ?? defaultVatPercent),
          serviceChargePercent: String(
            (booking as { serviceChargePercent?: number }).serviceChargePercent ??
              defaultServicePercent
          ),
          discountEnabled: (booking as { discountEnabled?: boolean }).discountEnabled === true,
          discountType:
            (booking as { discountType?: string }).discountType === 'FIXED'
              ? 'FIXED'
              : 'PERCENTAGE',
          discountValue: String((booking as { discountValue?: number }).discountValue ?? ''),
        },
      },
    })
    const advancePaid = Number(booking.advancePayment) || 0
    setPaymentLines(
      advancePaid > 0
        ? [{ id: 'edit-advance', amount: advancePaid, method: 'CASH' }]
        : []
    )
    const fromReservationEntry = Boolean(booking.sourceReservationEntryId)
    setEditFromReservationEntry(fromReservationEntry)
    setIsInitialFlow(fromReservationEntry ? booking.nidPhysicallyReceived !== true : true)
    setGuestMode('existing')
    setIdEntryStarted(true)
    setEditDraftLoaded(true)
  }, [isEditMode, editBookingData, editDraftLoaded, defaultVatPercent, defaultServicePercent])

  const { data: billingSettingsData } = useQuery({
    queryKey: ['billing-settings'],
    queryFn: () =>
      api.get<{
        success: boolean
        data: { vatPercent: number; serviceChargePercent: number; vatAppliedByDefault: boolean }
      }>('/settings/billing'),
  })

  useEffect(() => {
    const settings = (billingSettingsData as { data?: { vatPercent: number; serviceChargePercent?: number } })?.data
    if (settings?.vatPercent == null) return
    const rate = String(settings.vatPercent)
    const serviceRate = String(settings.serviceChargePercent ?? INVOICE_SERVICE_CHARGE_PERCENT)
    setDefaultVatPercent(settings.vatPercent)
    if (settings.serviceChargePercent != null) {
      setDefaultServicePercent(settings.serviceChargePercent)
    }
    setDrafts((prev) => ({
      new: {
        ...prev.new,
        payment: {
          ...prev.new.payment,
          vatPercent: prev.new.payment.chargesEditEnabled ? prev.new.payment.vatPercent : rate,
          serviceChargePercent: prev.new.payment.chargesEditEnabled
            ? prev.new.payment.serviceChargePercent
            : serviceRate,
        },
      },
      existing: {
        ...prev.existing,
        payment: {
          ...prev.existing.payment,
          vatPercent: prev.existing.payment.chargesEditEnabled
            ? prev.existing.payment.vatPercent
            : rate,
          serviceChargePercent: prev.existing.payment.chargesEditEnabled
            ? prev.existing.payment.serviceChargePercent
            : serviceRate,
        },
      },
    }))
  }, [billingSettingsData])

  const availableRooms = useMemo(() => {
    const rooms = (((roomsData as { data?: Room[] })?.data || []) as Room[]).filter(
      (room) => room.status !== 'MAINTENANCE' && room.status !== 'CLEANING'
    )

    if (!isEditMode || !selectedRoomId) return rooms
    if (rooms.some((r) => r.id === selectedRoomId)) return rooms

    const booking = (editBookingData as { data?: { room?: Room } })?.data
    const currentRoom = booking?.room
    if (currentRoom?.id === selectedRoomId) {
      return [...rooms, currentRoom]
    }
    return rooms
  }, [roomsData, isEditMode, selectedRoomId, editBookingData])

  const selectedStayRoom = useMemo(
    () => availableRooms.find((r) => r.id === selectedRoomId),
    [availableRooms, selectedRoomId]
  )

  useEffect(() => {
    if (selectedRoomId && !availableRooms.some((r) => r.id === selectedRoomId)) {
      patchStay({ selectedRoomId: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only clear stale room when availability changes
  }, [availableRooms, selectedRoomId, guestMode])

  useEffect(() => {
    if (isEditMode || !initialRoomId || selectedRoomId || roomsLoading) return
    if (availableRooms.some((r) => r.id === initialRoomId)) {
      patchStay({ selectedRoomId: initialRoomId })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- preselect room once when it is free for these dates
  }, [initialRoomId, isEditMode, availableRooms, selectedRoomId, roomsLoading])

  const resetForm = () => {
    setCompletedReservationId(null)
    setCheckedInOnConfirm(false)
    setIsInitialFlow(isEditMode)
    setInitialFlowFieldError(null)
    setIdEntryStarted(isEditMode)
    setGuestMode(isEditMode ? 'existing' : 'new')
    if (isEditMode) {
      setEditDraftLoaded(false)
      setEditFromReservationEntry(false)
    } else {
      setDrafts({
        new: emptyReservationDraft(String(defaultVatPercent)),
        existing: emptyReservationDraft(String(defaultVatPercent), true),
      })
    }
  }

  const handleScanComplete = (result: IdScanResult) => {
    if (guestMode !== 'new') return
    const patch: Partial<GuestDraft> = {}
    if (result.name) patch.guestName = result.name.trim()
    if (result.idNumber) patch.idNumber = result.idNumber.replace(/\D/g, '')
    if (result.idType) patch.idType = result.idType
    if (Object.keys(patch).length > 0) patchDraftFor('new', { guest: patch })
  }

  const revertToInitialStage = (nationalityOverride?: string) => {
    const nationality = nationalityOverride ?? guestNationality
    setIdEntryStarted(false)
    if (!isEditMode) {
      setIsInitialFlow(true)
      patchGuest({
        idNumber: '',
        idType: resolveIdTypeForNationality(nationality, 'national_id'),
      })
    }
  }

  const handleIdDocumentsChange = (docs: IdDocumentItem[]) => {
    if (docs.length > 0) {
      setIsInitialFlow(false)
      setIdEntryStarted(true)
      patchGuest({
        idDocuments: docs,
        ...(guestMode === 'existing' ? { existingDocsStatus: 'found' as const } : {}),
      })
      return
    }

    patchGuest({
      idDocuments: [],
      ...(guestMode === 'existing' ? { existingDocsStatus: 'none' as const } : {}),
    })
    revertToInitialStage()
  }

  const loadGuestIdDocuments = async (customerId: string) => {
    patchDraftFor('existing', { guest: { existingDocsStatus: 'loading' } })
    try {
      const res = (await api.get<{ success: boolean; data: { paths: string[] } }>(
        `/customers/${customerId}/id-documents`
      )) as { success?: boolean; data?: { paths: string[] } }
      const paths = res.data?.paths ?? []
      patchDraftFor('existing', {
        guest: {
          idDocuments: paths.map((path) => ({ path, previewUrl: path })),
          existingDocsStatus: paths.length > 0 ? 'found' : 'none',
        },
      })
    } catch {
      patchDraftFor('existing', {
        guest: { idDocuments: [], existingDocsStatus: 'none' },
      })
    }
  }

  const applyExistingGuest = (selected: GuestSearchResult) => {
    const idTypeValue =
      selected.idType === 'national_id' ||
      selected.idType === 'passport' ||
      selected.idType === 'driving_license'
        ? selected.idType
        : drafts.existing.guest.idType

    patchDraftFor('existing', {
      guest: {
        selectedCustomerId: selected.id,
        guestName: selected.name,
        guestCompany: formatGuestCompany(selected.company),
        guestPhone: selected.phone,
        guestEmail: selected.email || '',
        guestAddress: selected.address || '',
        guestNationality: selected.nationality?.trim() || DEFAULT_NATIONALITY,
        idType: resolveIdTypeForNationality(
          selected.nationality?.trim() || DEFAULT_NATIONALITY,
          idTypeValue
        ),
        idNumber: selected.idNumber || '',
      },
    })
    void loadGuestIdDocuments(selected.id)
  }

  const clearExistingGuest = () => {
    patchDraftFor('existing', { guest: emptyGuestDraft({ forExistingGuest: true }) })
  }

  const estimatedRoomCharge = () => {
    if (!checkInDate || !checkOutDate || !selectedRoomId) return 0
    const room = availableRooms.find((r) => r.id === selectedRoomId)
    if (!room) return 0
    try {
      const ci = applyHotelTimeToBookingInput(checkInDate, times.checkInTime)
      const co = applyHotelTimeToBookingInput(checkOutDate, times.checkOutTime)
      const nights = countHotelStayNights(ci, co)
      return nights * getRoomNightlyTotal(room)
    } catch {
      return 0
    }
  }

  const vatPayload = () => {
    const rate = Math.max(0, parseFloat(vatPercent) || defaultVatPercent)
    if (chargesEditEnabled && rate > 0) {
      return { vatApplied: true, vatPercent: rate }
    }
    return { vatApplied: false, vatPercent: 0 }
  }

  const resolvedServicePercent = () =>
    Math.max(0, parseFloat(serviceChargePercent) || defaultServicePercent)

  const totalAdvancePaid = () => paymentLines.reduce((sum, line) => sum + line.amount, 0)

  const handleRecordPayment = () => {
    const amount = parseFloat(advancePayment) || 0
    if (amount <= 0) {
      toast.error('Enter a payment amount greater than zero')
      return
    }
    if (advancePaymentMethod === 'NONE') {
      toast.error('Select a form of payment')
      return
    }
    setPaymentLines((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${prev.length}`,
        amount,
        method: advancePaymentMethod,
      },
    ])
    patchPayment({ advancePayment: '0' })
    toast.success('Payment recorded')
  }

  const vatOptions = () => vatPayload()

  const parsedDiscountValue = () => Math.max(0, parseFloat(discountValue) || 0)

  const discountInput = () => ({
    discountEnabled,
    discountType,
    discountValue: parsedDiscountValue(),
  })

  const estimatedTotals = () => {
    const roomCharge = estimatedRoomCharge()
    const advance = totalAdvancePaid()
    return computeRoomBookingTotals(roomCharge, advance, vatOptions(), discountInput())
  }

  const createCustomerMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/customers', data),
  })

  const createReservationMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/bookings', data),
  })

  const resolvedGuestNationality = () => guestNationality.trim() || DEFAULT_NATIONALITY

  const resolvedBookingCompany = () =>
    isCorporateGuest ? guestCompany.trim() : formatGuestCompany(guestCompany)

  const corporateGuestFields = () => ({
    guestName,
    guestCompany,
    guestPhone,
    guestDesignation,
    guestAddress,
  })

  const buildGuestProfilePayload = () => {
    if (isCorporateGuest) {
      return {
        name: guestName.trim(),
        company: guestCompany.trim() || null,
        phone: guestPhone.trim(),
        address: guestAddress.trim() || null,
        designation: guestDesignation.trim() || null,
        email: null,
        nationality: null,
        idType: null,
        idNumber: null,
        visaExpiryDate: null,
        idDocPath: null,
      }
    }

    return {
      name: guestName.trim(),
      company: formatGuestCompany(guestCompany),
      phone: guestPhone.trim(),
      email: guestEmail.trim() || null,
      address: guestAddress.trim() || null,
      nationality: resolvedGuestNationality(),
      idType,
      idNumber: idNumber.trim() || null,
      visaExpiryDate: null,
      idDocPath: idDocuments[0]?.path || null,
    }
  }

  const syncGuestProfile = async (customerId: string): Promise<boolean> => {
    const updateRes = (await api.put(`/customers/${customerId}`, buildGuestProfilePayload())) as {
      success?: boolean
      error?: string
    }

    if (!updateRes?.success) {
      toast.error(updateRes?.error || 'Failed to update guest profile')
      return false
    }

    return true
  }

  const resolveCustomerId = async (options?: {
    skipIdRequirement?: boolean
  }): Promise<string | null> => {
    if (isCorporateGuest) {
      const corporateMissing = getCorporateGuestMissingFields(corporateGuestFields())
      if (corporateMissing.length > 0) {
        toast.error(`Please fill required fields: ${corporateMissing.join(', ')}`)
        return null
      }
      const phoneError = getPhoneValidationMessage(guestPhone, 'Person 1 phone')
      if (phoneError) {
        toast.error(phoneError)
        return null
      }
    } else if (
      !options?.skipIdRequirement &&
      !nidPhysicallyReceived &&
      idDocuments.length === 0
    ) {
      toast.error('Upload or scan at least one ID image before continuing')
      return null
    }

    if (!isCorporateGuest && nidPhysicallyReceived && !hasCompanySelected) {
      const physicalMissing = getPhysicalIdMissingFields({ idNumber })
      if (physicalMissing.length > 0) {
        toast.error(`Required: ${physicalMissing.join(', ')}`)
        return null
      }
    }

    if (guestMode === 'existing') {
      if (!selectedCustomerId) {
        toast.error('Please select a guest')
        return null
      }
      if (!guestName.trim() || !guestPhone.trim()) {
        toast.error('Guest name and phone are required')
        return null
      }
      const existingPhoneError = getPhoneValidationMessage(guestPhone)
      if (existingPhoneError) {
        toast.error(existingPhoneError)
        return null
      }
      if (!isCorporateGuest && !resolvedGuestNationality()) {
        toast.error('Nationality is required')
        return null
      }

      if (!(await syncGuestProfile(selectedCustomerId))) {
        return null
      }

      return selectedCustomerId
    }

    if (!guestName.trim() || !guestPhone.trim()) {
      toast.error('Guest name and phone are required')
      return null
    }
    const phoneError = getPhoneValidationMessage(guestPhone)
    if (phoneError) {
      toast.error(phoneError)
      return null
    }
    if (!isCorporateGuest && !resolvedGuestNationality()) {
      toast.error('Nationality is required')
      return null
    }

    const res = (await createCustomerMutation.mutateAsync({
      ...buildGuestProfilePayload(),
      ...(isCorporateGuest
        ? {}
        : {
            email: guestEmail.trim() || undefined,
            address: guestAddress.trim() || undefined,
            idNumber: idNumber.trim() || undefined,
            idDocPath: idDocuments[0]?.path || undefined,
          }),
    })) as { success?: boolean; data?: { id: string }; error?: string; message?: string }

    if (!res?.success || !res.data?.id) {
      toast.error(res?.error || res?.message || 'Failed to create guest profile')
      return null
    }

    if (res.message?.includes('already exists')) {
      toast.info('Guest profile found for this phone — continuing with existing record.')
    }

    if (!(await syncGuestProfile(res.data.id))) {
      return null
    }

    return res.data.id
  }

  const finishReservation = (
    bookingId: string,
    withCheckIn: boolean,
    kind: 'initial' | 'full' | 'updated' | 'completed' = 'full'
  ) => {
    setCheckedInOnConfirm(withCheckIn)
    setCompletedReservationId(bookingId)
    patchDraft({ step: 5 })
    queryClient.invalidateQueries({ queryKey: ['bookings'] })
    queryClient.invalidateQueries({ queryKey: ['customers-list'] })
    queryClient.invalidateQueries({ queryKey: ['customers'] })
    queryClient.invalidateQueries({ queryKey: ['available-rooms'] })
    queryClient.invalidateQueries({ queryKey: ['available-rooms-entry'] })
    queryClient.invalidateQueries({ queryKey: ['reservation-entries-summary'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    queryClient.invalidateQueries({ queryKey: ['rooms'] })
      queryClient.invalidateQueries({ queryKey: ['edit-booking', bookingId] })
      queryClient.invalidateQueries({ queryKey: ['reservation-document', bookingId] })
      queryClient.invalidateQueries({ queryKey: ['company-ledger-options'] })
      queryClient.invalidateQueries({ queryKey: ['company-ledger'] })

    const messages: Record<typeof kind, string> = {
      initial: 'Initial reservation saved — complete ID details later from bookings',
      full: 'Reservation created — print or download your document below',
      updated: 'Initial reservation updated — print or download your document below',
      completed: 'Reservation completed — print or download your document below',
    }
    toast.success(
      withCheckIn ? 'Reservation confirmed and guest checked in' : messages[kind]
    )
  }

  const submitReservation = async (options: {
    withCheckIn?: boolean
    asInitial?: boolean
    completeInitial?: boolean
  }) => {
    const { withCheckIn = false, asInitial = false, completeInitial = false } = options

    const validationError = validateBeforeSubmit({ withCheckIn, asInitial, completeInitial })
    if (validationError) {
      toast.error(validationError)
      focusFirstInvalidStep({ withCheckIn, asInitial, completeInitial })
      return
    }

    const skipId =
      isCorporateGuest || asInitial || nidPhysicallyReceived
    const customerId = await resolveCustomerId({ skipIdRequirement: skipId })
    if (!customerId) return
    if (!selectedRoomId) {
      toast.error('Please select a room')
      return
    }
    if (!checkInDate || !checkOutDate) {
      toast.error('Check-in and check-out dates are required')
      return
    }

    const companionsPayload = isCorporateGuest
      ? buildCorporateCompanionsPayload()
      : buildCompanionsPayload()

    setIsSubmitting(true)
    try {
      const idPaths =
        idDocuments.length > 0 ? idDocuments.map((d) => d.path) : undefined

      if (isEditMode && editBookingId) {
        const res = (await api.put(`/bookings/${editBookingId}`, {
          company: resolvedBookingCompany(),
          roomId: selectedRoomId,
          checkIn: checkInDate,
          checkOut: checkOutDate,
          adults: parseInt(adults, 10),
          children: parseInt(children, 10),
          notes: reservationNotes.trim() || undefined,
          idDocumentPaths: idPaths,
          vatApplied: vatPayload().vatApplied,
          vatPercent: vatPayload().vatPercent,
          serviceChargePercent: resolvedServicePercent(),
          withMeal,
          discountEnabled,
          discountType,
          discountValue: discountEnabled ? parsedDiscountValue() : 0,
          isInitialReservation: completeInitial ? false : true,
          isCorporateGuest,
          nidPhysicallyReceived: isCorporateGuest ? false : nidPhysicallyReceived,
          companions: companionsPayload,
          customer: isCorporateGuest
            ? {
                name: guestName.trim(),
                phone: guestPhone.trim(),
                company: guestCompany.trim() || null,
                designation: guestDesignation.trim() || null,
                address: guestAddress.trim() || null,
              }
            : {
                name: guestName.trim(),
                phone: guestPhone.trim(),
                email: guestEmail.trim() || null,
                address: guestAddress.trim() || null,
                nationality: guestNationality.trim() || DEFAULT_NATIONALITY,
                idType,
                idNumber: idNumber.trim() || null,
                visaExpiryDate: null,
                idDocPath: idDocuments[0]?.path || null,
              },
        })) as { success?: boolean; data?: { id: string }; error?: string; message?: string }

        if (!res?.success) {
          toast.error(res?.error || res?.message || 'Failed to update reservation')
          return
        }

        finishReservation(
          editBookingId,
          false,
          completeInitial ? 'completed' : 'updated'
        )
        return
      }

      const saveAsInitial =
        !isCorporateGuest && (asInitial || (isInitialFlow && idDocuments.length === 0))

      const res = (await createReservationMutation.mutateAsync({
        customerId,
        company: resolvedBookingCompany(),
        companyLedgerId: isCorporateGuest ? undefined : companyLedgerId || undefined,
        roomId: selectedRoomId,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        adults: parseInt(adults, 10),
        children: parseInt(children, 10),
        advancePayment: totalAdvancePaid(),
        paymentMethod:
          paymentLines.length > 0
            ? paymentLines[paymentLines.length - 1].method
            : advancePaymentMethod,
        bookingPayments: paymentLines.map((line) => ({
          amount: line.amount,
          method: line.method,
        })),
        notes: reservationNotes.trim() || undefined,
        idDocumentPaths: isCorporateGuest ? undefined : idPaths,
        vatApplied: vatPayload().vatApplied,
        vatPercent: vatPayload().vatPercent,
        serviceChargePercent: resolvedServicePercent(),
        checkInNow: withCheckIn,
        isInitialReservation: saveAsInitial,
        isCorporateGuest,
        withMeal,
        discountEnabled,
        discountType,
        discountValue: discountEnabled ? parsedDiscountValue() : 0,
        nidPhysicallyReceived: isCorporateGuest ? false : nidPhysicallyReceived,
        companions: companionsPayload,
      })) as {
        success?: boolean
        data?: { id: string; status?: string }
        error?: string
        message?: string
      }

      if (!res?.success || !res.data?.id) {
        toast.error(res?.error || res?.message || 'Failed to create reservation')
        return
      }

      const bookingId = res.data.id
      let didCheckIn = withCheckIn && res.data.status === 'CHECKED_IN'

      if (withCheckIn && !didCheckIn) {
        const checkInRes = (await api.post(`/bookings/check-in/${bookingId}`, {
          initialPayment: 0,
          paymentMethod: 'CASH',
        })) as { success?: boolean; error?: string; message?: string }

        if (!checkInRes?.success) {
          toast.error(checkInRes?.error || checkInRes?.message || 'Reservation saved but check-in failed')
          finishReservation(bookingId, false, saveAsInitial ? 'initial' : 'full')
          return
        }
        didCheckIn = true
      }

      finishReservation(bookingId, didCheckIn, saveAsInitial ? 'initial' : 'full')
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : isEditMode
            ? 'Failed to update reservation'
            : 'Failed to create reservation'
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleConfirm = () => void submitReservation({ withCheckIn: false })
  const handleConfirmInitial = () => void submitReservation({ asInitial: true })
  const handleCompleteInitial = () => void submitReservation({ completeInitial: true })
  const handleConfirmWithCheckIn = () => void submitReservation({ withCheckIn: true })

  const hasRequiredIdDocs = idDocuments.length > 0
  const hasIdActivity = idDocuments.length > 0 || Boolean(idNumber.trim())
  const showCompleteRequiredMarkers = isEditMode
    ? hasIdActivity
    : !isInitialFlow && (hasIdActivity || nidPhysicallyReceived)
  const idNumberRequired =
    !hasCompanySelected && (nidPhysicallyReceived || showCompleteRequiredMarkers)
  const emailAddressRequired =
    showCompleteRequiredMarkers && !nidPhysicallyReceived && !hasCompanySelected
  const completeReservationMissing = getCompleteReservationMissingFields({
    nationality: guestNationality,
    idNumber,
    email: guestEmail,
    address: guestAddress,
    idDocumentCount: idDocuments.length,
    nidPhysicallyReceived,
    hasCompanySelected,
  })
  const canCompleteReservation = completeReservationMissing.length === 0
  const initialMissingFields = getInitialReservationGuestMissingFields(guestMode, {
    selectedCustomerId,
    guestName,
    guestPhone,
    guestNationality,
  })
  const showInitialReservationOption =
    !isCorporateGuest &&
    !isEditMode &&
    !nidPhysicallyReceived &&
    idDocuments.length === 0 &&
    !hasIdActivity

  const validateGuestStep = (options?: { forInitialSave?: boolean }): string | null => {
    const forInitialSave = options?.forInitialSave === true

    if (isCorporateGuest) {
      const corporateMissing = getCorporateGuestMissingFields(corporateGuestFields())
      if (corporateMissing.length > 0) {
        return `Please fill required fields: ${corporateMissing.join(', ')}`
      }
      const phoneError = getPhoneValidationMessage(guestPhone, 'Person 1 phone')
      if (phoneError) return phoneError
      const companionError = companionValidationError()
      if (companionError) return companionError
      return null
    }

    const initialMissing = getInitialReservationGuestMissingFields(guestMode, {
      selectedCustomerId,
      guestName,
      guestPhone,
      guestNationality,
    })
    if (initialMissing.length > 0) {
      return `Please fill required fields: ${initialMissing.join(', ')}`
    }

    const phoneError = getPhoneValidationMessage(guestPhone)
    if (phoneError) return phoneError

    const companionError = companionValidationError()
    if (companionError) return companionError

    if (forInitialSave || (isInitialFlow && !hasIdActivity && !nidPhysicallyReceived)) {
      return null
    }

    if (nidPhysicallyReceived && !hasCompanySelected) {
      const physicalMissing = getPhysicalIdMissingFields({ idNumber })
      if (physicalMissing.length > 0) {
        return `Required: ${physicalMissing.join(', ')}`
      }
      return null
    }

    if (!forInitialSave && idDocuments.length === 0) {
      return 'Upload or scan at least one ID image, or turn on “ID documents physically received”'
    }

    const completeMissing = getCompleteReservationMissingFields({
      nationality: guestNationality,
      idNumber,
      email: guestEmail,
      address: guestAddress,
      idDocumentCount: idDocuments.length,
      nidPhysicallyReceived,
      hasCompanySelected,
    })
    if (completeMissing.length > 0) {
      return `Please fill required fields: ${completeMissing.join(', ')}`
    }

    return null
  }

  const validateStayStep = (): string | null => {
    if (!checkInDate || !checkOutDate) {
      return 'Check-in and check-out dates are required'
    }
    if (!datesValid) {
      return 'Check-out date must be after check-in date'
    }
    if (roomsLoading) {
      return 'Loading available rooms — please wait'
    }
    if (!selectedRoomId) {
      return 'Please select a room'
    }
    if (!availableRooms.some((room) => room.id === selectedRoomId)) {
      return 'Selected room is not available for these dates — it may be blocked by a reservation entry or another booking'
    }
    const selectedRoom = availableRooms.find((room) => room.id === selectedRoomId)
    if (selectedRoom) {
      const cap = categoryCapacityByType.get(selectedRoom.typeId)
      if (cap && cap.available <= 0) {
        return `No ${cap.typeName} inventory left for these dates (${cap.entryHeld} held by reservation entries)`
      }
    }
    return null
  }

  const validatePaymentStep = (): string | null => {
    if (discountEnabled && parsedDiscountValue() <= 0) {
      return 'Enter a discount amount or turn off discount'
    }
    const pending = parseFloat(advancePayment) || 0
    if (pending > 0) {
      return 'Click Pay to record the payment amount, or clear the payment field to continue'
    }
    return null
  }

  const validateBeforeSubmit = (options: {
    asInitial?: boolean
    completeInitial?: boolean
    withCheckIn?: boolean
  }): string | null => {
    if (options.withCheckIn && options.asInitial) {
      return 'Initial reservations cannot be checked in immediately. Complete guest details first.'
    }

    const guestError = validateGuestStep({
      forInitialSave: options.asInitial === true && options.completeInitial !== true,
    })
    if (guestError) return guestError

    const stayError = validateStayStep()
    if (stayError) return stayError

    const paymentError = validatePaymentStep()
    if (paymentError) return paymentError

    if (options.completeInitial) {
      const missing = isCorporateGuest
        ? getCorporateGuestMissingFields(corporateGuestFields())
        : getCompleteReservationMissingFields({
            nationality: guestNationality,
            idNumber,
            email: guestEmail,
            address: guestAddress,
            idDocumentCount: idDocuments.length,
            nidPhysicallyReceived,
            hasCompanySelected,
          })
      if (missing.length > 0) {
        return `Please fill required fields: ${missing.join(', ')}`
      }
    }

    return null
  }

  const focusFirstInvalidStep = (options?: {
    asInitial?: boolean
    completeInitial?: boolean
    withCheckIn?: boolean
  }) => {
    const guestError = validateGuestStep({
      forInitialSave: options?.asInitial === true && options?.completeInitial !== true,
    })
    if (guestError) {
      setStep(1)
      return
    }
    if (validateStayStep()) {
      setStep(2)
      return
    }
    if (validatePaymentStep()) {
      setStep(3)
    }
  }

  const getCurrentStepValidationError = (): string | null => {
    if (step === 1) return validateGuestStep({ forInitialSave: isInitialFlow })
    if (step === 2) return validateStayStep()
    if (step === 3) return validatePaymentStep()
    return null
  }

  const stepValidationHint =
    step === 4
      ? validateBeforeSubmit({
          asInitial: isInitialFlow && !hasRequiredIdDocs,
        })
      : getCurrentStepValidationError()

  const canProceedToNextStep = step < 4 && !getCurrentStepValidationError()

  const handleNextStep = () => {
    const error = getCurrentStepValidationError()
    if (error) {
      toast.error(error)
      return
    }

    setStep(Math.min(4, step + 1))
  }

  useEffect(() => {
    if (initialMissingFields.length === 0) {
      setInitialFlowFieldError(null)
    }
  }, [initialMissingFields.length])

  const handleStartInitialReservation = () => {
    const error = validateGuestStep({ forInitialSave: true })
    if (error) {
      const missing = getInitialReservationGuestMissingFields(guestMode, {
        selectedCustomerId,
        guestName,
        guestPhone,
        guestNationality,
      })
      if (missing.length > 0) {
        setInitialFlowFieldError(missing)
      }
      toast.error(error)
      return
    }
    setInitialFlowFieldError(null)
    setIsInitialFlow(true)
    setStep(2)
  }
  const showGuestDetails = guestMode === 'new' || !!selectedCustomerId

  const displayStep = completedReservationId ? 5 : step

  if (isEditMode && editBookingLoading && !editDraftLoaded) {
    return <p className="text-sm text-muted-foreground">Loading reservation…</p>
  }

  if (!isEditMode && flowMode === 'reservation_entry') {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFlowMode('standard')}
          >
            Guest reservation
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            className="bg-amber-600 hover:bg-amber-700"
          >
            Reservation entry
          </Button>
        </div>
        <ReservationEntryWizard />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {STEP_LABELS.map((label, i) => {
          const s = i + 1
          return (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${
                  displayStep >= s ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground'
                }`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                    displayStep >= s ? 'bg-amber-600 text-white' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {displayStep > s ? '✓' : s}
                </span>
                {label}
              </div>
              {s < STEP_LABELS.length && (
                <div className={`hidden sm:block w-6 h-0.5 ${displayStep > s ? 'bg-amber-500' : 'bg-border'}`} />
              )}
            </div>
          )
        })}
      </div>

      {step < 4 && stepValidationHint && (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 print:hidden cursor-pointer"
          role="status"
          onClick={() => toast.error(stepValidationHint)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toast.error(stepValidationHint)
            }
          }}
          tabIndex={0}
        >
          {stepValidationHint}
        </div>
      )}

      {displayStep === 5 && completedReservationId ? (
        <div className="space-y-6">
          <Card className="border-emerald-200 bg-emerald-50 print:hidden">
            <CardContent className="p-4 flex items-start gap-3">
              <CheckCircle2 className="h-8 w-8 text-emerald-600 shrink-0" />
              <div>
                <h2 className="font-semibold text-emerald-900">
                  {checkedInOnConfirm ? 'Reservation confirmed & checked in' : 'Reservation confirmed'}
                </h2>
                <p className="text-sm text-emerald-800 mt-1">
                  {checkedInOnConfirm
                    ? 'Guest is checked in and the room is marked occupied. Print or download the document below.'
                    : 'Your reservation is saved. Print or download the document below, then close this tab or create another reservation.'}
                </p>
              </div>
            </CardContent>
          </Card>

          <ReservationDocumentView
            reservationId={completedReservationId}
            showToolbar
            onClose={() => window.close()}
          />

          <div className="flex flex-wrap gap-3 print:hidden">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                resetForm()
              }}
            >
              <Plus className="h-4 w-4" />
              Create another reservation
            </Button>
            <Button variant="ghost" onClick={() => window.close()}>
              Close tab
            </Button>
          </div>
        </div>
      ) : (
        <>
          {step === 1 && (
            <div className="space-y-4">
              <Card className="border-violet-200 bg-violet-50/40">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-violet-900">Corporate guest</p>
                      <p className="text-xs text-muted-foreground">
                        Company representative — name, company, phone, designation, and address only
                      </p>
                    </div>
                    <Switch
                      checked={isCorporateGuest}
                      onCheckedChange={(on) => {
                        const patch: Partial<GuestDraft> = { isCorporateGuest: on }
                        if (on) {
                          patch.companyLedgerId = ''
                          patch.companions = []
                          patch.corporateCompanions = buildAdultCompanionSlots(
                            parseInt(adults, 10) || 1
                          ).map((_, index) => ({
                            ...emptyCorporateCompanionDraft(),
                            ...(corporateCompanions[index] ?? {}),
                          }))
                          if (guestCompany === DEFAULT_GUEST_COMPANY) {
                            patch.guestCompany = ''
                          }
                          patch.nidPhysicallyReceived = false
                        } else {
                          patch.corporateCompanions = []
                        }
                        patchGuest(patch)
                        if (on) setGuestMode('new')
                        setIsInitialFlow(false)
                      }}
                      aria-label="Corporate guest"
                    />
                  </div>
                </CardContent>
              </Card>

              {!isEditMode && !isCorporateGuest && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={flowMode === 'standard' && guestMode === 'new' ? 'default' : 'outline'}
                    size="sm"
                    className={flowMode === 'standard' && guestMode === 'new' ? 'bg-amber-600 hover:bg-amber-700' : ''}
                    onClick={() => {
                      setFlowMode('standard')
                      setGuestMode('new')
                      setIsInitialFlow(false)
                    }}
                  >
                    New guest
                  </Button>
                  <Button
                    type="button"
                    variant={flowMode === 'standard' && guestMode === 'existing' ? 'default' : 'outline'}
                    size="sm"
                    className={flowMode === 'standard' && guestMode === 'existing' ? 'bg-amber-600 hover:bg-amber-700' : ''}
                    onClick={() => {
                      setFlowMode('standard')
                      setGuestMode('existing')
                      setIsInitialFlow(false)
                    }}
                  >
                    Existing guest
                  </Button>
                  <Button
                    type="button"
                    variant={flowMode === 'reservation_entry' ? 'default' : 'outline'}
                    size="sm"
                    className={flowMode === 'reservation_entry' ? 'bg-amber-600 hover:bg-amber-700' : ''}
                    onClick={() => setFlowMode('reservation_entry')}
                  >
                    Reservation entry
                  </Button>
                </div>
              )}
              {isEditMode && !isCorporateGuest && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {editFromReservationEntry && nidPhysicallyReceived ? (
                    <>
                      This room was converted from a multi-room reservation entry —{' '}
                      <strong>ID physically received</strong> is on. Enter this guest&apos;s real
                      name, phone, and ID/passport (walk-in only), then save. Upload scanned ID
                      from the bookings list before checkout.
                    </>
                  ) : (
                    <>
                      Editing initial reservation — fill all fields marked * (
                      {idNumberRequired ? 'ID / passport number, ' : ''}
                      {nidPhysicallyReceived ? '' : 'email, address, '}
                      and ID documents if applicable), then use Complete reservation before check-in.
                    </>
                  )}
                </div>
              )}

              {!isCorporateGuest && guestMode === 'existing' && (
                <>
                  <GuestSearchField
                    selectedId={selectedCustomerId}
                    selectedLabel={
                      selectedCustomerId
                        ? `${guestName || 'Guest'}${guestPhone ? ` — ${guestPhone}` : ''}`
                        : undefined
                    }
                    onSelect={applyExistingGuest}
                    onClear={clearExistingGuest}
                  />
                  {!selectedCustomerId && (
                    <p className="text-sm text-muted-foreground">
                      Search and select a guest to load their profile and ID documents.
                    </p>
                  )}
                </>
              )}

              {showGuestDetails && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Adults *</Label>
                      <Input
                        type="number"
                        min={1}
                        value={adults}
                        onChange={(e) => patchGuestStayCounts(e.target.value, children)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Children</Label>
                      <Input
                        type="number"
                        min={0}
                        value={children}
                        onChange={(e) => patchGuestStayCounts(adults, e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Count only — no guest details required for children.
                      </p>
                    </div>
                  </div>

                  {isCorporateGuest ? (
                    <>
                      <CorporateCompanionGuestFields
                        label="Person 1 (Primary guest)"
                        value={{
                          name: guestName,
                          company: guestCompany,
                          phone: guestPhone,
                          designation: guestDesignation,
                          address: guestAddress,
                        }}
                        onChange={(patch) =>
                          patchGuest({
                            ...(patch.name !== undefined ? { guestName: patch.name } : {}),
                            ...(patch.company !== undefined ? { guestCompany: patch.company } : {}),
                            ...(patch.phone !== undefined ? { guestPhone: patch.phone } : {}),
                            ...(patch.designation !== undefined
                              ? { guestDesignation: patch.designation }
                              : {}),
                            ...(patch.address !== undefined ? { guestAddress: patch.address } : {}),
                          })
                        }
                      />
                      {buildAdultCompanionSlots(parseInt(adults, 10) || 1).map((slot, index) => (
                        <CorporateCompanionGuestFields
                          key={`${slot.companionType}-${index}`}
                          label={`Person ${index + 2} (${slot.label})`}
                          value={corporateCompanions[index] ?? emptyCorporateCompanionDraft()}
                          onChange={(patch) => {
                            const next = [...corporateCompanions]
                            next[index] = {
                              ...(next[index] ?? emptyCorporateCompanionDraft()),
                              ...patch,
                            }
                            patchGuest({ corporateCompanions: next })
                          }}
                        />
                      ))}
                    </>
                  ) : (
                    <>
                  <Card className="border-sky-200 bg-sky-50/40">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-sky-900">ID documents physically received</p>
                          <p className="text-xs text-muted-foreground">
                            When on, upload ID documents from the bookings list before checkout.
                            {hasCompanySelected
                              ? ' Company guests do not need ID/passport numbers here.'
                              : ' Direct/walk-in guests must enter ID/passport details.'}
                          </p>
                        </div>
                        <Switch
                          checked={nidPhysicallyReceived}
                          onCheckedChange={(on) => patchGuest({ nidPhysicallyReceived: on })}
                          aria-label="ID documents physically received"
                        />
                      </div>
                    </CardContent>
                  </Card>

                  {existingDocsStatus === 'loading' && (
                    <p className="text-sm text-muted-foreground">Loading previous ID files…</p>
                  )}
                  {guestMode === 'existing' &&
                    existingDocsStatus === 'none' &&
                    showInitialReservationOption &&
                    !isInitialFlow && (
                      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        No previous ID files found for this guest. Upload ID documents or use{' '}
                        <strong>Initial reservation</strong> to continue without ID for now.
                      </div>
                    )}
                  {guestMode === 'new' && showInitialReservationOption && !isInitialFlow && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      Upload or scan at least one ID image to continue — or use{' '}
                      <strong>Initial reservation</strong> below to save without ID for now.
                    </div>
                  )}
                  {isInitialFlow && showInitialReservationOption && (
                    <div className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                      <strong>Initial reservation</strong> — guest name, phone, and nationality for
                      now. ID documents can be added later before check-in. Missing fields will
                      show on the confirmation document.
                    </div>
                  )}

                  <NationalityField
                    value={guestNationality}
                    onChange={handleNationalityChange}
                    label="Nationality *"
                    placeholder="Select nationality…"
                  />

                  {showCompleteRequiredMarkers && (
                    <p className="text-sm font-medium text-foreground">ID document images *</p>
                  )}

                  {!nidPhysicallyReceived && (
                  <IdDocumentScanner
                nationality={guestNationality}
                idType={idType}
                onIdTypeChange={(type) => {
                  patchGuest({ idType: type })
                  if (idDocuments.length > 0 || idNumber.trim()) {
                    setIsInitialFlow(false)
                    setIdEntryStarted(true)
                  } else if (type === 'passport' || type === 'driving_license') {
                    setIsInitialFlow(false)
                    setIdEntryStarted(true)
                  } else if (idDocuments.length === 0 && !idNumber.trim()) {
                    revertToInitialStage()
                  }
                }}
                documents={idDocuments}
                onDocumentsChange={handleIdDocumentsChange}
                onScanComplete={(result) => {
                  if (result.documents.length > 0) {
                    setIsInitialFlow(false)
                    setIdEntryStarted(true)
                    handleScanComplete(result)
                  } else {
                    revertToInitialStage()
                  }
                }}
              />
                  )}

              <p className="text-sm font-semibold text-foreground">Person 1 (Primary guest)</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Full name *</Label>
                      <Input
                        value={guestName}
                        onChange={(e) => patchGuest({ guestName: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Company</Label>
                      <CompanyLedgerSearchField
                        selectedLedgerId={companyLedgerId}
                        selectedLabel={guestCompany}
                        onSelect={(company) =>
                          patchGuest({
                            companyLedgerId: company.id,
                            guestCompany: company.name,
                          })
                        }
                        onClear={() =>
                          patchGuest({
                            companyLedgerId: '',
                            guestCompany: DEFAULT_GUEST_COMPANY,
                          })
                        }
                      />
                      {companyLedgerId ? (
                        <p className="text-xs text-muted-foreground">
                          Guest will be added to this company ledger on reservation. Checkout can be
                          billed to the company without payment.
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      <Label>
                        ID / Passport number{idNumberRequired ? ' *' : ''}
                      </Label>
                      <Input
                        value={idNumber}
                        onChange={(e) => {
                          const value = e.target.value
                          if (value.trim()) {
                            setIsInitialFlow(false)
                            setIdEntryStarted(true)
                          } else if (idDocuments.length === 0) {
                            revertToInitialStage()
                          }
                          patchGuest({ idNumber: value })
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Phone *</Label>
                      <Input
                        id={guestMode === 'new' ? 'guest-phone' : undefined}
                        value={guestPhone}
                        onChange={(e) => patchGuest({ guestPhone: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Email{emailAddressRequired ? ' *' : ''}</Label>
                      <EmailInput
                        value={guestEmail}
                        onChange={(email) => patchGuest({ guestEmail: email })}
                        optional={!emailAddressRequired}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Address{emailAddressRequired ? ' *' : ''}</Label>
                      <Input
                        value={guestAddress}
                        onChange={(e) => patchGuest({ guestAddress: e.target.value })}
                      />
                    </div>
                {idDocuments.length > 0 ? (
                  <p className="text-xs text-emerald-600 sm:col-span-2">
                    {idDocuments.length} ID image(s) attached — included on confirmation page 2
                  </p>
                ) : nidPhysicallyReceived ? (
                  <p className="text-xs text-sky-700 sm:col-span-2">
                    Physical ID documents will be collected — upload scanned copies from the bookings list before checkout.
                  </p>
                ) : isInitialFlow ? (
                  <p className="text-xs text-sky-700 sm:col-span-2">
                    ID images optional for initial reservation
                    {showCompleteRequiredMarkers ? ' (required * to complete)' : ' — add before check-in'}.
                  </p>
                ) : (
                  <p className="text-xs text-amber-700 sm:col-span-2">
                    At least one ID image is required, or continue as initial reservation below.
                  </p>
                )}
              </div>

              {!isCorporateGuest && buildAdultCompanionSlots(parseInt(adults, 10) || 1).length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Additional guests (children are recorded by count only).
                </p>
              )}
              {!isCorporateGuest &&
                buildAdultCompanionSlots(parseInt(adults, 10) || 1).map((slot, index) => (
                  <CompanionGuestFields
                    key={`${slot.companionType}-${index}`}
                    label={slot.label}
                    value={companions[index] ?? emptyCompanionDraft()}
                    requireId={!hasCompanySelected}
                    onChange={(patch) => {
                      const next = [...companions]
                      next[index] = { ...(next[index] ?? emptyCompanionDraft()), ...patch }
                      patchGuest({ companions: next })
                    }}
                  />
                ))}
                    </>
                  )}
                </>
              )}
              {showInitialReservationOption && (
                <>
                  {initialFlowFieldError && initialFlowFieldError.length > 0 && (
                    <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
                      <p className="font-medium">Required fields to continue as initial reservation:</p>
                      <ul className="mt-1 list-disc pl-5">
                        {initialFlowFieldError.map((field) => (
                          <li key={field}>{field}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-sky-400 text-sky-800 hover:bg-sky-50"
                    onClick={handleStartInitialReservation}
                  >
                    <FilePenLine className="h-4 w-4 mr-2" />
                    Continue as initial reservation (without ID for now)
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    Requires full name, phone, and nationality
                    {guestMode === 'existing' ? ', and guest selection' : ''}. ID documents can
                    be added later.
                  </p>
                </>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground rounded-md bg-muted/50 p-2">
                {describeStayPeriod(times)}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Arrival date *</Label>
                  <Input
                    type="date"
                    value={checkInDate}
                    onChange={(e) => {
                      const nextIn = e.target.value
                      const patch: Partial<StayDraft> = { checkInDate: nextIn }
                      const minOut = minCheckoutDatePickerValue(nextIn)
                      if (minOut && checkOutDate && checkOutDate <= nextIn) {
                        patch.checkOutDate = minOut
                      }
                      patchStay(patch)
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Check-in from {formatTime12h(times.checkInTime)}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Departure date *</Label>
                  <Input
                    type="date"
                    min={minCheckoutDatePickerValue(checkInDate)}
                    value={checkOutDate}
                    onChange={(e) => patchStay({ checkOutDate: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Check-out by {formatTime12h(times.checkOutTime)} on this day
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Room *</Label>
                  <Select
                    value={selectedRoomId}
                    onValueChange={(value) => patchStay({ selectedRoomId: value })}
                    disabled={!datesValid || roomsLoading}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          !datesValid
                            ? 'Select valid check-in and check-out dates'
                            : roomsLoading
                              ? 'Loading available rooms...'
                              : availableRooms.length === 0
                                ? 'No rooms available for these dates'
                                : 'Choose room'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {availableRooms.map((r) => {
                        const cap = categoryCapacityByType.get(r.typeId)
                        const availHint =
                          cap && cap.entryHeld > 0
                            ? ` · ${cap.available}/${cap.total} available`
                            : ''
                        return (
                          <SelectItem key={r.id} value={r.id}>
                            Room {r.roomNumber} — {r.type.name}
                            {availHint}
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Room rent</Label>
                  <Input
                    readOnly
                    tabIndex={-1}
                    value={
                      selectedStayRoom
                        ? `৳${getRoomNightlyTotal(selectedStayRoom).toLocaleString()} / night (incl.)`
                        : 'Select a room to see rent'
                    }
                    className="bg-muted/40 cursor-default focus-visible:ring-0"
                  />
                  <p className="text-xs text-muted-foreground">
                    Inclusive of VAT & service charge
                  </p>
                </div>
              </div>
              {datesValid && !roomsLoading && (
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>
                    {availableRooms.length} room{availableRooms.length === 1 ? '' : 's'} available for
                    this stay
                  </p>
                  {(roomsData as { meta?: { categoryCapacity?: Array<{
                    typeName: string
                    total: number
                    available: number
                    entryHeld: number
                  }> } })?.meta?.categoryCapacity
                    ?.filter((row) => row.entryHeld > 0)
                    .map((row) => (
                      <p key={row.typeName}>
                        {row.typeName}: {row.available} bookable · {row.entryHeld} held by reservation
                        entries (of {row.total})
                      </p>
                    ))}
                </div>
              )}
              <Card className="border-amber-200 bg-amber-50/40">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-amber-900">Meal plan</p>
                      <p className="text-xs text-muted-foreground">
                        {withMeal
                          ? 'Full board with breakfast complimentary — shown on confirmation document'
                          : 'Breakfast (complementary) — shown on confirmation document'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-xs font-medium ${!withMeal ? 'text-amber-900' : 'text-muted-foreground'}`}
                      >
                        Without meal
                      </span>
                      <Switch
                        checked={withMeal}
                        onCheckedChange={(on) => patchStay({ withMeal: on })}
                        aria-label="With meal"
                      />
                      <span
                        className={`text-xs font-medium ${withMeal ? 'text-amber-900' : 'text-muted-foreground'}`}
                      >
                        With meal
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-amber-800">
                    Meal plan on document:{' '}
                    <strong>{formatReservationMealPlan(withMeal)}</strong>
                  </p>
                </CardContent>
              </Card>
              {estimatedRoomCharge() > 0 && (
                <Card className="bg-amber-50 border-amber-200">
                  <CardContent className="p-3 text-sm font-medium text-amber-800">
                    Estimated room total: ৳{estimatedTotals().totalWithVat.toLocaleString()}
                    {' '}(inclusive rate — VAT & service charge included)
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <Card className="border-emerald-200 bg-emerald-50/40">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-emerald-900">Discount</p>
                      <p className="text-xs text-muted-foreground">
                        Applied to the inclusive room charge
                      </p>
                    </div>
                    <Switch
                      checked={discountEnabled}
                      onCheckedChange={(on) => {
                        patchPayment({
                          discountEnabled: on,
                          ...(!on ? { discountValue: '' } : {}),
                        })
                      }}
                    />
                  </div>
                  {discountEnabled && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Discount type</Label>
                        <Select
                          value={discountType}
                          onValueChange={(value) =>
                            patchPayment({ discountType: value as BookingDiscountType })
                          }
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
                          onChange={(e) => patchPayment({ discountValue: e.target.value })}
                          placeholder={discountType === 'PERCENTAGE' ? 'e.g. 10' : 'e.g. 500'}
                          className="h-9 bg-card"
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card className="border-violet-200 bg-violet-50/40">
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex items-center gap-2 pb-1">
                      <Switch
                        checked={chargesEditEnabled}
                        onCheckedChange={(on) => patchPayment({ chargesEditEnabled: on })}
                        aria-label="Edit VAT and service charge"
                      />
                      <Label className="text-sm font-semibold text-violet-900">Edit charges</Label>
                    </div>
                    <div className="space-y-1 min-w-[7rem]">
                      <Label className="text-xs">VAT %</Label>
                      <Input
                        type="text"
                        inputMode="decimal"
                        disabled={!chargesEditEnabled}
                        value={vatPercent}
                        onChange={(e) => patchPayment({ vatPercent: e.target.value })}
                        className="h-9 bg-card"
                      />
                    </div>
                    <div className="space-y-1 min-w-[7rem]">
                      <Label className="text-xs">Service %</Label>
                      <Input
                        type="text"
                        inputMode="decimal"
                        disabled={!chargesEditEnabled}
                        value={serviceChargePercent}
                        onChange={(e) => patchPayment({ serviceChargePercent: e.target.value })}
                        className="h-9 bg-card"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Turn on Edit charges to override VAT and service percentages on this reservation.
                  </p>
                </CardContent>
              </Card>
              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 items-end">
                <div className="space-y-2">
                  <Label htmlFor="reservation-payment-amount">Payment amount (BDT)</Label>
                  <Input
                    id="reservation-payment-amount"
                    type="number"
                    min={0}
                    className="h-10"
                    value={advancePayment}
                    onChange={(e) => patchPayment({ advancePayment: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reservation-payment-method">Form of payment</Label>
                  <Select
                    value={advancePaymentMethod}
                    onValueChange={(value) => patchPayment({ advancePaymentMethod: value })}
                  >
                    <SelectTrigger id="reservation-payment-method" className="h-10 w-full">
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
                  className="h-10 w-full bg-emerald-600 hover:bg-emerald-700 text-white sm:w-auto sm:min-w-[5.5rem]"
                  onClick={handleRecordPayment}
                >
                  Pay
                </Button>
              </div>
              {paymentLines.length > 0 && (
                <Card className="border-emerald-200">
                  <CardContent className="p-3 space-y-2">
                    <p className="text-sm font-semibold text-emerald-900">Payments recorded</p>
                    {paymentLines.map((line) => (
                      <div key={line.id} className="flex justify-between text-sm">
                        <span>{formatPaymentMethod(line.method)}</span>
                        <span className="font-medium">৳{line.amount.toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-sm font-semibold border-t pt-2">
                      <span>Total paid</span>
                      <span>৳{totalAdvancePaid().toLocaleString()}</span>
                    </div>
                  </CardContent>
                </Card>
              )}
              <Card className="bg-muted/50">
                <CardContent className="p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Room charge</span>
                    <span>৳{estimatedRoomCharge().toLocaleString()}</span>
                  </div>
                  {discountEnabled && estimatedTotals().discountAmount > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>
                        Discount
                        {discountType === 'PERCENTAGE' ? ` (${parsedDiscountValue()}%)` : ''}
                      </span>
                      <span>-৳{estimatedTotals().discountAmount.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-muted-foreground">
                    <span>VAT ({chargesEditEnabled ? vatPercent : 'incl.'}%)</span>
                    <span>
                      {chargesEditEnabled && estimatedTotals().vatAmount > 0
                        ? `৳${estimatedTotals().vatAmount.toLocaleString()}`
                        : 'Included'}
                    </span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Service ({serviceChargePercent}%)</span>
                    <span>Included in rate</span>
                  </div>
                  <div className="flex justify-between font-medium border-t pt-2">
                    <span>Room total</span>
                    <span>৳{estimatedTotals().totalWithVat.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total paid</span>
                    <span>৳{totalAdvancePaid().toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t pt-2">
                    <span>Due</span>
                    <span className="text-red-600">
                      ৳{estimatedTotals().dueAmount.toLocaleString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={reservationNotes}
                  onChange={(e) => patchPayment({ reservationNotes: e.target.value })}
                  rows={2}
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <Card>
              <CardContent className="p-4 space-y-2 text-sm">
                {stepValidationHint && (
                  <div
                    className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
                    role="alert"
                  >
                    {stepValidationHint}
                  </div>
                )}
                <h3 className="font-semibold">Reservation summary</h3>
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">Guest</span>
                  <span className="font-medium">
                    {guestName || '—'}
                  </span>
                  <span className="text-muted-foreground">Company</span>
                  <span>{isCorporateGuest ? guestCompany || '—' : formatGuestCompany(guestCompany)}</span>
                  {isCorporateGuest && (
                    <>
                      <span className="text-muted-foreground">Designation</span>
                      <span>{guestDesignation || '—'}</span>
                      <span className="text-muted-foreground">Phone</span>
                      <span>{guestPhone || '—'}</span>
                      <span className="text-muted-foreground">Address</span>
                      <span>{guestAddress || '—'}</span>
                    </>
                  )}
                  <span className="text-muted-foreground">Adults</span>
                  <span>{adults}</span>
                  <span className="text-muted-foreground">Children</span>
                  <span>{children}</span>
                  <span className="text-muted-foreground">Room</span>
                  <span>{availableRooms.find((r) => r.id === selectedRoomId)?.roomNumber}</span>
                  <span className="text-muted-foreground">Check-in</span>
                  <span>{checkInDate ? formatBookingDateOnly(checkInDate) : '—'}</span>
                  <span className="text-muted-foreground">Check-out</span>
                  <span>{checkOutDate ? formatBookingDateOnly(checkOutDate) : '—'}</span>
                  <span className="text-muted-foreground">Nights</span>
                  <span>
                    {datesValid
                      ? countHotelStayNights(
                          applyHotelTimeToBookingInput(checkInDate, times.checkInTime),
                          applyHotelTimeToBookingInput(checkOutDate, times.checkOutTime)
                        )
                      : '—'}
                  </span>
                  <span className="text-muted-foreground">Meal plan</span>
                  <span>{formatReservationMealPlan(withMeal)}</span>
                  <span className="text-muted-foreground">VAT / Service</span>
                  <span>
                    {chargesEditEnabled
                      ? `${vatPercent}% VAT · ${serviceChargePercent}% service`
                      : 'Included in room rate'}
                  </span>
                  {discountEnabled && estimatedTotals().discountAmount > 0 && (
                    <>
                      <span className="text-muted-foreground">Discount</span>
                      <span className="text-emerald-700">
                        -৳{estimatedTotals().discountAmount.toLocaleString()}
                      </span>
                    </>
                  )}
                  <span className="text-muted-foreground">
                    Total (incl. VAT)
                  </span>
                  <span>৳{estimatedTotals().totalWithVat.toLocaleString()}</span>
                  <span className="text-muted-foreground">
                    Due (incl. VAT)
                  </span>
                  <span className="text-red-600 font-medium">
                    ৳{estimatedTotals().dueAmount.toLocaleString()}
                  </span>
                  <span className="text-muted-foreground">Total paid</span>
                  <span>৳{totalAdvancePaid().toLocaleString()}</span>
                  {paymentLines.length > 0 && (
                    <>
                      <span className="text-muted-foreground">Payments</span>
                      <span>
                        {paymentLines
                          .map((p) => `${formatPaymentMethod(p.method)} ৳${p.amount.toLocaleString()}`)
                          .join(' · ')}
                      </span>
                    </>
                  )}
                </div>
                <p className="text-xs text-muted-foreground pt-2">
                  {isInitialFlow && !hasRequiredIdDocs ? (
                    <>
                      Use <strong>Save initial reservation</strong> to save without ID. You can edit
                      and complete guest details from bookings before check-in.
                    </>
                  ) : isEditMode ? (
                    <>
                      Use <strong>Save changes</strong> to keep as initial, or{' '}
                      <strong>Complete reservation</strong> when all fields marked * are filled,
                      including ID images.
                    </>
                  ) : (
                    <>
                      Use <strong>Confirm reservation</strong> to save as reserved only, or{' '}
                      <strong>Confirm reservation with check-in</strong> to check the guest in
                      immediately (room marked occupied).
                    </>
                  )}
                </p>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t">
            {step > 1 && (
              <Button variant="outline" onClick={() => setStep(Math.max(1, step - 1))}>
                Back
              </Button>
            )}
            {step < 4 ? (
              <Button
                type="button"
                className="bg-amber-600 hover:bg-amber-700 text-white ml-auto disabled:opacity-50"
                disabled={!canProceedToNextStep}
                onClick={handleNextStep}
              >
                Next
              </Button>
            ) : (
              <>
                {isEditMode ? (
                  <>
                    <Button
                      variant="outline"
                      className="ml-auto"
                      disabled={isSubmitting}
                      onClick={() => void submitReservation({})}
                    >
                      {isSubmitting ? 'Please wait...' : 'Save changes'}
                    </Button>
                    <Button
                      className="bg-amber-600 hover:bg-amber-700 text-white"
                      disabled={isSubmitting}
                      onClick={handleCompleteInitial}
                    >
                      {isSubmitting ? 'Please wait...' : 'Complete reservation'}
                    </Button>
                  </>
                ) : isInitialFlow && !hasRequiredIdDocs ? (
                  <Button
                    className="bg-sky-600 hover:bg-sky-700 text-white ml-auto"
                    disabled={isSubmitting || createCustomerMutation.isPending}
                    onClick={handleConfirmInitial}
                  >
                    {isSubmitting ? 'Please wait...' : 'Save initial reservation'}
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      className="ml-auto"
                      disabled={isSubmitting || createCustomerMutation.isPending}
                      onClick={handleConfirm}
                    >
                      {isSubmitting ? 'Please wait...' : 'Confirm reservation'}
                    </Button>
                    <Button
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      disabled={isSubmitting || createCustomerMutation.isPending}
                      onClick={handleConfirmWithCheckIn}
                    >
                      <LogIn className="h-4 w-4 mr-2" />
                      {isSubmitting ? 'Processing...' : 'Confirm reservation with check-in'}
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}


