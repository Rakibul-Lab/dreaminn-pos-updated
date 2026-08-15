import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, requireRole } from '@/lib/auth';
import { successResponse, paginatedResponse, errorResponse, logActivity } from '@/lib/api-utils';
import { Prisma, RoleType } from '@prisma/client';
import { resolveBookingCheckInOut } from '@/lib/app-settings';
import { readCurrentBusinessDateString } from '@/lib/business-date';
import {
  bookingVatOptions,
  computeRoomBookingTotals,
  sumBookingFolioRestaurant,
  sumBookingNetPaid,
  sumBookingPostedExtras,
} from '@/lib/booking-totals';
import {
  computeRoomDisplayStatus,
  computeRoomDisplayStatusForStayWindow,
  pickBookingForStayWindow,
  pickLiveActiveBooking,
  releasePrematureReservedRooms,
  syncArrivalReservedRoomStatuses,
} from '@/lib/room-effective-status';
import {
  applyReservationEntryRoomFilter,
  categoryCapacityToMeta,
  computeAvailableCapacityByType,
  computeCategoryCapacityForStayDates,
  fetchReservationEntryHoldsForRooms,
} from '@/lib/reservation-entry';
import {
  formatRoomsViewDateLabel,
  resolveRoomsViewContext,
  type RoomsViewDateScope,
} from '@/lib/rooms-view-date-filter';
import {
  filterSellableRooms,
  ROOM_STATUSES_DATE_SCOPED_CANDIDATES,
} from '@/lib/room-sellability';
import { attachMaintenancePurposes } from '@/lib/room-maintenance-purpose';

