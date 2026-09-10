import type { AppRole } from '@/lib/roles'
import { APP_ROLES } from '@/lib/roles'

/** Unique ERP shell page keys (sidebar destinations). */
export type AppPageKey =
  | 'hotel-dashboard'
  | 'rooms'
  | 'room-types'
  | 'bookings'
  | 'customers'
  | 'company-ledger'
  | 'housekeeping'
  | 'hotel-beverage-sales'
  | 'transport-sales'
  | 'invoices'
  | 'payments'
  | 'deposits'
  | 'reports'
  | 'day-close'
  | 'business-day-reports'
  | 'admin-dashboard'
  | 'users'
  | 'roles-permissions'
  | 'settings'
  | 'logs'
  | 'inventory'
  | 'profile'

export type PermissionGroup =
  | 'RRP Dream Inn'
  | 'Billing'
  | 'Analytics'
  | 'System'
  | 'Account'

export type AppPermissionDef = {
  key: string
  pageKey: AppPageKey
  label: string
  group: PermissionGroup
  description?: string
}

/** Catalog of selectable menu / page permissions. */
export const APP_PERMISSION_CATALOG: AppPermissionDef[] = [
  {
    key: 'page.hotel-dashboard',
    pageKey: 'hotel-dashboard',
    label: 'Dashboard',
    group: 'RRP Dream Inn',
    description: 'Hotel operations overview',
  },
  {
    key: 'page.rooms',
    pageKey: 'rooms',
    label: 'Rooms',
    group: 'RRP Dream Inn',
    description: 'Room board and status',
  },
  {
    key: 'page.room-types',
    pageKey: 'room-types',
    label: 'Room Types',
    group: 'RRP Dream Inn',
    description: 'Room type configuration',
  },
  {
    key: 'page.bookings',
    pageKey: 'bookings',
    label: 'Bookings',
    group: 'RRP Dream Inn',
    description: 'Reservations and stays',
  },
  {
    key: 'page.customers',
    pageKey: 'customers',
    label: 'Guests',
    group: 'RRP Dream Inn',
    description: 'Guest profiles',
  },
  {
    key: 'page.company-ledger',
    pageKey: 'company-ledger',
    label: 'Company Ledger',
    group: 'RRP Dream Inn',
    description: 'Corporate billing ledger',
  },
  {
    key: 'page.housekeeping',
    pageKey: 'housekeeping',
    label: 'Housekeeping',
    group: 'RRP Dream Inn',
    description: 'Housekeeping tasks',
  },
  {
    key: 'page.hotel-beverage-sales',
    pageKey: 'hotel-beverage-sales',
    label: 'Beverage Sales',
    group: 'RRP Dream Inn',
    description: 'Hotel beverage POS',
  },
  {
    key: 'page.transport-sales',
    pageKey: 'transport-sales',
    label: 'Transport',
    group: 'RRP Dream Inn',
    description: 'Transport sales',
  },
  {
    key: 'page.invoices',
    pageKey: 'invoices',
    label: 'Invoices',
    group: 'Billing',
  },
  {
    key: 'page.payments',
    pageKey: 'payments',
    label: 'Payments',
    group: 'Billing',
  },
  {
    key: 'page.deposits',
    pageKey: 'deposits',
    label: 'Head Office',
    group: 'Billing',
    description: 'Head-office remittances',
  },
  {
    key: 'page.reports',
    pageKey: 'reports',
    label: 'Reports',
    group: 'Analytics',
  },
  {
    key: 'page.day-close',
    pageKey: 'day-close',
    label: 'Day Close',
    group: 'Analytics',
  },
  {
    key: 'page.business-day-reports',
    pageKey: 'business-day-reports',
    label: 'Business Day Reports',
    group: 'Analytics',
  },
  {
    key: 'page.admin-dashboard',
    pageKey: 'admin-dashboard',
    label: 'Admin Overview',
    group: 'System',
  },
  {
    key: 'page.users',
    pageKey: 'users',
    label: 'Users',
    group: 'System',
    description: 'Create and manage user accounts',
  },
  {
    key: 'page.roles-permissions',
    pageKey: 'roles-permissions',
    label: 'Roles & Permissions',
    group: 'System',
    description: 'Control menu and page access by role or user',
  },
  {
    key: 'page.inventory',
    pageKey: 'inventory',
    label: 'Inventory',
    group: 'System',
  },
  {
    key: 'page.settings',
    pageKey: 'settings',
    label: 'Settings',
    group: 'System',
  },
  {
    key: 'page.logs',
    pageKey: 'logs',
    label: 'Activity Logs',
    group: 'System',
  },
  {
    key: 'page.profile',
    pageKey: 'profile',
    label: 'My Profile',
    group: 'Account',
    description: 'Always available to signed-in users',
  },
]

