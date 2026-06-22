import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, canAccessHotel, canAccessRestaurant, canAccessAdmin } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/api-utils';
import {
  buildBusinessDayArrivalsWhere,
  buildBusinessDayDeparturesWhere,
  buildExpectedArrivalsOnBusinessDateWhere,
  buildInHouseOnBusinessDateWhere,
  getOpenBusinessDayWindow,
  readCurrentBusinessDateString,
} from '@/lib/business-date';
import {
  buildHotelDailyArrivalsReport,
  buildHotelDailyCollectionsReport,
  buildHotelDailyDeparturesReport,
  buildHotelDailySalesReport,
  resolveDateRangeReportWindow,
  resolveBusinessDayReportWindow,
} from '@/lib/hotel-pms-reports';
import { buildHotelDiscountReportForDateRange } from '@/lib/hotel-daily-discount-report';

function buildReportDateFilter(startDate: string | null, endDate: string | null): Record<string, unknown> {
  const dateFilter: Record<string, unknown> = {};
  if (!startDate && !endDate) return dateFilter;

  const createdAt: Record<string, unknown> = {};
  if (startDate) {
    const start = new Date(startDate);
    if (!Number.isNaN(start.getTime())) {
      start.setHours(0, 0, 0, 0);
      createdAt.gte = start;
    }
  }
  if (endDate) {
    const end = new Date(endDate);
    if (!Number.isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999);
      createdAt.lte = end;
    }
  }
  if (createdAt.gte || createdAt.lte) {
    dateFilter.createdAt = createdAt;
  }
  return dateFilter;
}

// GET /api/reports?type=... - Reports based on type
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const user = authResult;
    const { searchParams } = new URL(request.url);

    const type = searchParams.get('type');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const businessDate = searchParams.get('businessDate');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    if (!type) {
      return errorResponse(
        'Report type is required. Valid types: restaurant-daily, restaurant-monthly, hotel-revenue, hotel-occupancy, food-charges-by-room, combined-revenue, admin-summary, order-status, hotel-daily-sales, hotel-daily-arrivals, hotel-daily-departures, hotel-daily-collections, hotel-daily-discounts'
      );
    }

    const dateFilter = buildReportDateFilter(startDate, endDate);

    switch (type) {
      case 'restaurant-daily':
        return await handleRestaurantDaily(user, dateFilter);
      case 'restaurant-monthly':
        return await handleRestaurantMonthly(user, dateFilter);
      case 'hotel-revenue':
        return await handleHotelRevenue(user, dateFilter);
      case 'hotel-occupancy':
        return await handleHotelOccupancy(user, dateFilter);
      case 'food-charges-by-room':
        return await handleFoodChargesByRoom(user, dateFilter);
      case 'combined-revenue':
        return await handleCombinedRevenue(user, dateFilter);
      case 'admin-summary':
        return await handleAdminSummary(user, dateFilter);
      case 'order-status':
        return await handleOrderStatus(user, dateFilter);
      case 'hotel-daily-sales':
        return await handleHotelDailySales(user, businessDate, dateFrom, dateTo);
      case 'hotel-daily-arrivals':
        return await handleHotelDailyArrivals(user, businessDate);
      case 'hotel-daily-departures':
        return await handleHotelDailyDepartures(user, businessDate);
      case 'hotel-daily-collections':
        return await handleHotelDailyCollections(user, businessDate, dateFrom, dateTo);
      case 'hotel-daily-discounts':
        return await handleHotelDailyDiscounts(user, businessDate, dateFrom, dateTo);
      default:
        return errorResponse('Invalid report type', 400);
    }
  } catch (error) {
    console.error('Error generating report:', error);
    return errorResponse('Failed to generate report', 500);
  }
}

