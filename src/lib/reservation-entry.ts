import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { resolveBookingCheckInOut } from '@/lib/app-settings'
import { bookingOverlapsStayWindow } from '@/lib/room-effective-status'
import { getCalendarDayBounds, isValidBusinessDateString } from '@/lib/business-date'
import { parseStayDateRange } from '@/lib/guest-stay-date-filter'
import { getRoomNightlyTotal } from '@/lib/room-pricing'
import { computeRoomBookingTotals } from '@/lib/booking-totals'
import { formatGuestCompany, DEFAULT_GUEST_COMPANY } from '@/lib/reservation-terms'
import {
  postReservationEntryCompanyLedgerBill,
  resolveCompanyLedgerBooking,
} from '@/lib/company-ledger-billing'
import { isNonePaymentMethod, parseReservationPaymentMethod } from '@/lib/payment-method'
import { readCurrentBusinessDateString } from '@/lib/business-date'
import { generateGuestRegistrationNumber } from '@/lib/guest-registration-number'
import { generateReservationEntryConfirmationNumber } from '@/lib/confirmation-number.server'
import { isArrivalOnOrBeforeBusinessDate } from '@/lib/room-effective-status'
import { minCheckoutDatePickerValue } from '@/lib/hotel-times'
import { isKnownNationality } from '@/lib/nationalities'
import {
  isRoomStatusBlockedForSale,
  roomBlockedForSaleMessage,
} from '@/lib/room-sellability'

export function countLineSlots(line: {
  roomId: string | null
  quantity: number
  lineBookings: unknown[]
}): number {
  return line.roomId ? 1 : Math.max(1, line.quantity)
}

export function countUnfulfilledSlots(line: {
  roomId: string | null
  quantity: number
  lineBookings: unknown[]
}): number {
  return Math.max(0, countLineSlots(line) - line.lineBookings.length)
}

export type ReservationEntryPaymentInput = {
  amount: number
  method: string
}

export type ReservationEntryLineInput = {
  roomTypeId: string
  roomId?: string | null
  quantity?: number
}

export type ReservationEntryListRow = {
  id: string
  recordType: 'reservation_entry'
  status: 'RESERVED_ENTRY' | 'RESERVED_ENTRY_PARTIAL' | 'RESERVED_ENTRY_FULFILLED'
  entryStatus: 'ACTIVE' | 'PARTIALLY_FULFILLED' | 'FULFILLED' | 'CANCELLED'
  checkIn: string
  checkOut: string
  guestName: string | null
  guestPhone: string | null
  guestEmail: string | null
  guestAddress: string | null
  guestRegistrationNumber?: string | null
  registrationNumber?: string | null
  confirmationNumber?: string | null
  company: string | null
  companyLedgerId: string | null
  companyLedger?: { id: string; name: string } | null
  totalAmount: number
  advancePayment: number
  dueAmount: number
  discountEnabled: boolean
  discountType: string | null
  discountValue: number
  notes: string | null
  createdAt: string
  creator: { id: string; name: string }
  lines: Array<{
    id: string
    roomTypeId: string
    roomTypeName: string
    roomId: string | null
    roomNumber: string | null
    quantity: number
    fulfilledCount: number
    unfulfilledCount: number
  }>
  convertedBookings: Array<{
    id: string
    confirmationNumber: string | null
    roomNumber: string
  }>
  lineSummary: string
  totalRooms: number
  fulfilledRooms: number
  unfulfilledRooms: number
}

const entryInclude = {
  creator: { select: { id: true, name: true } },
  companyLedger: { select: { id: true, name: true } },
  lines: {
    include: {
      roomType: { select: { id: true, name: true } },
      room: { select: { id: true, roomNumber: true, typeId: true, totalPrice: true } },
      lineBookings: {
        select: {
          id: true,
          bookingId: true,
          booking: { select: { id: true, confirmationNumber: true } },
          room: { select: { roomNumber: true } },
        },
      },
    },
  },
} as const

function mapLineBlockingQuantity(line: {
  roomTypeId: string
  roomId: string | null
  quantity: number
  lineBookings: unknown[]
}): { roomId: string | null; roomTypeId: string; quantity: number } {
  const unfulfilled = countUnfulfilledSlots(line)
  if (unfulfilled <= 0) {
    return { roomId: null, roomTypeId: line.roomTypeId, quantity: 0 }
  }
  if (line.roomId) {
    return { roomId: line.roomId, roomTypeId: line.roomTypeId, quantity: 1 }
  }
  return { roomId: null, roomTypeId: line.roomTypeId, quantity: unfulfilled }
}

