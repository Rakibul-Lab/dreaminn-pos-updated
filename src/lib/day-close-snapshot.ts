import { db } from '@/lib/db'
import {
  buildBusinessDayWindowWhere,
  formatBusinessDateDisplay,
  getOpenBusinessDayWindow,
} from '@/lib/business-date'
import { buildDailySalesDetailReport } from '@/lib/daily-sales-report'
import { buildHotelDailyCollectionsReport } from '@/lib/hotel-pms-reports'
import type { DailySalesBalances } from '@/lib/daily-sales-balance'
import type { CashReconciliation } from '@/lib/hotel-cash-reconciliation'

export type DayCloseSnapshot = {
  businessDate: string
  openedAt: string
  closedAt: string
  balances?: DailySalesBalances
  cashReconciliation?: CashReconciliation
  /** Physical cash left at hotel after HO remittance (= cash on hand). */
  cashClosingBalance?: number
  hotel: {
    checkIns: number
    checkOuts: number
    inHouseGuests: number
    roomRevenue: number
    paymentsReceived: number
    invoicesIssued: number
    occupiedRooms: number
    totalRooms: number
    roomSales: number
    foodSales: number
    extraSales: number
    invoiceTotal: number
    discount: number
    beverageWalkInSales: number
    beverageRoomSales: number
    beverageSales: number
    transportWalkInSales: number
    transportRoomSales: number
    transportSales: number
    hotelSalesTotal: number
  }
  restaurant: {
    orderCount: number
    grossSales: number
    discount: number
    cancelledOrders: number
  }
  payments: {
    totalCollected: number
    grossCollected: number
    refunds: number
    count: number
    byMethod: Array<{ method: string; amount: number }>
  }
  deposits: {
    total: number
    count: number
  }
  salesTotal: number
  grandTotal: number
  totalDiscount: number
}

export async function buildDayCloseSnapshot(
  businessDate: string,
  openedAt: Date,
  closedAt: Date
): Promise<DayCloseSnapshot> {
  const window = {
    businessDate,
    businessDateDisplay: formatBusinessDateDisplay(businessDate),
    openedAt,
    closedAt,
  }
  const windowWhere = buildBusinessDayWindowWhere(businessDate, openedAt, closedAt)

  const [
    salesReport,
    collectionsReport,
    inHouseGuests,
    cancelledOrders,
    depositRows,
  ] = await Promise.all([
    buildDailySalesDetailReport(window),
    buildHotelDailyCollectionsReport(window),
    db.booking.count({ where: { status: 'CHECKED_IN' } }),
    db.restaurantOrder.count({
      where: { ...windowWhere, status: 'CANCELLED' },
    }),
    db.hotelDeposit.findMany({
      where: windowWhere,
      select: { amount: true },
    }),
  ])

  const depositTotal = depositRows.reduce((sum, row) => sum + row.amount, 0)

  return {
    businessDate,
    openedAt: openedAt.toISOString(),
    closedAt: closedAt.toISOString(),
    cashReconciliation: salesReport.cashReconciliation,
    cashClosingBalance: salesReport.cashReconciliation.cashOnHand,
    hotel: {
      checkIns: salesReport.summary.checkIns,
      checkOuts: salesReport.summary.checkOuts,
      inHouseGuests,
      roomRevenue: salesReport.hotel.hotelSalesTotal,
      paymentsReceived: collectionsReport.summary.netCollected,
      invoicesIssued: salesReport.hotel.invoiceCount,
      occupiedRooms: salesReport.summary.occupiedRooms,
      totalRooms: salesReport.summary.totalRooms,
      roomSales: salesReport.hotel.roomSales,
      foodSales: salesReport.hotel.foodSales,
      extraSales: salesReport.hotel.extraSales,
      invoiceTotal: salesReport.hotel.invoiceTotal,
      discount: salesReport.hotel.discount,
      beverageWalkInSales: salesReport.hotel.beverageWalkInSales,
      beverageRoomSales: salesReport.hotel.beverageRoomSales,
      beverageSales: salesReport.hotel.beverageSales,
      transportWalkInSales: salesReport.hotel.transportWalkInSales,
      transportRoomSales: salesReport.hotel.transportRoomSales,
      transportSales: salesReport.hotel.transportSales,
      hotelSalesTotal: salesReport.hotel.hotelSalesTotal,
    },
    restaurant: {
      orderCount: salesReport.restaurant.orderCount,
      grossSales: salesReport.restaurant.grossSales,
      discount: salesReport.restaurant.discount,
      cancelledOrders,
    },
    payments: {
      totalCollected: collectionsReport.summary.netCollected,
      grossCollected: collectionsReport.summary.grossCollected,
      refunds: collectionsReport.summary.refunds,
      count: collectionsReport.summary.paymentCount,
      byMethod: collectionsReport.byMethod,
    },
    deposits: {
      total: depositTotal,
      count: depositRows.length,
    },
    salesTotal: salesReport.balances.salesTotal,
    grandTotal: salesReport.grandTotal,
    totalDiscount: salesReport.totalDiscount,
  }
}

export async function buildOpenDayPreviewSnapshot(): Promise<DayCloseSnapshot> {
  const { businessDate, openedAt } = await getOpenBusinessDayWindow()
  return buildDayCloseSnapshot(businessDate, openedAt, new Date())
}
