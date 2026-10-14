import { addDays, format, parseISO } from 'date-fns'
import { db } from '@/lib/db'
import {
  buildPoliceInHouseOnBusinessDayWhere,
  formatBusinessDateDisplay,
  isValidBusinessDateString,
} from '@/lib/business-date'
import { expectedCompanionCount } from '@/lib/booking-companions'
import { getBookingSourceLabel } from '@/lib/booking-company'
import { DEFAULT_NATIONALITY, formatGuestId } from '@/lib/id-type-label'
import { DEFAULT_GUEST_COMPANY } from '@/lib/reservation-terms'
import { resolveBusinessDayReportWindow, type BusinessDayWindow } from '@/lib/hotel-pms-reports'

type PoliceCompanyBooking = {
  company: string | null
  companyLedgerId: string | null
  companyLedger?: { name: string } | null
}

function resolvePoliceGuestCompany(
  booking: PoliceCompanyBooking,
  guestCompany?: string | null
): string {
  const guest = guestCompany?.trim()
  if (guest && guest !== DEFAULT_GUEST_COMPANY) return guest
  return getBookingSourceLabel(booking)
}

export type PoliceReportGuestRole = 'primary' | 'companion' | 'child' | 'unregistered'

export type PoliceReportGuestRow = {
  id: string
  bookingId: string
  guestName: string
  mobile: string | null
  idDocument: string
  address: string | null
  nationality: string | null
  company: string
  roomNumber: string
  checkInAt: string | null
  checkInAtDisplay: string
  businessDate?: string
  /** @deprecated Use guestRole */
  isCompanion: boolean
  guestRole: PoliceReportGuestRole
}

export type HotelPoliceReport = {
  reportType: 'hotel-police-report'
  businessDate: string
  businessDateDisplay: string
  dateFrom?: string
  dateTo?: string
  totalCheckIns: number
  guestCount: number
  adultCount: number
  childCount: number
  guests: PoliceReportGuestRow[]
}

function formatCheckInDisplay(value: Date | null | undefined): { iso: string | null; display: string } {
  if (!value || Number.isNaN(value.getTime())) {
    return { iso: null, display: '—' }
  }
  return {
    iso: value.toISOString(),
    display: format(value, 'dd MMM yyyy, HH:mm'),
  }
}

function isBlankOrNa(value: string | null | undefined): boolean {
  if (!value) return true
  const v = value.trim().toUpperCase()
  return v === '' || v === 'N/A' || v === 'NA' || v === '—' || v === '-'
}

function resolvePoliceGuestAddress(guestAddress: string | null | undefined): string | null {
  if (!isBlankOrNa(guestAddress)) return guestAddress!.trim()
  return null
}

function resolvePoliceGuestNationality(guestNationality: string | null | undefined): string {
  if (!isBlankOrNa(guestNationality)) return guestNationality!.trim()
  return DEFAULT_NATIONALITY
}

function resolvePoliceGuestMobile(guestPhone: string | null | undefined): string | null {
  if (!isBlankOrNa(guestPhone)) return guestPhone!.trim()
  return null
}

function resolveCompanionIdDocument(companion: {
  idType: string | null
  idNumber: string | null
  registrationNumber?: string | null
}): string {
  if (!isBlankOrNa(companion.idNumber)) {
    return formatGuestId(companion.idType, companion.idNumber!.trim())
  }
  if (!isBlankOrNa(companion.registrationNumber)) {
    return `Reg: ${companion.registrationNumber!.trim()}`
  }
  return '—'
}

function resolvePrimaryGuestIdDocument(
  customer: {
    idType: string | null
    idNumber: string | null
    registrationNumber?: string | null
  },
  bookingRegistrationNumber?: string | null
): string {
  if (!isBlankOrNa(customer.idNumber)) {
    return formatGuestId(customer.idType, customer.idNumber!.trim())
  }
  if (!isBlankOrNa(customer.registrationNumber)) {
    return `Reg: ${customer.registrationNumber!.trim()}`
  }
  if (!isBlankOrNa(bookingRegistrationNumber)) {
    return `Reg: ${bookingRegistrationNumber!.trim()}`
  }
  return '—'
}

function mapPrimaryGuestRow(
  booking: PoliceCompanyBooking & {
    id: string
    registrationNumber?: string | null
    actualCheckIn: Date | null
    customer: {
      name: string
      phone: string | null
      address: string | null
      nationality: string | null
      idType: string | null
      idNumber: string | null
      company: string | null
      registrationNumber?: string | null
    }
    room: { roomNumber: string }
  },
  checkIn: { iso: string | null; display: string },
  businessDate: string
): PoliceReportGuestRow {
  return {
    id: booking.id,
    bookingId: booking.id,
    guestName: booking.customer.name,
    mobile: resolvePoliceGuestMobile(booking.customer.phone),
    idDocument: resolvePrimaryGuestIdDocument(booking.customer, booking.registrationNumber),
    address: resolvePoliceGuestAddress(booking.customer.address),
    nationality: resolvePoliceGuestNationality(booking.customer.nationality),
    company: resolvePoliceGuestCompany(booking, booking.customer.company),
    roomNumber: booking.room.roomNumber,
    checkInAt: checkIn.iso,
    checkInAtDisplay: checkIn.display,
    businessDate,
    isCompanion: false,
    guestRole: 'primary',
  }
}