function parseTotalPrice(body: Record<string, unknown>) {
  if (body.totalPrice === undefined && body.basePrice === undefined) {
    return {};
  }
  const raw = body.totalPrice ?? body.basePrice;
  return { totalPrice: Math.max(0, parseFloat(String(raw)) || 0) };
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status');
    const floor = searchParams.get('floor');
    const typeId = searchParams.get('typeId');
    const forReservationEntry = searchParams.get('forReservationEntry') === 'true';
    const forBooking = searchParams.get('forBooking') === 'true' || forReservationEntry;
    const checkIn = searchParams.get('checkIn');
    const checkOut = searchParams.get('checkOut');
    const excludeEntryId = searchParams.get('excludeEntryId')?.trim() || undefined;
    const excludeBookingId = searchParams.get('excludeBookingId')?.trim() || undefined;
    const viewScope = (searchParams.get('viewScope') || 'business_day') as RoomsViewDateScope;
    const viewDateFrom = searchParams.get('dateFrom')?.trim() || undefined;
    const viewDateTo = searchParams.get('dateTo')?.trim() || undefined;

    const skip = (page - 1) * limit;

    const where: Prisma.RoomWhereInput = {};
    const dateScopedAvailability = Boolean(forBooking && checkIn && checkOut);

    if (forReservationEntry || dateScopedAvailability) {
      // Date-based availability: may include rooms occupied today but free on selected stay.
      // Maintenance / cleaning are never sellable.
      where.status = { in: [...ROOM_STATUSES_DATE_SCOPED_CANDIDATES] };
    } else if (forBooking) {
      where.status = 'AVAILABLE';
    } else if (status) {
      where.status = status as Prisma.EnumRoomStatusFilter['equals'];
    }
    if (floor) where.floor = parseInt(floor);
    if (typeId) where.typeId = typeId;

    if (checkIn && checkOut) {
      try {
        const { checkIn: checkInDate, checkOut: checkOutDate } = await resolveBookingCheckInOut(
          checkIn,
          checkOut
        );
        where.NOT = {
          bookings: {
            some: {
              status: { in: ['RESERVED', 'CHECKED_IN'] },
              checkIn: { lt: checkOutDate },
              checkOut: { gt: checkInDate },
              ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
            },
          },
        };
      } catch {
        // Invalid date range — skip availability filter
      }
    }

    let rooms = await db.room.findMany({
      where,
      include: { type: true },
      skip: forBooking && checkIn && checkOut ? 0 : skip,
      take: forBooking && checkIn && checkOut ? 500 : limit,
      orderBy: [
        { floor: 'asc' },
        { roomNumber: 'asc' },
      ],
    });

    if (forBooking && checkIn && checkOut) {
      try {
        const { checkIn: checkInDate, checkOut: checkOutDate } = await resolveBookingCheckInOut(
          checkIn,
          checkOut
        );
        rooms = await applyReservationEntryRoomFilter(
          rooms,
          checkInDate,
          checkOutDate,
          excludeEntryId
        );
      } catch (error) {
        console.error('Reservation entry room filter failed:', error);
      }
    }

    if (forBooking) {
      rooms = filterSellableRooms(rooms);
    }

    let categoryCapacity: Awaited<ReturnType<typeof computeCategoryCapacityForStayDates>> = [];
    if (forBooking && checkIn && checkOut) {
      try {
        const { checkIn: checkInDate, checkOut: checkOutDate } = await resolveBookingCheckInOut(
          checkIn,
          checkOut
        );
        const capacity = await computeAvailableCapacityByType(
          checkInDate,
          checkOutDate,
          excludeEntryId,
          excludeBookingId
        );
        categoryCapacity = categoryCapacityToMeta(capacity);
      } catch {
        // optional meta
      }
    }

    const total = forBooking && checkIn && checkOut
      ? rooms.length
      : await db.room.count({ where });

    if (forBooking && checkIn && checkOut) {
      rooms = rooms.slice(skip, skip + limit);
    }

    if (!forBooking) {
      const businessDate = await readCurrentBusinessDateString();
      await releasePrematureReservedRooms(db, businessDate);
      await syncArrivalReservedRoomStatuses(db, businessDate);

      const roomsView = resolveRoomsViewContext(
        viewScope,
        businessDate,
        viewDateFrom,
        viewDateTo
      );

      let viewStayCheckInDate: Date
      let viewStayCheckOutDate: Date
      try {
        ;({ checkIn: viewStayCheckInDate, checkOut: viewStayCheckOutDate } =
          await resolveBookingCheckInOut(roomsView.stayCheckIn, roomsView.stayCheckOut))
      } catch {
        viewStayCheckInDate = new Date(`${roomsView.stayCheckIn}T12:00:00`)
        viewStayCheckOutDate = new Date(`${roomsView.stayCheckOut}T12:00:00`)
      }

      const reflectLiveRoomState = roomsView.arrivalCutoff <= businessDate

      const roomIds = rooms.map((room) => room.id);
      const activeBookingWhere: Prisma.BookingWhereInput = reflectLiveRoomState
        ? {
            roomId: { in: roomIds },
            status: { in: ['RESERVED', 'CHECKED_IN'] },
          }
        : {
            roomId: { in: roomIds },
            status: { in: ['RESERVED', 'CHECKED_IN'] },
            checkIn: { lt: viewStayCheckOutDate },
            checkOut: { gt: viewStayCheckInDate },
          };

      const [activeBookings, pendingTasks, inProgressTasks, entryHolds, viewCategoryCapacity] =
        await Promise.all([
        roomIds.length
          ? db.booking.findMany({
              where: activeBookingWhere,
              select: {
                id: true,
                roomId: true,
                status: true,
                checkIn: true,
                checkOut: true,
                totalRoomCharge: true,
                advancePayment: true,
                adults: true,
                children: true,
                vatApplied: true,
                vatPercent: true,
                isInitialReservation: true,
                nidPhysicallyReceived: true,
                customer: { select: { name: true } },
                payments: { select: { amount: true, paymentType: true } },
                charges: { select: { chargeType: true, amount: true, quantity: true } },
                restaurantOrders: {
                  select: {
                    status: true,
                    billingDisposition: true,
                    totalAmount: true,
                    companyLedgerBill: { select: { id: true } },
                  },
                },
              },
              orderBy: [{ status: 'desc' }, { checkIn: 'asc' }],
            })
          : [],
        roomIds.length
          ? db.housekeepingTask.findMany({
              where: { roomId: { in: roomIds }, status: 'PENDING' },
              select: { id: true, roomId: true },
            })
          : [],
        roomIds.length
          ? db.housekeepingTask.findMany({
              where: { roomId: { in: roomIds }, status: 'IN_PROGRESS' },
              select: { id: true, roomId: true },
            })
          : [],
        fetchReservationEntryHoldsForRooms(roomIds, roomsView),
        computeCategoryCapacityForStayDates(roomsView.stayCheckIn, roomsView.stayCheckOut),
      ]);
      categoryCapacity = viewCategoryCapacity;

      const bookingsByRoom = new Map<string, (typeof activeBookings)[number][]>();
      for (const booking of activeBookings) {
        const list = bookingsByRoom.get(booking.roomId) ?? [];
        list.push(booking);
        bookingsByRoom.set(booking.roomId, list);
      }
      const housekeepingTaskByRoom = new Map<
        string,
        { id: string; status: 'PENDING' | 'IN_PROGRESS' }
      >();
      for (const task of pendingTasks) {
        if (!housekeepingTaskByRoom.has(task.roomId)) {
          housekeepingTaskByRoom.set(task.roomId, { id: task.id, status: 'PENDING' });
        }
      }
      for (const task of inProgressTasks) {
        housekeepingTaskByRoom.set(task.roomId, { id: task.id, status: 'IN_PROGRESS' });
      }
      const inProgressRoomIds = new Set(inProgressTasks.map((task) => task.roomId));

      const enrichedRooms = await attachMaintenancePurposes(
        rooms.map((room) => {
        const roomBookings = bookingsByRoom.get(room.id) ?? [];
        const roomBookingsForDisplay = roomBookings.map((b) => ({
          id: b.id,
          status: b.status as 'RESERVED' | 'CHECKED_IN',
          checkIn: b.checkIn,
          checkOut: b.checkOut,
          customerName: b.customer?.name,
        }));
        const viewBooking = pickBookingForStayWindow(
          roomBookingsForDisplay,
          viewStayCheckInDate,
          viewStayCheckOutDate
        );
        const liveBooking = reflectLiveRoomState
          ? pickLiveActiveBooking(roomBookingsForDisplay, businessDate)
          : null;
        const bookingForSnapshot = reflectLiveRoomState ? liveBooking : viewBooking;
        const activeBookingRecord = bookingForSnapshot
          ? roomBookings.find((b) => b.id === bookingForSnapshot.id)
          : undefined;
        const entryHold = entryHolds.get(room.id);
        const displayStatus = reflectLiveRoomState
          ? computeRoomDisplayStatus(
              room.status,
              liveBooking,
              businessDate,
              inProgressRoomIds.has(room.id),
              entryHold
                ? { guestName: entryHold.guestName, checkIn: entryHold.checkIn }
                : null
            )
          : computeRoomDisplayStatusForStayWindow(
              room.status,
              viewBooking,
              {
                cleaningInProgress: inProgressRoomIds.has(room.id),
                entryHold: entryHold
                  ? { guestName: entryHold.guestName, checkIn: entryHold.checkIn }
                  : null,
                reflectLiveRoomState,
              }
            );

        const bookingSnapshot = activeBookingRecord
          ? (() => {
              const { payments, charges, restaurantOrders, ...bookingRest } =
                activeBookingRecord;
              const totals = computeRoomBookingTotals(
                bookingRest.totalRoomCharge,
                sumBookingNetPaid(payments),
                bookingVatOptions(bookingRest)
              );
              const extraChargesTotal = sumBookingPostedExtras(charges, payments);
              const restaurantChargesTotal = sumBookingFolioRestaurant(restaurantOrders);
              return {
                id: bookingRest.id,
                status: bookingRest.status,
                checkIn: bookingRest.checkIn,
                checkOut: bookingRest.checkOut,
                customerName: bookingRest.customer?.name,
                adults: bookingRest.adults,
                children: bookingRest.children,
                totalRoomCharge: bookingRest.totalRoomCharge,
                advancePayment: bookingRest.advancePayment,
                vatPercent: totals.vatPercent,
                vatAmount: totals.vatAmount,
                extraChargesTotal,
                restaurantChargesTotal,
                totalWithVat:
                  totals.totalWithVat + extraChargesTotal + restaurantChargesTotal,
                dueAmount: totals.dueAmount,
                isInitialReservation: bookingRest.isInitialReservation,
                nidPhysicallyReceived: bookingRest.nidPhysicallyReceived,
              };
            })()
          : null;

        return {
          ...room,
          displayStatus,
          entryHold: entryHold
            ? {
                entryId: entryHold.entryId,
                guestName: entryHold.guestName,
                checkIn: entryHold.checkIn,
                categoryPool: entryHold.categoryPool === true,
              }
            : null,
          activeBooking: bookingSnapshot,
          housekeepingTask: housekeepingTaskByRoom.get(room.id) ?? null,
          pendingHousekeepingTask: housekeepingTaskByRoom.get(room.id) ?? null,
        };
      })
      );

      return paginatedResponse(enrichedRooms, total, page, limit, {
        categoryCapacity,
        viewScope,
        viewLabel: formatRoomsViewDateLabel(viewScope, businessDate, viewDateFrom, viewDateTo),
        viewStayCheckIn: roomsView.stayCheckIn,
        viewStayCheckOut: roomsView.stayCheckOut,
        viewIsOperational: reflectLiveRoomState,
      });
    }

    if (forBooking && checkIn && checkOut) {
      return paginatedResponse(rooms, total, page, limit, { categoryCapacity });
    }

    return paginatedResponse(rooms, total, page, limit);
  } catch (error) {
    console.error('Rooms list error:', error);
    return errorResponse('Failed to fetch rooms', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType);
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const { roomNumber, floor, typeId } = body;

    if (!roomNumber || !typeId) {
      return errorResponse('Room number and type ID are required');
    }

    const existing = await db.room.findUnique({ where: { roomNumber } });
    if (existing) {
      return errorResponse('Room number already exists');
    }

    const roomType = await db.roomType.findUnique({ where: { id: typeId } });
    if (!roomType) {
      return errorResponse('Room type not found');
    }

    const room = await db.room.create({
      data: {
        roomNumber,
        floor: floor || 1,
        typeId,
        status: 'AVAILABLE',
        totalPrice: 0,
        ...parseTotalPrice(body),
      },
      include: { type: true },
    });

    await logActivity(
      authResult.id,
      'CREATE_ROOM',
      'hotel',
      JSON.stringify({ roomId: room.id, roomNumber })
    );

    return successResponse(room, 'Room created successfully', 201);
  } catch (error) {
    console.error('Room creation error:', error);
    return errorResponse('Failed to create room', 500);
  }
}
