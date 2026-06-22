import { db } from '@/lib/db'
import type { DayCloseSnapshot } from '@/lib/day-close-snapshot'
import type { CashReconciliation } from '@/lib/hotel-cash-reconciliation'

export type DailySalesBalances = {
  openingBalance: number
  salesTotal: number
  grandTotal: number
  companyBillTotal: number
  closingBalance: number
}

export function readSnapshotBalances(snapshot: unknown): DailySalesBalances | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const balances = (snapshot as { balances?: DailySalesBalances }).balances
  if (!balances || typeof balances !== 'object') return null
  return {
    openingBalance: Number(balances.openingBalance) || 0,
    salesTotal: Number(balances.salesTotal) || 0,
    grandTotal: Number(balances.grandTotal) || 0,
    companyBillTotal: Number(balances.companyBillTotal) || 0,
    closingBalance: Number(balances.closingBalance) || 0,
  }
}

/** Stored balances from a closed business day, if available. */
export async function getStoredBalancesForDate(
  businessDate: string
): Promise<DailySalesBalances | null> {
  const closedDay = await db.dayClose.findUnique({ where: { businessDate } })
  if (!closedDay) return null
  return readSnapshotBalances(closedDay.snapshot)
}

export function readSnapshotCashReconciliation(snapshot: unknown): CashReconciliation | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const recon = (snapshot as { cashReconciliation?: CashReconciliation }).cashReconciliation
  if (!recon || typeof recon !== 'object') return null
  return recon
}

/** Previous closed business day's cash on hand — becomes today's opening cash when not overridden. */
export async function readCarriedOpeningCash(businessDate: string): Promise<number | null> {
  const lastClose = await db.dayClose.findFirst({
    where: { businessDate: { lt: businessDate } },
    orderBy: { businessDate: 'desc' },
    select: { snapshot: true },
  })
  if (!lastClose?.snapshot) return null

  const recon = readSnapshotCashReconciliation(lastClose.snapshot)
  if (!recon || !Number.isFinite(recon.cashOnHand)) return null
  return Math.max(0, recon.cashOnHand)
}

export async function resolveOpeningBalance(businessDate: string): Promise<number> {
  const closedDay = await db.dayClose.findUnique({ where: { businessDate } })
  if (closedDay) {
    const stored = readSnapshotBalances(closedDay.snapshot)
    if (stored) return stored.openingBalance
  }

  const draft = await readDraftOpeningBalance(businessDate)
  if (draft !== null) return draft

  const carried = await readCarriedOpeningCash(businessDate)
  return carried ?? 0
}

export async function resolveSuggestedOpeningBalance(businessDate: string): Promise<{
  openingBalance: number
  carriedFromPreviousDay: number | null
  hasDraftOverride: boolean
}> {
  const draft = await readDraftOpeningBalance(businessDate)
  const carried = await readCarriedOpeningCash(businessDate)
  if (draft !== null) {
    return {
      openingBalance: draft,
      carriedFromPreviousDay: carried,
      hasDraftOverride: true,
    }
  }
  return {
    openingBalance: carried ?? 0,
    carriedFromPreviousDay: carried,
    hasDraftOverride: false,
  }
}

export function openingBalanceSettingKey(businessDate: string): string {
  return `opening_balance_${businessDate}`
}

/** Saved opening balance for an open business day (before day close). Null if not set. */
export async function readDraftOpeningBalance(businessDate: string): Promise<number | null> {
  const row = await db.setting.findUnique({
    where: { key: openingBalanceSettingKey(businessDate) },
  })
  if (!row?.value) return null
  const amount = Number(row.value)
  return Number.isFinite(amount) ? Math.max(0, amount) : null
}

export async function saveDraftOpeningBalance(
  businessDate: string,
  amount: number
): Promise<number> {
  const value = Math.max(0, Number(amount) || 0)
  await db.setting.upsert({
    where: { key: openingBalanceSettingKey(businessDate) },
    create: {
      key: openingBalanceSettingKey(businessDate),
      value: String(value),
      group: 'hotel',
    },
    update: { value: String(value) },
  })
  return value
}

export async function clearDraftOpeningBalance(businessDate: string): Promise<void> {
  await db.setting.deleteMany({ where: { key: openingBalanceSettingKey(businessDate) } })
}

export function computeDailySalesBalances(
  openingBalance: number,
  salesTotal: number,
  companyBillTotal: number
): DailySalesBalances {
  const grandTotal = openingBalance + salesTotal
  const closingBalance = grandTotal - companyBillTotal
  return {
    openingBalance,
    salesTotal,
    grandTotal,
    companyBillTotal,
    closingBalance,
  }
}

export function attachBalancesToSnapshot(
  snapshot: DayCloseSnapshot,
  balances: DailySalesBalances
): DayCloseSnapshot & { balances: DailySalesBalances } {
  return { ...snapshot, balances }
}