// Restaurant Daily Sales Report for CloudView
async function handleRestaurantDaily(user: { role: string }, dateFilter: Record<string, unknown>) {
  if (!canAccessRestaurant(user.role as 'ADMIN' | 'RESTAURANT_STAFF' | 'HOTEL_STAFF')) {
    return errorResponse('Access denied. RESTAURANT_STAFF or ADMIN only.', 403);
  }

  const businessDate = await readCurrentBusinessDateString();

  const orders = await db.restaurantOrder.findMany({
    where: {
      ...dateFilter,
      status: { not: 'CANCELLED' },
    },
    include: {
      items: {
        include: {
          menuItem: { select: { name: true, category: { select: { name: true } } } },
        },
      },
    },
  });

  const totalOrders = orders.length;
  const totalSales = orders.reduce((sum, o) => sum + o.totalAmount, 0);
  const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

  // Orders by type breakdown
  const ordersByType: Record<string, { count: number; total: number }> = {};
  for (const order of orders) {
    const type = order.orderType;
    if (!ordersByType[type]) {
      ordersByType[type] = { count: 0, total: 0 };
    }
    ordersByType[type].count++;
    ordersByType[type].total += order.totalAmount;
  }

  // Top selling items
  const itemSales: Record<string, { name: string; quantity: number; revenue: number }> = {};
  for (const order of orders) {
    for (const item of order.items) {
      const key = item.menuItemId;
      if (!itemSales[key]) {
        itemSales[key] = {
          name: item.menuItem.name,
          quantity: 0,
          revenue: 0,
        };
      }
      itemSales[key].quantity += item.quantity;
      itemSales[key].revenue += item.price * item.quantity;
    }
  }

  const topSellingItems = Object.values(itemSales)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10);

  return successResponse({
    reportType: 'restaurant-daily',
    date: businessDate,
    businessDate,
    allTime: Object.keys(dateFilter).length === 0,
    totalOrders,
    totalSales,
    averageOrderValue,
    ordersByType,
    topSellingItems,
  });
}

// Restaurant Monthly Sales Report
async function handleRestaurantMonthly(user: { role: string }, dateFilter: Record<string, unknown>) {
  if (!canAccessRestaurant(user.role as 'ADMIN' | 'RESTAURANT_STAFF' | 'HOTEL_STAFF')) {
    return errorResponse('Access denied. RESTAURANT_STAFF or ADMIN only.', 403);
  }

  const now = new Date();
  const orderDateFilter = dateFilter;

  const orders = await db.restaurantOrder.findMany({
    where: {
      ...orderDateFilter,
      status: { not: 'CANCELLED' },
    },
    include: {
      items: {
        include: {
          menuItem: { select: { name: true } },
        },
      },
    },
  });

  const totalOrders = orders.length;
  const totalSales = orders.reduce((sum, o) => sum + o.totalAmount, 0);
  const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

  // Orders by type breakdown
  const ordersByType: Record<string, { count: number; total: number }> = {};
  for (const order of orders) {
    const type = order.orderType;
    if (!ordersByType[type]) {
      ordersByType[type] = { count: 0, total: 0 };
    }
    ordersByType[type].count++;
    ordersByType[type].total += order.totalAmount;
  }

  // Top selling items
  const itemSales: Record<string, { name: string; quantity: number; revenue: number }> = {};
  for (const order of orders) {
    for (const item of order.items) {
      const key = item.menuItemId;
      if (!itemSales[key]) {
        itemSales[key] = { name: item.menuItem.name, quantity: 0, revenue: 0 };
      }
      itemSales[key].quantity += item.quantity;
      itemSales[key].revenue += item.price * item.quantity;
    }
  }

  const topSellingItems = Object.values(itemSales)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // Daily breakdown for chart data
  const dailyBreakdown: Record<string, { orders: number; sales: number }> = {};
  for (const order of orders) {
    const day = order.createdAt.toISOString().slice(0, 10);
    if (!dailyBreakdown[day]) {
      dailyBreakdown[day] = { orders: 0, sales: 0 };
    }
    dailyBreakdown[day].orders++;
    dailyBreakdown[day].sales += order.totalAmount;
  }

  return successResponse({
    reportType: 'restaurant-monthly',
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    allTime: Object.keys(dateFilter).length === 0,
    totalOrders,
    totalSales,
    averageOrderValue,
    ordersByType,
    topSellingItems,
    dailyBreakdown,
  });
}