export function buildReservationEntryOverlapWhere(
  checkIn: Date,
  checkOut: Date,
  excludeEntryId?: string
): Prisma.ReservationEntryWhereInput {
  return {
    status: { in: ['ACTIVE', 'PARTIALLY_FULFILLED'] },
    ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}),
    checkIn: { lt: checkOut },
    checkOut: { gt: checkIn },
  }
}

export async function fetchActiveReservationEntryLinesForRange(
  checkIn: Date,
  checkOut: Date,
  excludeEntryId?: string
) {
  return db.reservationEntryLine.findMany({
    where: {
      reservationEntry: buildReservationEntryOverlapWhere(checkIn, checkOut, excludeEntryId),
    },
    include: {
      roomType: { select: { id: true, name: true } },
      room: { select: { id: true, roomNumber: true, typeId: true, status: true } },
      reservationEntry: { select: { id: true, checkIn: true, checkOut: true } },
      lineBookings: { select: { id: true } },
    },
  })
}

export async function countOverlappingBookingsForRoom(
  roomId: string,
  checkIn: Date,
  checkOut: Date,
  excludeBookingId?: string
) {
  return db.booking.count({
    where: {
      roomId,
      status: { in: ['RESERVED', 'CHECKED_IN'] },
      checkIn: { lt: checkOut },
      checkOut: { gt: checkIn },
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
    },
  })
}

export type CategoryCapacityInfo = {
  typeName: string
  total: number
  available: number
  entryHeld: number
  maintenance: number
}

export async function computeAvailableCapacityByType(
  checkIn: Date,
  checkOut: Date,
  excludeEntryId?: string,
  excludeBookingId?: string
): Promise<Map<string, CategoryCapacityInfo & { typeName: string }>> {
  const rooms = await db.room.findMany({
    select: { id: true, typeId: true, status: true, type: { select: { name: true } } },
  })

  const bookedRoomIds = new Set(
    (
      await db.booking.findMany({
        where: {
          status: { in: ['RESERVED', 'CHECKED_IN'] },
          checkIn: { lt: checkOut },
          checkOut: { gt: checkIn },
          ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
        },
        select: { roomId: true },
      })
    ).map((b) => b.roomId)
  )

  const entryLines = await fetchActiveReservationEntryLinesForRange(
    checkIn,
    checkOut,
    excludeEntryId
  )

  const blockedRoomIds = new Set<string>()
  const blockedByType = new Map<string, number>()

  for (const line of entryLines) {
    const block = mapLineBlockingQuantity(line)
    if (block.quantity <= 0) continue
    if (block.roomId) {
      blockedRoomIds.add(block.roomId)
    } else {
      blockedByType.set(block.roomTypeId, (blockedByType.get(block.roomTypeId) ?? 0) + block.quantity)
    }
  }

  const result = new Map<string, CategoryCapacityInfo & { typeName: string }>()

  for (const room of rooms) {
    const current = result.get(room.typeId) ?? {
      typeName: room.type.name,
      total: 0,
      available: 0,
      entryHeld: 0,
      maintenance: 0,
    }
    current.total += 1

    if (room.status === 'MAINTENANCE') {
      current.maintenance += 1
    }

    const isBlocked =
      bookedRoomIds.has(room.id) ||
      blockedRoomIds.has(room.id) ||
      isRoomStatusBlockedForSale(room.status)

    if (!isBlocked) {
      current.available += 1
    }

    result.set(room.typeId, current)
  }

  for (const line of entryLines) {
    const block = mapLineBlockingQuantity(line)
    if (block.quantity <= 0) continue
    if (block.roomId) {
      const current = result.get(line.roomTypeId)
      if (current) current.entryHeld += block.quantity
    }
  }

  for (const [typeId, blockedQty] of blockedByType) {
    const current = result.get(typeId)
    if (!current) continue
    current.entryHeld += blockedQty
    current.available = Math.max(0, current.available - blockedQty)
  }

  return result
}

export async function computeCategoryCapacityForStayDates(
  stayCheckIn: string,
  stayCheckOut: string
): Promise<Array<CategoryCapacityInfo & { roomTypeId: string }>> {
  if (!isValidBusinessDateString(stayCheckIn)) return []

  try {
    const { checkIn, checkOut } = await resolveBookingCheckInOut(stayCheckIn, stayCheckOut)
    const capacity = await computeAvailableCapacityByType(checkIn, checkOut)
    return Array.from(capacity.entries())
      .map(([roomTypeId, cap]) => ({ roomTypeId, ...cap }))
      .filter((row) => row.entryHeld > 0 || row.total > 0)
      .sort((a, b) => a.typeName.localeCompare(b.typeName))
  } catch {
    return []
  }
}