function mapCompanionRow(
  booking: PoliceCompanyBooking & {
    id: string
    actualCheckIn: Date | null
    room: { roomNumber: string }
  },
  companion: {
    id: string
    name: string
    phone: string | null
    address: string | null
    nationality: string | null
    idType: string | null
    idNumber: string | null
    company: string | null
    designation: string | null
    registrationNumber: string | null
    companionType: string
  },
  checkIn: { iso: string | null; display: string },
  businessDate: string
): PoliceReportGuestRow {
  const isChild = companion.companionType === 'CHILD'
  return {
    id: `${booking.id}-companion-${companion.id}`,
    bookingId: booking.id,
    guestName: companion.name,
    mobile: resolvePoliceGuestMobile(companion.phone),
    idDocument: resolveCompanionIdDocument(companion),
    address: resolvePoliceGuestAddress(companion.address),
    nationality: resolvePoliceGuestNationality(companion.nationality),
    company: resolvePoliceGuestCompany(booking, companion.company),
    roomNumber: booking.room.roomNumber,
    checkInAt: checkIn.iso,
    checkInAtDisplay: checkIn.display,
    businessDate,
    isCompanion: true,
    guestRole: isChild ? 'child' : 'companion',
  }
}

function mapPlaceholderGuestRow(
  booking: PoliceCompanyBooking & {
    id: string
    actualCheckIn: Date | null
    room: { roomNumber: string }
  },
  checkIn: { iso: string | null; display: string },
  businessDate: string,
  label: string,
  guestRole: Extract<PoliceReportGuestRole, 'child' | 'unregistered'>
): PoliceReportGuestRow {
  return {
    id: `${booking.id}-placeholder-${guestRole}-${label.replace(/\s+/g, '-').toLowerCase()}`,
    bookingId: booking.id,
    guestName: label,
    mobile: null,
    idDocument: '—',
    address: null,
    nationality: DEFAULT_NATIONALITY,
    company: resolvePoliceGuestCompany(booking),
    roomNumber: booking.room.roomNumber,
    checkInAt: checkIn.iso,
    checkInAtDisplay: checkIn.display,
    businessDate,
    isCompanion: true,
    guestRole,
  }
}


function collectBookingGuestRows(
  booking: PoliceCompanyBooking & {
    id: string
    registrationNumber?: string | null
    adults: number
    children: number
    actualCheckIn: Date | null
    customer: {
      name: string
      phone: string | null
      address: string | null
      nationality: string | null
      idType: string | null
      idNumber: string | null
      company: string | null
      registrationNumber?: string | null
    }
    room: { roomNumber: string }
    companions: Array<{
      id: string
      name: string
      phone: string | null
      address: string | null
      nationality: string | null
      idType: string | null
      idNumber: string | null
      company: string | null
      designation: string | null
      registrationNumber: string | null
      companionType: string
    }>
  },
  businessDate: string
): PoliceReportGuestRow[] {
  const checkIn = formatCheckInDisplay(booking.actualCheckIn)
  const rows: PoliceReportGuestRow[] = [mapPrimaryGuestRow(booking, checkIn, businessDate)]

  const adultCompanions = booking.companions.filter((c) => c.companionType !== 'CHILD')

  for (const companion of adultCompanions) {
    rows.push(mapCompanionRow(booking, companion, checkIn, businessDate))
  }

  const missingAdults = expectedCompanionCount(booking.adults) - adultCompanions.length
  for (let index = 0; index < missingAdults; index += 1) {
    rows.push(
      mapPlaceholderGuestRow(
        booking,
        checkIn,
        businessDate,
        `Additional guest ${index + 2} (details not recorded)`,
        'unregistered'
      )
    )
  }

  // Children are not included as table rows on the police report
  return rows
}

