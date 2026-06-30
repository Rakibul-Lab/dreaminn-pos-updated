import { addDays, format, parseISO } from 'date-fns'
import { db } from '@/lib/db'
import {
  buildPoliceInHouseOnBusinessDayWhere,
  formatBusinessDateDisplay,
  isValidBusinessDateString,
} from '@/lib/business-date'
import { expectedCompanionCount } from '@/lib/booking-companions'
import { formatGuestId } from '@/lib/id-type-label'
import { resolveBusinessDayReportWindow, type BusinessDayWindow } from '@/lib/hotel-pms-reports'

export type PoliceReportGuestRole = 'primary' | 'companion' | 'child' | 'unregistered'

export type PoliceReportGuestRow = {
  id: string
  bookingId: string
  guestName: string
  mobile: string | null
  idDocument: string
  address: string | null
  nationality: string | null
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

function formatCompanionIdDocument(companion: {
  idType: string | null
  idNumber: string | null
  company: string | null
  designation: string | null
  registrationNumber: string | null
}): string {
  const id = formatGuestId(companion.idType, companion.idNumber)
  if (companion.idNumber?.trim()) return id

  const corporate: string[] = []
  if (companion.company?.trim()) corporate.push(companion.company.trim())
  if (companion.designation?.trim()) corporate.push(companion.designation.trim())
  if (companion.registrationNumber?.trim()) corporate.push(`Reg: ${companion.registrationNumber.trim()}`)
  if (corporate.length) return corporate.join(' · ')

  return id
}

function mapPrimaryGuestRow(
  booking: {
    id: string
    actualCheckIn: Date | null
    customer: {
      name: string
      phone: string | null
      address: string | null
      nationality: string | null
      idType: string | null
      idNumber: string | null
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
    mobile: booking.customer.phone?.trim() || null,
    idDocument: formatGuestId(booking.customer.idType, booking.customer.idNumber),
    address: booking.customer.address?.trim() || null,
    nationality: booking.customer.nationality?.trim() || null,
    roomNumber: booking.room.roomNumber,
    checkInAt: checkIn.iso,
    checkInAtDisplay: checkIn.display,
    businessDate,
    isCompanion: false,
    guestRole: 'primary',
  }
}

function mapCompanionRow(
  booking: {
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
    mobile: companion.phone?.trim() || null,
    idDocument: isChild
      ? formatGuestId(companion.idType, companion.idNumber)
      : formatCompanionIdDocument(companion),
    address: companion.address?.trim() || null,
    nationality: companion.nationality?.trim() || null,
    roomNumber: booking.room.roomNumber,
    checkInAt: checkIn.iso,
    checkInAtDisplay: checkIn.display,
    businessDate,
    isCompanion: true,
    guestRole: isChild ? 'child' : 'companion',
  }
}

function mapPlaceholderGuestRow(
  booking: {
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
    nationality: null,
    roomNumber: booking.room.roomNumber,
    checkInAt: checkIn.iso,
    checkInAtDisplay: checkIn.display,
    businessDate,
    isCompanion: true,
    guestRole,
  }
}

function collectBookingGuestRows(
  booking: {
    id: string
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
  const childCompanions = booking.companions.filter((c) => c.companionType === 'CHILD')

  for (const companion of booking.companions) {
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

  const missingChildren = Math.max(0, booking.children) - childCompanions.length
  for (let index = 0; index < missingChildren; index += 1) {
    rows.push(
      mapPlaceholderGuestRow(
        booking,
        checkIn,
        businessDate,
        `Child guest ${index + 1} (details not recorded)`,
        'child'
      )
    )
  }

  return rows
}

/** Guests in-house during the business day (police / in-house register). */
export async function buildHotelPoliceReport(window: BusinessDayWindow): Promise<HotelPoliceReport> {
  const { openedAt, closedAt, businessDate } = window

  const bookings = await db.booking.findMany({
    where: buildPoliceInHouseOnBusinessDayWhere(businessDate, openedAt, closedAt),
    include: {
      customer: {
        select: {
          name: true,
          phone: true,
          address: true,
          nationality: true,
          idType: true,
          idNumber: true,
        },
      },
      room: { select: { roomNumber: true } },
      companions: { orderBy: { sortOrder: 'asc' } },
    },
    orderBy: [{ actualCheckIn: 'asc' }, { room: { roomNumber: 'asc' } }],
  })

  const guests: PoliceReportGuestRow[] = []

  for (const booking of bookings) {
    guests.push(...collectBookingGuestRows(booking, businessDate))
  }

  return {
    reportType: 'hotel-police-report',
    businessDate: window.businessDate,
    businessDateDisplay: window.businessDateDisplay,
    totalCheckIns: bookings.length,
    guestCount: guests.length,
    guests,
  }
}

function formatPoliceReportDateDisplay(dateFrom?: string, dateTo?: string): string {
  if (!dateFrom && !dateTo) return 'All dates'
  const from = dateFrom?.trim()
  const to = dateTo?.trim()
  if (from && to && from !== to) {
    return `${formatBusinessDateDisplay(from)} → ${formatBusinessDateDisplay(to)}`
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

  const from = (dateFrom ?? dateTo)!.trim()
  const to = (dateTo ?? dateFrom)!.trim()
  if (!isValidBusinessDateString(from) || !isValidBusinessDateString(to)) {
    throw new Error('Invalid police report date range')
  }

  if (from === to) {
    const window = await resolveBusinessDayReportWindow(from)
    return buildHotelPoliceReport(window)
  }

  const seenGuestDayIds = new Set<string>()
  const mergedGuests: PoliceReportGuestRow[] = []
  let totalCheckIns = 0

  let day = from
  while (day <= to) {
    const dayReport = await buildHotelPoliceReport(await resolveBusinessDayReportWindow(day))
    totalCheckIns += dayReport.totalCheckIns
    for (const guest of dayReport.guests) {
      const dedupeKey = `${guest.businessDate ?? day}:${guest.id}`
      if (seenGuestDayIds.has(dedupeKey)) continue
      seenGuestDayIds.add(dedupeKey)
      mergedGuests.push(guest)
    }
    if (day === to) break
    day = format(addDays(parseISO(`${day}T12:00:00`), 1), 'yyyy-MM-dd')
  }

  mergedGuests.sort((a, b) => {
    const aTime = a.checkInAt ? new Date(a.checkInAt).getTime() : 0
    const bTime = b.checkInAt ? new Date(b.checkInAt).getTime() : 0
    return aTime - bTime
  })

  return {
    reportType: 'hotel-police-report',
    businessDate: from,
    businessDateDisplay: formatPoliceReportDateDisplay(from, to),
    dateFrom: from,
    dateTo: to,
    totalCheckIns,
    guestCount: mergedGuests.length,
    guests: mergedGuests,
  }
}