export async function computeCategoryCapacityForBusinessDate(
  businessDate: string
): Promise<Array<CategoryCapacityInfo & { roomTypeId: string }>> {
  if (!isValidBusinessDateString(businessDate)) return []
  const checkOutDate = minCheckoutDatePickerValue(businessDate)
  if (!checkOutDate) return []
  return computeCategoryCapacityForStayDates(businessDate, checkOutDate)
}

export function categoryCapacityToMeta(
  capacity: Map<string, CategoryCapacityInfo & { typeName: string }>
): Array<CategoryCapacityInfo & { roomTypeId: string }> {
  return Array.from(capacity.entries())
    .map(([roomTypeId, cap]) => ({ roomTypeId, ...cap }))
    .sort((a, b) => a.typeName.localeCompare(b.typeName))
}

export async function validateReservationEntryLines(
  checkIn: Date,
  checkOut: Date,
  lines: ReservationEntryLineInput[],
  excludeEntryId?: string
): Promise<string | null> {
  if (!lines.length) return 'Add at least one room line'

  const capacity = await computeAvailableCapacityByType(checkIn, checkOut, excludeEntryId)
  const requestedByType = new Map<string, number>()
  const seenRoomIds = new Set<string>()

  for (const line of lines) {
    if (!line.roomTypeId?.trim()) return 'Room category is required for each line'

    const qty = Math.max(1, Math.floor(line.quantity ?? 1))

    if (line.roomId) {
      if (seenRoomIds.has(line.roomId)) return 'Duplicate room in reservation entry lines'
      seenRoomIds.add(line.roomId)

      const room = await db.room.findUnique({
        where: { id: line.roomId },
        include: { type: { select: { name: true } } },
      })
      if (!room) return 'Selected room not found'
      if (room.typeId !== line.roomTypeId) {
        return `Room ${room.roomNumber} is not in the selected category`
      }
      if (isRoomStatusBlockedForSale(room.status)) {
        return roomBlockedForSaleMessage(room.roomNumber, room.status)
      }

      const bookingOverlap = await countOverlappingBookingsForRoom(room.id, checkIn, checkOut)
      if (bookingOverlap > 0) {
        return `Room ${room.roomNumber} already has a booking in this date range`
      }

      const entryOverlap = await db.reservationEntryLine.findFirst({
        where: {
          roomId: room.id,
          lineBookings: { none: {} },
          reservationEntry: buildReservationEntryOverlapWhere(checkIn, checkOut, excludeEntryId),
        },
      })
      if (entryOverlap) {
        return `Room ${room.roomNumber} is already blocked by a reservation entry`
      }
    } else {
      requestedByType.set(
        line.roomTypeId,
        (requestedByType.get(line.roomTypeId) ?? 0) + qty
      )
    }
  }

  for (const [typeId, qty] of requestedByType) {
    const cap = capacity.get(typeId)
    if (!cap) return 'Selected room category not found'
    if (qty > cap.available) {
      return `Only ${cap.available} ${cap.typeName} room(s) available for these dates (${qty} requested)`
    }
  }

  return null
}

export type ReservationEntryCapacityBlock = {
  roomTypeId: string
  roomId: string | null
  quantity: number
}

export function filterRoomsByReservationEntryCapacity<
  T extends { id: string; typeId: string }
>(rooms: T[], blocks: ReservationEntryCapacityBlock[]): T[] {
  const blockedRoomIds = new Set<string>()

  for (const block of blocks) {
    if (block.quantity <= 0) continue
    if (block.roomId) {
      blockedRoomIds.add(block.roomId)
    }
  }

  // Category quantity blocks do not pin specific rooms — capacity is enforced via
  // computeAvailableCapacityByType / assertRoomAvailableForBooking so any free room
  // in the category may be chosen until inventory for that day is exhausted.
  return rooms.filter((room) => !blockedRoomIds.has(room.id))
}

export async function applyReservationEntryRoomFilter<
  T extends { id: string; typeId: string }
