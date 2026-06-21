import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/api-utils';
import { RoleType } from '@prisma/client';
import { getCalendarDayBounds, getOpenBusinessDayWindow } from '@/lib/business-date';

function mapRoomRow(room: {
  id: string;
  roomNumber: string;
  type: { name: string };
  bookings: { id: string }[];
}) {
  return {
    room_id: room.id,
    room_number: room.roomNumber,
    room_type: room.type.name,
    current_booking_id: room.bookings.length > 0 ? room.bookings[0].id : null,
  };
}

async function fetchBusinessDayCheckInRooms() {
  const { businessDate, openedAt, endsAt } = await getOpenBusinessDayWindow();
  const { start, end } = getCalendarDayBounds(businessDate);

  const rooms = await db.room.findMany({
    where: {
      status: 'OCCUPIED',
      bookings: {
        some: {
          status: 'CHECKED_IN',
          OR: [
            { actualCheckIn: { gte: openedAt, lte: endsAt } },
            {
              actualCheckIn: null,
              checkIn: { gte: start, lte: end },
            },
          ],
        },
      },
    },
    include: {
      type: { select: { name: true } },
      bookings: {
        where: {
          status: 'CHECKED_IN',
          OR: [
            { actualCheckIn: { gte: openedAt, lte: endsAt } },
            {
              actualCheckIn: null,
              checkIn: { gte: start, lte: end },
            },
          ],
        },
        select: { id: true },
        take: 1,
        orderBy: { actualCheckIn: 'desc' },
      },
    },
    orderBy: { roomNumber: 'asc' },
  });

  return {
    businessDate,
    rooms: rooms
      .filter((room) => room.bookings.length > 0)
      .map(mapRoomRow),
  };
}

async function fetchAllOccupiedRooms() {
  const occupiedRooms = await db.room.findMany({
    where: { status: 'OCCUPIED' },
    include: {
      type: { select: { name: true } },
      bookings: {
        where: { status: 'CHECKED_IN' },
        select: { id: true },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { roomNumber: 'asc' },
  });

  return occupiedRooms.map(mapRoomRow);
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(
      request,
      'ADMIN' as RoleType,
      'HOTEL_STAFF' as RoleType,
      'HOTEL_FD' as RoleType,
      'RESTAURANT_STAFF' as RoleType
    );
    if (authResult instanceof Response) return authResult;

    const businessDayCheckIn =
      request.nextUrl.searchParams.get('businessDayCheckIn') === '1' ||
      request.nextUrl.searchParams.get('scope') === 'business_day_checkin';

    if (businessDayCheckIn) {
      const { rooms } = await fetchBusinessDayCheckInRooms();
      return successResponse(rooms);
    }

    const result = await fetchAllOccupiedRooms();
    return successResponse(result);
  } catch (error) {
    console.error('Occupied rooms fetch error:', error);
    return errorResponse('Failed to fetch occupied rooms', 500);
  }
}