// Hotel Revenue Report for RRP Dream Inn
async function handleHotelRevenue(user: { role: string }, dateFilter: Record<string, unknown>) {
  if (!canAccessHotel(user.role as 'ADMIN' | 'HOTEL_STAFF' | 'RESTAURANT_STAFF')) {
    return errorResponse('Access denied. HOTEL_STAFF or ADMIN only.', 403);
  }

  const bookingDateFilter = Object.keys(dateFilter).length > 0
    ? dateFilter
    : {};

  const bookings = await db.booking.findMany({
    where: {
      ...bookingDateFilter,
      status: { not: 'CANCELLED' },
    },
    include: {
      room: { include: { type: true } },
    },
  });

  const totalBookings = bookings.length;
  const totalRevenue = bookings.reduce((sum, b) => sum + b.totalRoomCharge, 0);

  // Calculate occupancy rate
  const totalRooms = await db.room.count();
  const occupiedRooms = await db.room.count({ where: { status: 'OCCUPIED' } });
  const occupancyRate = totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;

  // Average room rate
  const averageRate = totalBookings > 0 ? totalRevenue / totalBookings : 0;

  // Revenue by room type
  const revenueByType: Record<string, { bookings: number; revenue: number }> = {};
  for (const booking of bookings) {
    const typeName = booking.room.type.name;
    if (!revenueByType[typeName]) {
      revenueByType[typeName] = { bookings: 0, revenue: 0 };
    }
    revenueByType[typeName].bookings++;
    revenueByType[typeName].revenue += booking.totalRoomCharge;
  }

  return successResponse({
    reportType: 'hotel-revenue',
    totalBookings,
    totalRevenue,
    occupancyRate: Math.round(occupancyRate * 100) / 100,
    averageRate: Math.round(averageRate * 100) / 100,
    revenueByType,
    occupiedRooms,
    totalRooms,
  });
}

// Hotel Occupancy Report
async function handleHotelOccupancy(user: { role: string }, dateFilter: Record<string, unknown>) {
  if (!canAccessHotel(user.role as 'ADMIN' | 'HOTEL_STAFF' | 'RESTAURANT_STAFF')) {
    return errorResponse('Access denied. HOTEL_STAFF or ADMIN only.', 403);
  }

  const totalRooms = await db.room.count();
  const roomsByStatus = await db.room.groupBy({
    by: ['status'],
    _count: { status: true },
  });

  const statusBreakdown: Record<string, number> = {};
  for (const entry of roomsByStatus) {
    statusBreakdown[entry.status] = entry._count.status;
  }

  const occupiedRooms = statusBreakdown['OCCUPIED'] || 0;
  const availableRooms = statusBreakdown['AVAILABLE'] || 0;
  const cleaningRooms = statusBreakdown['CLEANING'] || 0;
  const maintenanceRooms = statusBreakdown['MAINTENANCE'] || 0;

  const occupancyRate = totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;

  // Active bookings
  const activeBookings = await db.booking.count({
    where: {
      status: { in: ['CHECKED_IN', 'RESERVED'] },
    },
  });

  // Business-day activity (open window + in-house guests on business calendar day)
  const businessDate = await readCurrentBusinessDateString();
  const { openedAt } = await getOpenBusinessDayWindow();
  const now = new Date();

  const todayCheckins = await db.booking.count({
    where: buildBusinessDayArrivalsWhere(businessDate, openedAt, now),
  });

  const expectedArrivals = await db.booking.count({
    where: buildExpectedArrivalsOnBusinessDateWhere(businessDate),
  });

  const todayCheckouts = await db.booking.count({
    where: buildBusinessDayDeparturesWhere(businessDate),
  });

  const inHouseGuests = await db.booking.count({
    where: { AND: [buildInHouseOnBusinessDateWhere(businessDate), { status: 'CHECKED_IN' }] },
  });

  // Floor-wise occupancy
  const floors = await db.room.findMany({
    include: { type: true },
    orderBy: { floor: 'asc' },
  });

  const floorData: Record<number, { total: number; occupied: number }> = {};
  for (const room of floors) {
    if (!floorData[room.floor]) {
      floorData[room.floor] = { total: 0, occupied: 0 };
    }
    floorData[room.floor].total++;
    if (room.status === 'OCCUPIED') {
      floorData[room.floor].occupied++;
    }
  }

  return successResponse({
    reportType: 'hotel-occupancy',
    totalRooms,
    occupiedRooms,
    availableRooms,
    cleaningRooms,
    maintenanceRooms,
    occupancyRate: Math.round(occupancyRate * 100) / 100,
    activeBookings,
    todayCheckins,
    expectedArrivals,
    todayCheckouts,
    inHouseGuests,
    businessDate,
    statusBreakdown,
    floorData,
  });
}