>(rooms: T[], checkIn: Date, checkOut: Date, excludeEntryId?: string): Promise<T[]> {
  const entryLines = await fetchActiveReservationEntryLinesForRange(
    checkIn,
    checkOut,
    excludeEntryId
  )
  if (!entryLines.length) return rooms
  return filterRoomsByReservationEntryCapacity(
    rooms,
    entryLines.map((line) => mapLineBlockingQuantity(line))
  )
}

export type ReservationEntryRoomHold = {
  entryId: string
  guestName: string | null
  checkIn: Date
  lineId: string
  /** Category quantity block — room not named on the entry line. */
  categoryPool?: boolean
}

export type ReservationEntryHoldView = {
  referenceDate: string
  stayCheckIn: string
  stayCheckOut: string
  arrivalCutoff: string
}

/** Rooms board holds: specific room lines for the selected view stay window. */
export async function fetchReservationEntryHoldsForRooms(
  roomIds: string[],
  view: ReservationEntryHoldView
): Promise<Map<string, ReservationEntryRoomHold>> {
  const result = new Map<string, ReservationEntryRoomHold>()
  const { stayCheckIn, stayCheckOut } = view
  if (!roomIds.length || !isValidBusinessDateString(stayCheckIn)) return result

  let viewStayCheckIn: Date
  let viewStayCheckOut: Date
  try {
    ;({ checkIn: viewStayCheckIn, checkOut: viewStayCheckOut } =
      await resolveBookingCheckInOut(stayCheckIn, stayCheckOut))
  } catch {
    return result
  }

  const specificLines = await db.reservationEntryLine.findMany({
    where: {
      roomId: { in: roomIds },
      reservationEntry: { status: { in: ['ACTIVE', 'PARTIALLY_FULFILLED'] } },
      lineBookings: { none: {} },
    },
    include: {
      reservationEntry: {
        select: { id: true, guestName: true, checkIn: true, checkOut: true, status: true },
      },
    },
  })

  for (const line of specificLines) {
    if (!line.roomId) continue
    const entry = line.reservationEntry
    if (
      !bookingOverlapsStayWindow(
        { checkIn: entry.checkIn, checkOut: entry.checkOut },
        viewStayCheckIn,
        viewStayCheckOut
      )
    ) {
      continue
    }
    result.set(line.roomId, {
      entryId: entry.id,
      guestName: entry.guestName,
      checkIn: entry.checkIn,
      lineId: line.id,
    })
  }

  return result
}

export async function assertRoomAvailableForBooking(
  roomId: string,
  roomTypeId: string,
  checkIn: Date,
  checkOut: Date,
  excludeEntryId?: string,
  excludeBookingId?: string
): Promise<string | null> {
  const room = await db.room.findUnique({
    where: { id: roomId },
    select: { id: true, roomNumber: true, typeId: true, status: true },
  })
  if (!room) {
    return 'Selected room not found'
  }
  if (isRoomStatusBlockedForSale(room.status)) {
    return roomBlockedForSaleMessage(room.roomNumber, room.status)
  }
  if (room.typeId !== roomTypeId) {
    return 'Selected room is not in the chosen category'
  }

  const bookingOverlap = await countOverlappingBookingsForRoom(
    roomId,
    checkIn,
    checkOut,
    excludeBookingId
  )
  if (bookingOverlap > 0) {
    return `Room ${room.roomNumber} already has a booking in this date range`
  }

  const entryLines = await fetchActiveReservationEntryLinesForRange(
    checkIn,
    checkOut,
    excludeEntryId
  )

  for (const line of entryLines) {
    const block = mapLineBlockingQuantity(line)
    if (block.roomId === roomId && block.quantity > 0) {
      return 'This room is blocked by a reservation entry for the selected dates'
    }
  }

  const capacity = await computeAvailableCapacityByType(
    checkIn,
    checkOut,
    excludeEntryId,
    excludeBookingId
  )
  const typeCap = capacity.get(roomTypeId)
  if (!typeCap) {
    return 'Selected room category not found'
  }
  if (typeCap.available <= 0) {
    return `No ${typeCap.typeName} room(s) available for these dates (${typeCap.entryHeld} held by reservation entries)`
  }

  return null
}

export function formatReservationEntryLineSummary(
  lines: ReservationEntryListRow['lines']
): string {
  return lines
    .map((line) => {
      if (line.roomNumber) {
        return `${line.roomTypeName} · ${line.roomNumber}`
      }
      return `${line.quantity}× ${line.roomTypeName}`
    })
    .join(', ')
}

