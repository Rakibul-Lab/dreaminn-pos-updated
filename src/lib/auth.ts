import { NextRequest, NextResponse } from 'next/server';
import { RoleType } from '@prisma/client';
import { db } from '@/lib/db';
import { isIdleSessionExpired } from '@/lib/session';
import { parseSessionToken } from '@/lib/session-token';
import {
  canAccessAdmin as canAccessAdminRole,
  canAccessHotel as canAccessHotelRole,
  canAccessRestaurant as canAccessRestaurantRole,
  canManageRoomInventory,
} from '@/lib/roles';

export const HOTEL_ACCESS_ROLES: RoleType[] = ['ADMIN', 'HOTEL_STAFF', 'HOTEL_FD'];
export const HOTEL_MANAGER_ROLES: RoleType[] = ['ADMIN', 'HOTEL_STAFF'];
export const INVENTORY_ACCESS_ROLES: RoleType[] = ['ADMIN', 'HOUSEKEEPER'];
/** Create/update cleaning tasks (Rooms menu + Housekeeping) */
export const HOUSEKEEPING_TASK_ROLES: RoleType[] = [...HOTEL_ACCESS_ROLES, 'HOUSEKEEPER'];

export { canManageRoomInventory };

// Session auth: client sends x-user-* + x-token from login; server validates token shape and user record.

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: RoleType;
}

function readHeaderUser(request: NextRequest): Omit<AuthUser, 'name'> & { name: string } | null {
  const userId = request.headers.get('x-user-id');
  const userEmail = request.headers.get('x-user-email');
  const userName = request.headers.get('x-user-name');
  const userRole = request.headers.get('x-user-role') as RoleType;

  if (!userId || !userEmail || !userRole) {
    return null;
  }

  return {
    id: userId,
    email: userEmail,
    name: userName || '',
    role: userRole,
  };
}

export function validateSession(request: NextRequest): NextResponse | null {
  const lastActivityHeader = request.headers.get('x-last-activity');
  const lastActivity = lastActivityHeader ? Number(lastActivityHeader) : null;

  if (lastActivity && Number.isFinite(lastActivity) && isIdleSessionExpired(lastActivity)) {
    return NextResponse.json(
      { error: 'Session expired due to inactivity', code: 'SESSION_EXPIRED' },
      { status: 401 }
    );
  }

  return null;
}

export async function requireAuth(request: NextRequest): Promise<AuthUser | NextResponse> {
  const sessionError = validateSession(request);
  if (sessionError) return sessionError;

  const headerUser = readHeaderUser(request);
  const token = request.headers.get('x-token');
  const parsedToken = parseSessionToken(token);

  if (!headerUser || !parsedToken || parsedToken.userId !== headerUser.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const dbUser = await db.user.findUnique({
    where: { id: headerUser.id },
    select: { id: true, email: true, name: true, role: true, active: true },
  });

  if (
    !dbUser ||
    !dbUser.active ||
    dbUser.email !== headerUser.email ||
    dbUser.role !== headerUser.role
  ) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  return {
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    role: dbUser.role,
  };
}

export async function requireRole(
  request: NextRequest,
  ...roles: RoleType[]
): Promise<AuthUser | NextResponse> {
  const result = await requireAuth(request);
  if (result instanceof NextResponse) return result;

  if (!roles.includes(result.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  return result;
}

export async function requireHotelAccess(request: NextRequest): Promise<AuthUser | NextResponse> {
  return requireRole(request, ...HOTEL_ACCESS_ROLES);
}

export async function requireHotelManager(request: NextRequest): Promise<AuthUser | NextResponse> {
  return requireRole(request, ...HOTEL_MANAGER_ROLES);
}

export async function requireInventoryAccess(request: NextRequest): Promise<AuthUser | NextResponse> {
  return requireRole(request, ...INVENTORY_ACCESS_ROLES);
}

// Permission checks
export function canAccessHotel(role: RoleType): boolean {
  return canAccessHotelRole(role);
}

export function canAccessRestaurant(role: RoleType): boolean {
  return canAccessRestaurantRole(role);
}

export function canAccessAdmin(role: RoleType): boolean {
  return canAccessAdminRole(role);
}