/** Guests in-house during the business day (police / in-house register). */
export async function buildHotelPoliceReport(window: BusinessDayWindow): Promise<HotelPoliceReport> {
  const { openedAt, closedAt, businessDate } = window

  const bookings = await db.booking.findMany({
    where: buildPoliceInHouseOnBusinessDayWhere(businessDate, openedAt, closedAt),
    include: {
      companyLedger: { select: { name: true } },
      customer: {
        select: {
          name: true,
          phone: true,
          address: true,
          nationality: true,
          idType: true,
          idNumber: true,
          company: true,
          registrationNumber: true,
        },
      },
      room: { select: { roomNumber: true } },
      companions: { orderBy: { sortOrder: 'asc' } },
    },
    orderBy: [{ actualCheckIn: 'asc' }, { room: { roomNumber: 'asc' } }],
  })

  const guests: PoliceReportGuestRow[] = []
  let totalChildren = 0

  for (const booking of bookings) {
    guests.push(...collectBookingGuestRows(booking, businessDate))
    const childCompanions = booking.companions.filter((c) => c.companionType === 'CHILD').length
    const declaredChildren = Math.max(0, booking.children ?? 0)
    totalChildren += Math.max(childCompanions, declaredChildren)
  }

  return {
    reportType: 'hotel-police-report',
    businessDate: window.businessDate,
    businessDateDisplay: window.businessDateDisplay,
    totalCheckIns: bookings.length,
    guestCount: guests.length,
    adultCount: guests.length,
    childCount: totalChildren,
    guests,
  }
}

function formatPoliceReportDateDisplay(dateFrom?: string, dateTo?: string): string {
  if (!dateFrom && !dateTo) return 'All dates'
  const from = dateFrom?.trim()
  const to = dateTo?.trim()
  if (from && to && from !== to) {
    return `${formatBusinessDateDisplay(from)} to ${formatBusinessDateDisplay(to)}`
  }
  const single = from || to
  return single ? formatBusinessDateDisplay(single) : 'All dates'
}

export async function buildHotelPoliceReportForDateRange(
  dateFrom?: string,
  dateTo?: string
): Promise<HotelPoliceReport> {
  if (!dateFrom && !dateTo) {
    const window = await resolveBusinessDayReportWindow()
    return buildHotelPoliceReport(window)
  }

  const rawFrom = (dateFrom ?? dateTo)!.trim()
  const rawTo = (dateTo ?? dateFrom)!.trim()
  if (!isValidBusinessDateString(rawFrom) || !isValidBusinessDateString(rawTo)) {
    throw new Error('Invalid police report date range')
  }

  const [from, to] = rawFrom <= rawTo ? [rawFrom, rawTo] : [rawTo, rawFrom]

  if (from === to) {
    const window = await resolveBusinessDayReportWindow(from)
    return buildHotelPoliceReport(window)
  }

  const seenGuestDayIds = new Set<string>()
  const mergedGuests: PoliceReportGuestRow[] = []

  let day = from
  while (day <= to) {
    const dayReport = await buildHotelPoliceReport(await resolveBusinessDayReportWindow(day))
    for (const guest of dayReport.guests) {
      const rowBusinessDate = guest.businessDate ?? day
      const dedupeKey = `${rowBusinessDate}:${guest.id}`
      if (seenGuestDayIds.has(dedupeKey)) continue
      seenGuestDayIds.add(dedupeKey)
      mergedGuests.push({
        ...guest,
        businessDate: rowBusinessDate,
      })
    }
    if (day === to) break
    day = format(addDays(parseISO(`${day}T12:00:00`), 1), 'yyyy-MM-dd')
  }

  mergedGuests.sort((a, b) => {
    const dateCmp = (a.businessDate || '').localeCompare(b.businessDate || '')
    if (dateCmp !== 0) return dateCmp
    const aRoom = Number(a.roomNumber) || 0
    const bRoom = Number(b.roomNumber) || 0
    if (aRoom !== bRoom) return aRoom - bRoom
    const aTime = a.checkInAt ? new Date(a.checkInAt).getTime() : 0
    const bTime = b.checkInAt ? new Date(b.checkInAt).getTime() : 0
    return aTime - bTime
  })

  const uniqueBookingIds = Array.from(new Set(mergedGuests.map((g) => g.bookingId)))
  let totalRangeChildren = 0
  if (uniqueBookingIds.length > 0) {
    const rangeBookings = await db.booking.findMany({
      where: { id: { in: uniqueBookingIds } },
      select: {
        id: true,
        children: true,
        companions: {
          where: { companionType: 'CHILD' },
          select: { id: true },
        },
      },
    })
    for (const b of rangeBookings) {
      const childCompanions = b.companions.length
      const declaredChildren = Math.max(0, b.children ?? 0)
      totalRangeChildren += Math.max(childCompanions, declaredChildren)
    }
  }

  return {
    reportType: 'hotel-police-report',
    businessDate: from,
    businessDateDisplay: formatPoliceReportDateDisplay(from, to),
    dateFrom: from,
    dateTo: to,
    totalCheckIns: uniqueBookingIds.length,
    guestCount: mergedGuests.length,
    adultCount: mergedGuests.length,
    childCount: totalRangeChildren,
    guests: mergedGuests,
  }
}