export function mapReservationEntryToListRow(entry: {
  id: string
  registrationNumber?: string | null
  confirmationNumber?: string | null
  status?: 'ACTIVE' | 'PARTIALLY_FULFILLED' | 'FULFILLED' | 'CANCELLED'
  checkIn: Date
  checkOut: Date
  guestName: string | null
  guestPhone: string | null
  guestEmail: string | null
  guestAddress: string | null
  company: string | null
  companyLedgerId: string | null
  companyLedger?: { id: string; name: string } | null
  totalAmount: number
  advancePayment: number
  dueAmount: number
  discountEnabled: boolean
  discountType: string | null
  discountValue: number
  notes: string | null
  createdAt: Date
  creator: { id: string; name: string }
  lines: Array<{
    id: string
    roomTypeId: string
    roomId: string | null
    quantity: number
    roomType: { id: string; name: string }
    room: { id: string; roomNumber: string } | null
    lineBookings?: Array<{
      id: string
      bookingId: string
      booking: { id: string; confirmationNumber: string | null }
      room: { roomNumber: string }
    }>
  }>
}): ReservationEntryListRow {
  const lines = entry.lines.map((line) => {
    const fulfilledCount = line.lineBookings?.length ?? 0
    const unfulfilledCount = countUnfulfilledSlots({
      roomId: line.roomId,
      quantity: line.quantity,
      lineBookings: line.lineBookings ?? [],
    })
    return {
      id: line.id,
      roomTypeId: line.roomTypeId,
      roomTypeName: line.roomType.name,
      roomId: line.roomId,
      roomNumber: line.room?.roomNumber ?? null,
      quantity: line.quantity,
      fulfilledCount,
      unfulfilledCount,
    }
  })

  const convertedBookings = entry.lines.flatMap((line) =>
    (line.lineBookings ?? []).map((row) => ({
      id: row.booking.id,
      confirmationNumber: row.booking.confirmationNumber,
      roomNumber: row.room.roomNumber,
    }))
  )

  const totalRooms = lines.reduce(
    (sum, line) => sum + (line.roomId ? 1 : line.quantity),
    0
  )
  const fulfilledRooms = lines.reduce((sum, line) => sum + line.fulfilledCount, 0)
  const unfulfilledRooms = lines.reduce((sum, line) => sum + line.unfulfilledCount, 0)

  const entryStatus = entry.status ?? 'ACTIVE'
  const status: ReservationEntryListRow['status'] =
    entryStatus === 'PARTIALLY_FULFILLED'
      ? 'RESERVED_ENTRY_PARTIAL'
      : entryStatus === 'FULFILLED'
        ? 'RESERVED_ENTRY_FULFILLED'
        : 'RESERVED_ENTRY'

  return {
    id: entry.id,
    recordType: 'reservation_entry',
    status,
    entryStatus,
    registrationNumber: entry.registrationNumber ?? null,
    confirmationNumber: entry.confirmationNumber ?? null,
    checkIn: entry.checkIn.toISOString(),
    checkOut: entry.checkOut.toISOString(),
    guestName: entry.guestName,
    guestPhone: entry.guestPhone,
    guestEmail: entry.guestEmail,
    guestAddress: entry.guestAddress,
    company: entry.company,
    companyLedgerId: entry.companyLedgerId,
    companyLedger: entry.companyLedger ?? null,
    totalAmount: entry.totalAmount,
    advancePayment: entry.advancePayment,
    dueAmount: entry.dueAmount,
    discountEnabled: entry.discountEnabled,
    discountType: entry.discountType,
    discountValue: entry.discountValue,
    notes: entry.notes,
    createdAt: entry.createdAt.toISOString(),
    creator: entry.creator,
    lines,
    convertedBookings,
    lineSummary: formatReservationEntryLineSummary(lines),
    totalRooms,
    fulfilledRooms,
    unfulfilledRooms,
  }
}

export async function computeReservationEntryRoomCharge(
  checkIn: Date,
  checkOut: Date,
  lines: ReservationEntryLineInput[]
): Promise<number> {
  const msPerDay = 24 * 60 * 60 * 1000
  const nights = Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / msPerDay))

  let nightlyTotal = 0
  for (const line of lines) {
    const qty = line.roomId ? 1 : Math.max(1, Math.floor(line.quantity ?? 1))
    if (line.roomId) {
      const room = await db.room.findUnique({ where: { id: line.roomId } })
      if (room) nightlyTotal += getRoomNightlyTotal(room) * qty
      continue
    }
    const sampleRoom = await db.room.findFirst({
      where: { typeId: line.roomTypeId },
      orderBy: { roomNumber: 'asc' },
    })
    if (sampleRoom) nightlyTotal += getRoomNightlyTotal(sampleRoom) * qty
  }

  return nightlyTotal * nights
}

