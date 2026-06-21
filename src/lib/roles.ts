/** Shared role labels and permission helpers (client + server safe). */

export type AppRole =
  | 'ADMIN'
  | 'HOTEL_STAFF'
  | 'HOTEL_FD'
  | 'RESTAURANT_STAFF'
  | 'HOUSEKEEPER';

export const ROLE_LABELS: Record<AppRole, string> = {
  ADMIN: 'Admin',
  HOTEL_STAFF: 'Hotel Manager',
  HOTEL_FD: 'Hotel F.D.',
  RESTAURANT_STAFF: 'Restaurant Staff',
  HOUSEKEEPER: 'Housekeeper',
};

export function formatRoleLabel(role: string | undefined | null): string {
  if (!role) return '—';
  return ROLE_LABELS[role as AppRole] ?? role.replace(/_/g, ' ');
}

export function isHousekeeper(role: string | undefined | null): boolean {
  return role === 'HOUSEKEEPER';
}

export function canAccessHotel(role: string | undefined | null): boolean {
  return role === 'ADMIN' || role === 'HOTEL_STAFF' || role === 'HOTEL_FD';
}

export function canAccessRestaurant(role: string | undefined | null): boolean {
  return role === 'ADMIN' || role === 'RESTAURANT_STAFF';
}

export function canAccessAdmin(role: string | undefined | null): boolean {
  return role === 'ADMIN';
}

/** Admin + housekeeper — stock and supplies */
export function canAccessInventory(role: string | undefined | null): boolean {
  return role === 'ADMIN' || role === 'HOUSEKEEPER';
}

/** Housekeeper rooms board — no reserve/check-in/edit; cleaning via canPerformRoomCleaning */
export function isRoomsViewOnly(role: string | undefined | null): boolean {
  return isHousekeeper(role);
}

/** Start or complete room cleaning from the Rooms menu */
export function canPerformRoomCleaning(role: string | undefined | null): boolean {
  return (
    isHousekeeper(role) ||
    role === 'ADMIN' ||
    role === 'HOTEL_STAFF' ||
    role === 'HOTEL_FD'
  );
}

/** Hotel Manager + Admin — full room & room-type management */
export function canManageRoomInventory(role: string | undefined | null): boolean {
  return role === 'ADMIN' || role === 'HOTEL_STAFF';
}

/** Front desk: rooms list + status changes only */
export function isHotelFrontDesk(role: string | undefined | null): boolean {
  return role === 'HOTEL_FD';
}

export function isHotelManager(role: string | undefined | null): boolean {
  return role === 'HOTEL_STAFF';
}

export function isHotelTeamMember(role: string | undefined | null): boolean {
  return role === 'HOTEL_STAFF' || role === 'HOTEL_FD';
}

export function canAccessRoomTypesNav(role: string | undefined | null): boolean {
  return canManageRoomInventory(role);
}

export function canPerformHotelClearance(role: string | undefined | null): boolean {
  return canAccessAdmin(role) || isHotelTeamMember(role);
}