// Food Charges by Room Report
async function handleFoodChargesByRoom(user: { role: string }, dateFilter: Record<string, unknown>) {
  if (!canAccessHotel(user.role as 'ADMIN' | 'HOTEL_STAFF' | 'RESTAURANT_STAFF')) {
    return errorResponse('Access denied. HOTEL_STAFF or ADMIN only.', 403);
  }

  const orderDateFilter = Object.keys(dateFilter).length > 0
    ? dateFilter
    : {};

  // Get restaurant orders that are linked to rooms
  const orders = await db.restaurantOrder.findMany({
    where: {
      ...orderDateFilter,
      roomId: { not: null },
      status: { not: 'CANCELLED' },
    },
    include: {
      room: { select: { id: true, roomNumber: true } },
    },
  });

  // Group by room
  const roomCharges: Record<string, { roomNumber: string; totalOrders: number; totalCharges: number; orders: Array<{ orderId: string; orderNumber: string; amount: number }> }> = {};

  for (const order of orders) {
    const roomId = order.roomId!;
    if (!roomCharges[roomId]) {
      roomCharges[roomId] = {
        roomNumber: order.room?.roomNumber || 'Unknown',
        totalOrders: 0,
        totalCharges: 0,
        orders: [],
      };
    }
    roomCharges[roomId].totalOrders++;
    roomCharges[roomId].totalCharges += order.totalAmount;
    roomCharges[roomId].orders.push({
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount: order.totalAmount,
    });
  }

  const result = Object.values(roomCharges).sort((a, b) => b.totalCharges - a.totalCharges);
  const grandTotal = result.reduce((sum, r) => sum + r.totalCharges, 0);

  return successResponse({
    reportType: 'food-charges-by-room',
    rooms: result,
    grandTotal,
    totalOrders: orders.length,
  });
}

// Combined Revenue Report - ADMIN only
async function handleCombinedRevenue(user: { role: string }, dateFilter: Record<string, unknown>) {
  if (!canAccessAdmin(user.role as 'ADMIN' | 'HOTEL_STAFF' | 'RESTAURANT_STAFF')) {
    return errorResponse('Access denied. ADMIN only.', 403);
  }

  const filterDate = Object.keys(dateFilter).length > 0 ? dateFilter : {};

  // Hotel revenue
  const hotelBookings = await db.booking.findMany({
    where: {
      ...filterDate,
      status: { not: 'CANCELLED' },
    },
  });

  const hotelRevenue = hotelBookings.reduce((sum, b) => sum + b.totalRoomCharge, 0);

  // Restaurant revenue
  const restaurantOrders = await db.restaurantOrder.findMany({
    where: {
      ...filterDate,
      status: { not: 'CANCELLED' },
    },
  });

  const restaurantRevenue = restaurantOrders.reduce((sum, o) => sum + o.totalAmount, 0);

  // Extra charges revenue
  const extraCharges = await db.roomCharge.findMany({
    where: {
      ...filterDate,
      chargeType: { not: 'ROOM_RATE' },
    },
  });

  const extraRevenue = extraCharges.reduce((sum, c) => sum + c.amount * c.quantity, 0);

  // Payments received
  const payments = await db.payment.findMany({
    where: filterDate,
  });

  const totalPaymentsReceived = payments.reduce((sum, p) => sum + p.amount, 0);

  // Payments by method
  const paymentsByMethod: Record<string, number> = {};
  for (const payment of payments) {
    if (!paymentsByMethod[payment.method]) {
      paymentsByMethod[payment.method] = 0;
    }
    paymentsByMethod[payment.method] += payment.amount;
  }

  const totalRevenue = hotelRevenue + restaurantRevenue + extraRevenue;

  return successResponse({
    reportType: 'combined-revenue',
    totalRevenue,
    hotelRevenue,
    restaurantRevenue,
    extraRevenue,
    totalPaymentsReceived,
    paymentsByMethod,
    totalBookings: hotelBookings.length,
    totalOrders: restaurantOrders.length,
  });
}