async function buildReservationEntrySearchOr(
  q: string
): Promise<NonNullable<Prisma.ReservationEntryWhereInput['OR']>> {
  const conditions: Prisma.ReservationEntryWhereInput[] = [
    { notes: { contains: q } },
    { guestName: { contains: q } },
    { guestPhone: { contains: q } },
    { guestEmail: { contains: q } },
    { guestAddress: { contains: q } },
    { company: { contains: q } },
    { registrationNumber: { contains: q } },
    { confirmationNumber: { contains: q } },
    { companyLedger: { name: { contains: q } } },
    { lines: { some: { room: { roomNumber: { contains: q } } } } },
    { lines: { some: { roomType: { name: { contains: q } } } } },
    {
      sourceBookings: {
        some: {
          OR: [
            { customer: { registrationNumber: { contains: q } } },
            { customer: { name: { contains: q } } },
            { customer: { phone: { contains: q } } },
            { confirmationNumber: { contains: q } },
          ],
        },
      },
    },
  ]

  const customers = await db.customer.findMany({
    where: {
      OR: [{ registrationNumber: { contains: q } }, { phone: { contains: q } }],
    },
    select: { phone: true },
  })
  const phones = [...new Set(customers.map((row) => row.phone).filter(Boolean))]
  if (phones.length) {
    conditions.push({ guestPhone: { in: phones } })
  }

  return conditions
}

export async function buildReservationEntryListWhere(input: {
  dateFrom?: string | null
  dateTo?: string | null
  search?: string | null
  scope?: 'business_day' | 'all'
  businessDate?: string | null
}): Promise<Prisma.ReservationEntryWhereInput> {
  const { dateFrom, dateTo, search, scope = 'business_day', businessDate } = input

  const where: Prisma.ReservationEntryWhereInput = {
    status: { in: ['ACTIVE', 'PARTIALLY_FULFILLED'] },
  }

  if (scope === 'business_day' && businessDate && isValidBusinessDateString(businessDate)) {
    const { start, end } = getCalendarDayBounds(businessDate)
    where.checkIn = { gte: start, lte: end }
  } else {
    const range = parseStayDateRange(dateFrom ?? null, dateTo ?? null)
    if (range) {
      where.checkIn = { lt: range.end }
      where.checkOut = { gt: range.start }
    }
  }

  if (search?.trim()) {
    where.OR = await buildReservationEntrySearchOr(search.trim())
  }

  return where
}

async function attachGuestRegistrationNumbers(
  rows: ReservationEntryListRow[]
): Promise<ReservationEntryListRow[]> {
  const phones = [...new Set(rows.map((row) => row.guestPhone?.trim()).filter(Boolean) as string[])]
  if (!phones.length) {
    return rows.map((row) => ({ ...row, guestRegistrationNumber: null }))
  }

  const customers = await db.customer.findMany({
    where: { phone: { in: phones } },
    select: { phone: true, registrationNumber: true },
  })
  const byPhone = new Map(customers.map((row) => [row.phone, row.registrationNumber]))

  return rows.map((row) => ({
    ...row,
    guestRegistrationNumber:
      row.registrationNumber ??
      (row.guestPhone ? byPhone.get(row.guestPhone) ?? null : null),
  }))
}

export async function listReservationEntries(input: {
  page: number
  limit: number
  dateFrom?: string | null
  dateTo?: string | null
  search?: string | null
  scope?: 'business_day' | 'all'
  businessDate?: string | null
}) {
  const { page, limit, dateFrom, dateTo, search, scope = 'business_day', businessDate } = input
  const skip = (page - 1) * limit

  const where = await buildReservationEntryListWhere({
    dateFrom,
    dateTo,
    search,
    scope,
    businessDate,
  })

  const orderBy =
    scope === 'business_day' || dateFrom || dateTo
      ? { checkIn: 'asc' as const }
      : { createdAt: 'desc' as const }

  const [entries, total] = await Promise.all([
    db.reservationEntry.findMany({
      where,
      include: entryInclude,
      skip,
      take: limit,
      orderBy,
    }),
    db.reservationEntry.count({ where }),
  ])

  const rows = await attachGuestRegistrationNumbers(entries.map(mapReservationEntryToListRow))

  return {
    rows,
    total,
  }
}

