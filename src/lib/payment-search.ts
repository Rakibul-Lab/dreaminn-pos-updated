import type { Prisma } from '@prisma/client'
import { utcDayRangeFromYyyyMmDd } from '@/lib/booking-payment-slip'

function normalizeSlipSearchTerm(term: string): string {
  return term.trim().toUpperCase().replace(/\s+/g, '')
}

/** Slip-specific Prisma OR branches (PS-YYYYMMDD-SUFFIX, partial slip, suffix). */
export function buildSlipSearchConditions(term: string): Prisma.PaymentWhereInput[] {
  const normalized = normalizeSlipSearchTerm(term)
  if (!normalized) return []

  const conditions: Prisma.PaymentWhereInput[] = []

  const fullSlip = normalized.match(/^PS-?(\d{8})-?([A-Z0-9]{4,})$/)
  if (fullSlip) {
    const [, datePart, suffixRaw] = fullSlip
    const idSuffix = suffixRaw.toLowerCase()
    const range = utcDayRangeFromYyyyMmDd(datePart)
    if (range) {
      conditions.push({
        AND: [
          { createdAt: { gte: range.dateFrom, lte: range.dateTo } },
          { id: { endsWith: idSuffix } },
        ],
      })
    }
    conditions.push({ id: { endsWith: idSuffix } })
  }

  const dateOnly = normalized.match(/^PS-?(\d{8})$/)
  if (dateOnly) {
    const range = utcDayRangeFromYyyyMmDd(dateOnly[1])
    if (range) {
      conditions.push({ createdAt: { gte: range.dateFrom, lte: range.dateTo } })
    }
  }

  const bareSlip = normalized.match(/^(\d{8})-([A-Z0-9]{4,})$/)
  if (bareSlip && !normalized.startsWith('PS')) {
    const [, datePart, suffixRaw] = bareSlip
    const idSuffix = suffixRaw.toLowerCase()
    const range = utcDayRangeFromYyyyMmDd(datePart)
    if (range) {
      conditions.push({
        AND: [
          { createdAt: { gte: range.dateFrom, lte: range.dateTo } },
          { id: { endsWith: idSuffix } },
        ],
      })
    }
    conditions.push({ id: { endsWith: idSuffix } })
  }

  // Suffix-only copy from slip (6 chars, includes a letter — avoids matching plain room numbers)
  if (/^(?=.*[A-Z])[A-Z0-9]{6}$/.test(normalized) && !fullSlip && !bareSlip) {
    conditions.push({ id: { endsWith: normalized.toLowerCase() } })
  }

  return conditions
}

function looksLikeSlipSearch(term: string): boolean {
  const normalized = normalizeSlipSearchTerm(term)
  return (
    normalized.startsWith('PS') ||
    /^\d{8}-[A-Z0-9]+$/i.test(normalized) ||
    /^(?=.*[A-Z])[A-Z0-9]{6}$/.test(normalized)
  )
}

/** Build Prisma filter for payments list search (reg. no., slip no., room, guest, etc.). */
export function buildPaymentSearchWhere(search: string): Prisma.PaymentWhereInput | null {
  const term = search.trim()
  if (!term) return null

  const or: Prisma.PaymentWhereInput[] = [
    ...buildSlipSearchConditions(term),
    { reference: { contains: term } },
    { notes: { contains: term } },
    { businessDate: { contains: term } },
    { receiver: { name: { contains: term } } },
    {
      booking: {
        OR: [
          { registrationNumber: { contains: term } },
          { confirmationNumber: { contains: term } },
          { room: { roomNumber: { contains: term } } },
          { customer: { name: { contains: term } } },
          { customer: { phone: { contains: term } } },
          { customer: { registrationNumber: { contains: term } } },
          { companyLedgerGuest: { registrationNumber: { contains: term } } },
          { sourceReservationEntry: { registrationNumber: { contains: term } } },
        ],
      },
    },
    {
      order: {
        OR: [
          { orderNumber: { contains: term } },
          { customerName: { contains: term } },
          { room: { roomNumber: { contains: term } } },
          { table: { tableNumber: { contains: term } } },
        ],
      },
    },
  ]

  if (!looksLikeSlipSearch(term)) {
    or.push({ id: { contains: term } })
  }

  return { OR: or }
}