export const PERMISSION_GROUPS: PermissionGroup[] = [
  'RRP Dream Inn',
  'Billing',
  'Analytics',
  'System',
  'Account',
]

/** Keys that cannot be removed from the ADMIN role. */
export const ADMIN_LOCKED_PERMISSION_KEYS = [
  'page.admin-dashboard',
  'page.users',
  'page.roles-permissions',
  'page.profile',
] as const

/** Always granted to every active user. */
export const ALWAYS_GRANTED_PERMISSION_KEYS = ['page.profile'] as const

/**
 * Default matrix matching the previous hardcoded sidebar allow-lists.
 * Used to seed the DB and as a safe fallback when tables are empty.
 */
export const DEFAULT_ROLE_PERMISSION_KEYS: Record<AppRole, string[]> = {
  ADMIN: APP_PERMISSION_CATALOG.map((p) => p.key),
  HOTEL_STAFF: [
    'page.hotel-dashboard',
    'page.rooms',
    'page.room-types',
    'page.bookings',
    'page.customers',
    'page.company-ledger',
    'page.housekeeping',
    'page.hotel-beverage-sales',
    'page.transport-sales',
    'page.invoices',
    'page.payments',
    'page.deposits',
    'page.reports',
    'page.day-close',
    'page.business-day-reports',
    'page.profile',
  ],
  HOTEL_FD: [
    'page.hotel-dashboard',
    'page.rooms',
    'page.bookings',
    'page.customers',
    'page.company-ledger',
    'page.housekeeping',
    'page.hotel-beverage-sales',
    'page.transport-sales',
    'page.invoices',
    'page.payments',
    'page.deposits',
    'page.reports',
    'page.day-close',
    'page.business-day-reports',
    'page.profile',
  ],
  RESTAURANT_STAFF: [
    'page.company-ledger',
    'page.payments',
    'page.reports',
    'page.business-day-reports',
    'page.profile',
  ],
  HOUSEKEEPER: ['page.rooms', 'page.inventory', 'page.profile'],
}

export function permissionKeyForPage(pageKey: string): string {
  return `page.${pageKey}`
}

export function pageKeyFromPermission(permissionKey: string): AppPageKey | null {
  const match = APP_PERMISSION_CATALOG.find((p) => p.key === permissionKey)
  return match?.pageKey ?? null
}

export function isKnownPermissionKey(key: string): boolean {
  return APP_PERMISSION_CATALOG.some((p) => p.key === key)
}

export function defaultPermissionKeysForRole(role: string): string[] {
  if ((APP_ROLES as string[]).includes(role)) {
    return [...DEFAULT_ROLE_PERMISSION_KEYS[role as AppRole]]
  }
  return [...ALWAYS_GRANTED_PERMISSION_KEYS]
}

export function applyPermissionOverrides(
  roleKeys: Iterable<string>,
  overrides: Array<{ permissionKey: string; granted: boolean }>
): Set<string> {
  const effective = new Set(roleKeys)
  for (const row of overrides) {
    if (row.granted) effective.add(row.permissionKey)
    else effective.delete(row.permissionKey)
  }
  for (const key of ALWAYS_GRANTED_PERMISSION_KEYS) {
    effective.add(key)
  }
  return effective
}

export function groupPermissionsBySection() {
  return PERMISSION_GROUPS.map((group) => ({
    group,
    permissions: APP_PERMISSION_CATALOG.filter((p) => p.group === group),
  })).filter((section) => section.permissions.length > 0)
}