export async function summarizeReservationEntries(input: {
  dateFrom?: string | null
  dateTo?: string | null
  search?: string | null
  scope?: 'business_day' | 'all'
  businessDate?: string | null
}) {
  const where = await buildReservationEntryListWhere(input)

  const entries = await db.reservationEntry.findMany({
    where,
    include: entryInclude,
    orderBy: { checkIn: 'asc' },
  })

  const rows = await attachGuestRegistrationNumbers(entries.map(mapReservationEntryToListRow))

  const byType = new Map<
    string,
    { roomTypeId: string; roomTypeName: string; totalQuantity: number; entries: ReservationEntryListRow[] }
  >()

  for (const row of rows) {
    for (const line of row.lines) {
      const qty = line.unfulfilledCount > 0 ? line.unfulfilledCount : line.roomId ? 1 : line.quantity
      if (qty <= 0) continue
      const current = byType.get(line.roomTypeId) ?? {
        roomTypeId: line.roomTypeId,
        roomTypeName: line.roomTypeName,
        totalQuantity: 0,
        entries: [],
      }
      current.totalQuantity += qty
      if (!current.entries.some((e) => e.id === row.id)) {
        current.entries.push(row)
      }
      byType.set(line.roomTypeId, current)
    }
  }

  return Array.from(byType.values()).sort((a, b) =>
    a.roomTypeName.localeCompare(b.roomTypeName)
  )
}

export async function summarizeReservationEntriesForBusinessDate(businessDate: string) {
  if (!isValidBusinessDateString(businessDate)) {
    return []
  }
  return summarizeReservationEntries({
    scope: 'business_day',
    businessDate,
  })
}