// Admin Summary - Full System Analytics
async function handleAdminSummary(user: { role: string }, dateFilter: Record<string, unknown>) {
  if (!canAccessAdmin(user.role as 'ADMIN' | 'HOTEL_STAFF' | 'RESTAURANT_STAFF')) {
    return errorResponse('Access denied. ADMIN only.', 403);
  }

  const filterDate = Object.keys(dateFilter).length > 0 ? dateFilter : {};

  // Revenue calculations
  const hotelBookings = await db.booking.findMany({
    where: { ...filterDate, status: { not: 'CANCELLED' } },
  });

  const hotelRevenue = hotelBookings.reduce((sum, b) => sum + b.totalRoomCharge, 0);

  const restaurantOrders = await db.restaurantOrder.findMany({
    where: { ...filterDate, status: { not: 'CANCELLED' } },
  });

  const restaurantRevenue = restaurantOrders.reduce((sum, o) => sum + o.totalAmount, 0);

  const totalRevenue = hotelRevenue + restaurantRevenue;

  // Room occupancy
  const totalRooms = await db.room.count();
  const occupiedRooms = await db.room.count({ where: { status: 'OCCUPIED' } });
  const occupancyRate = totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;

  // Top customers by spending
  const customerSpending: Record<string, { name: string; totalSpent: number; bookingCount: number }> = {};

  const bookingsWithCustomers = await db.booking.findMany({
    where: { ...filterDate, status: { not: 'CANCELLED' } },
    include: { customer: true },
  });

  for (const booking of bookingsWithCustomers) {
    const custId = booking.customerId;
    if (!customerSpending[custId]) {
      customerSpending[custId] = {
        name: booking.customer.name,
        totalSpent: 0,
        bookingCount: 0,
      };
    }
    customerSpending[custId].totalSpent += booking.totalRoomCharge;
    customerSpending[custId].bookingCount++;
  }

  const topCustomers = Object.values(customerSpending)
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 10);

  // Profit summary (revenue vs payments)
  const payments = await db.payment.findMany({ where: filterDate });
  const totalPaymentsReceived = payments.reduce((sum, p) => sum + p.amount, 0);

  const outstandingDues = hotelBookings.reduce((sum, b) => sum + b.dueAmount, 0);

  return successResponse({
    reportType: 'admin-summary',
    totalRevenue,
    hotelRevenue,
    restaurantRevenue,
    totalBookings: hotelBookings.length,
    totalOrders: restaurantOrders.length,
    occupancyRate: Math.round(occupancyRate * 100) / 100,
    occupiedRooms,
    totalRooms,
    topCustomers,
    profitSummary: {
      totalRevenue,
      totalPaymentsReceived,
      outstandingDues,
      netPosition: totalPaymentsReceived - outstandingDues,
    },
  });
}

// Order Status Distribution Report
async function handleOrderStatus(user: { role: string }, dateFilter: Record<string, unknown>) {
  if (!canAccessRestaurant(user.role as 'ADMIN' | 'RESTAURANT_STAFF' | 'HOTEL_STAFF')) {
    return errorResponse('Access denied. RESTAURANT_STAFF or ADMIN only.', 403);
  }

  const orderDateFilter = Object.keys(dateFilter).length > 0 ? dateFilter : {};

  const statusGroups = await db.restaurantOrder.groupBy({
    by: ['status'],
    where: orderDateFilter,
    _count: { status: true },
    _sum: { totalAmount: true },
  });

  const statusDistribution: Record<string, { count: number; totalAmount: number }> = {};
  for (const group of statusGroups) {
    statusDistribution[group.status] = {
      count: group._count.status,
      totalAmount: group._sum.totalAmount || 0,
    };
  }

  // Order type distribution
  const typeGroups = await db.restaurantOrder.groupBy({
    by: ['orderType'],
    where: orderDateFilter,
    _count: { orderType: true },
    _sum: { totalAmount: true },
  });

  const typeDistribution: Record<string, { count: number; totalAmount: number }> = {};
  for (const group of typeGroups) {
    typeDistribution[group.orderType] = {
      count: group._count.orderType,
      totalAmount: group._sum.totalAmount || 0,
    };
  }

  const totalOrders = Object.values(statusDistribution).reduce((sum, s) => sum + s.count, 0);

  return successResponse({
    reportType: 'order-status',
    statusDistribution,
    typeDistribution,
    totalOrders,
  });
}