export async function createReservationEntry(input: {
  checkIn: string
  checkOut: string
  notes?: string
  guestName?: string
  guestPhone?: string
  guestEmail?: string
  guestAddress?: string
  guestNationality?: string
  guestIdType?: string
  guestIdNumber?: string
  nidPhysicallyReceived?: boolean
  company?: string
  companyLedgerId?: string | null
  discountEnabled?: boolean
  discountType?: string | null
  discountValue?: number
  entryPayments?: ReservationEntryPaymentInput[]
  lines: ReservationEntryLineInput[]
  createdBy: string
  receivedBy: string
}) {
  const { checkIn: checkInDate, checkOut: checkOutDate } = await resolveBookingCheckInOut(
    input.checkIn,
    input.checkOut
  )

  const validationError = await validateReservationEntryLines(
    checkInDate,
    checkOutDate,
    input.lines
  )
  if (validationError) {
    throw new Error(validationError)
  }

  const guestName = input.guestName?.trim() || null
  const guestPhone = input.guestPhone?.trim() || null
  if (!guestName) throw new Error('Guest name is required')
  if (!guestPhone) throw new Error('Guest phone is required')

  const requiresGuestIdFields = !input.companyLedgerId?.trim()

  if (requiresGuestIdFields) {
    const nationality = input.guestNationality?.trim() || ''
    if (!isKnownNationality(nationality)) {
      throw new Error('Nationality is required')
    }
  }

  let resolvedCompanyLedgerId: string | null = input.companyLedgerId?.trim() || null
  let resolvedCompany = formatGuestCompany(input.company)

  if (resolvedCompanyLedgerId) {
    const ledgerResult = await resolveCompanyLedgerBooking(db, resolvedCompanyLedgerId, null)
    if ('error' in ledgerResult) {
      throw new Error(ledgerResult.error)
    }
    resolvedCompanyLedgerId = ledgerResult.companyLedgerId
    resolvedCompany = ledgerResult.companyName
  } else if (resolvedCompany === DEFAULT_GUEST_COMPANY) {
    resolvedCompany = null
  }

  const applyDiscount = input.discountEnabled === true
  const resolvedDiscountType = input.discountType === 'FIXED' ? 'FIXED' : 'PERCENTAGE'
  const resolvedDiscountValue = applyDiscount
    ? Math.max(0, Number(input.discountValue) || 0)
    : 0

  const totalRoomCharge = await computeReservationEntryRoomCharge(
    checkInDate,
    checkOutDate,
    input.lines
  )

  const paymentLines = (input.entryPayments ?? [])
    .map((row) => ({
      amount: Math.max(0, Number(row.amount) || 0),
      method: parseReservationPaymentMethod(row.method),
    }))
    .filter((row) => row.amount > 0 && !isNonePaymentMethod(row.method))

  const advance = paymentLines.reduce((sum, row) => sum + row.amount, 0)

  const { totalWithVat, dueAmount } = computeRoomBookingTotals(
    totalRoomCharge,
    advance,
    { vatApplied: false, vatPercent: 15 },
    {
      discountEnabled: applyDiscount,
      discountType: resolvedDiscountType,
      discountValue: resolvedDiscountValue,
    }
  )

  const [registrationNumber, confirmationNumber] = await Promise.all([
    generateGuestRegistrationNumber(),
    generateReservationEntryConfirmationNumber(),
  ])

  const entry = await db.reservationEntry.create({
    data: {
      checkIn: checkInDate,
      checkOut: checkOutDate,
      guestName,
      guestPhone,
      guestEmail: input.guestEmail?.trim() || null,
      guestAddress: input.guestAddress?.trim() || null,
      guestNationality: requiresGuestIdFields ? input.guestNationality?.trim() || null : null,
      guestIdType: requiresGuestIdFields ? input.guestIdType?.trim() || null : null,
      guestIdNumber: requiresGuestIdFields ? input.guestIdNumber?.trim() || null : null,
      nidPhysicallyReceived: requiresGuestIdFields,
      company: resolvedCompany,
      companyLedgerId: resolvedCompanyLedgerId,
      registrationNumber,
      confirmationNumber,
      totalAmount: totalWithVat,
      advancePayment: advance,
      dueAmount,
      discountEnabled: applyDiscount,
      discountType: applyDiscount ? resolvedDiscountType : null,
      discountValue: resolvedDiscountValue,
      notes: input.notes?.trim() || null,
      createdBy: input.createdBy,
      lines: {
        create: input.lines.map((line) => ({
          roomTypeId: line.roomTypeId,
          roomId: line.roomId || null,
          quantity: line.roomId ? 1 : Math.max(1, Math.floor(line.quantity ?? 1)),
        })),
      },
    },
    include: entryInclude,
  })

  for (const line of paymentLines) {
    await db.payment.create({
      data: {
        amount: line.amount,
        method: line.method,
        paymentType: 'ADVANCE',
        reservationEntryId: entry.id,
        receivedBy: input.receivedBy,
        businessDate: await readCurrentBusinessDateString(),
        notes: 'Advance payment on reservation entry',
      },
    })
  }

  if (resolvedCompanyLedgerId) {
    await postReservationEntryCompanyLedgerBill(db, {
      companyLedgerId: resolvedCompanyLedgerId,
      reservationEntryId: entry.id,
      guestName,
      roomSummary: formatReservationEntryLineSummary(
        entry.lines.map((line) => ({
          id: line.id,
          roomTypeId: line.roomTypeId,
          roomTypeName: line.roomType.name,
          roomId: line.roomId,
          roomNumber: line.room?.roomNumber ?? null,
          quantity: line.quantity,
        }))
      ),
      totalAmount: totalWithVat,
      paidAmount: advance,
      dueAmount,
      notes: input.notes?.trim() || null,
    })
  }

  return db.reservationEntry.findUniqueOrThrow({
    where: { id: entry.id },
    include: entryInclude,
  })
}

export async function cancelReservationEntry(id: string) {
  const entry = await db.reservationEntry.findUnique({
    where: { id },
    include: {
      companyLedgerBill: true,
      lines: { include: { lineBookings: { select: { id: true } } } },
    },
  })
  if (!entry) throw new Error('Reservation entry not found')
  if (entry.status === 'CANCELLED') throw new Error('Reservation entry is already cancelled')
  if (entry.status === 'FULFILLED') throw new Error('Fulfilled reservation entry cannot be cancelled')
  if (entry.lines.some((line) => line.lineBookings.length > 0)) {
    throw new Error('Cannot cancel a reservation entry that has converted bookings')
  }

  if (entry.companyLedgerBill) {
    const bill = entry.companyLedgerBill
    await db.companyLedger.update({
      where: { id: bill.companyLedgerId },
      data: {
        totalBilled: { decrement: bill.totalAmount },
        totalPaid: { decrement: bill.paidAmount },
        dueAmount: { decrement: bill.dueAmount },
      },
    })
    await db.companyLedgerBill.delete({ where: { id: bill.id } })
  }

  return db.reservationEntry.update({
    where: { id },
    data: { status: 'CANCELLED' },
    include: entryInclude,
  })
}

export { entryInclude }