async function handleHotelDailySales(
  user: { role: string },
  businessDateParam: string | null,
  dateFromParam: string | null,
  dateToParam: string | null
) {
  if (!canAccessHotel(user.role as 'ADMIN' | 'HOTEL_STAFF' | 'RESTAURANT_STAFF')) {
    return errorResponse('Access denied. HOTEL_STAFF or ADMIN only.', 403);
  }
  const rangeWindow = resolveDateRangeReportWindow({ dateFrom: dateFromParam, dateTo: dateToParam });
  const window = rangeWindow ?? await resolveBusinessDayReportWindow(businessDateParam);
  const report = await buildHotelDailySalesReport(window);
  return successResponse(report);
}

async function handleHotelDailyArrivals(user: { role: string }, businessDateParam: string | null) {
  if (!canAccessHotel(user.role as 'ADMIN' | 'HOTEL_STAFF' | 'RESTAURANT_STAFF')) {
    return errorResponse('Access denied. HOTEL_STAFF or ADMIN only.', 403);
  }
  const window = await resolveBusinessDayReportWindow(businessDateParam);
  const report = await buildHotelDailyArrivalsReport(window);
  return successResponse(report);
}

async function handleHotelDailyDepartures(user: { role: string }, businessDateParam: string | null) {
  if (!canAccessHotel(user.role as 'ADMIN' | 'HOTEL_STAFF' | 'RESTAURANT_STAFF')) {
    return errorResponse('Access denied. HOTEL_STAFF or ADMIN only.', 403);
  }
  const window = await resolveBusinessDayReportWindow(businessDateParam);
  const report = await buildHotelDailyDeparturesReport(window);
  return successResponse(report);
}

async function handleHotelDailyCollections(
  user: { role: string },
  businessDateParam: string | null,
  dateFromParam: string | null,
  dateToParam: string | null
) {
  if (!canAccessHotel(user.role as 'ADMIN' | 'HOTEL_STAFF' | 'RESTAURANT_STAFF')) {
    return errorResponse('Access denied. HOTEL_STAFF or ADMIN only.', 403);
  }
  const rangeWindow = resolveDateRangeReportWindow({ dateFrom: dateFromParam, dateTo: dateToParam });
  const window = rangeWindow ?? await resolveBusinessDayReportWindow(businessDateParam);
  const report = await buildHotelDailyCollectionsReport(window);
  return successResponse(report);
}

async function handleHotelDailyDiscounts(
  user: { role: string },
  businessDateParam: string | null,
  dateFromParam: string | null,
  dateToParam: string | null
) {
  if (!canAccessHotel(user.role as 'ADMIN' | 'HOTEL_STAFF' | 'RESTAURANT_STAFF')) {
    return errorResponse('Access denied. HOTEL_STAFF or ADMIN only.', 403);
  }
  if (dateFromParam || dateToParam) {
    const report = await buildHotelDiscountReportForDateRange(
      dateFromParam ?? undefined,
      dateToParam ?? undefined
    );
    return successResponse(report);
  }
  if (businessDateParam) {
    const window = await resolveBusinessDayReportWindow(businessDateParam);
    const report = await buildHotelDiscountReportForDateRange(window.businessDate, window.businessDate);
    return successResponse(report);
  }
  const report = await buildHotelDiscountReportForDateRange();
  return successResponse(report);
}
