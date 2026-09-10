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

export type PermissionKind = 'page' | 'action'

export type AppPermissionDef = {
  key: string
  kind: PermissionKind
  pageKey: AppPageKey
  label: string
  group: PermissionGroup
  description?: string
}

function page(
  pageKey: AppPageKey,
  label: string,
  group: PermissionGroup,
  description?: string
): AppPermissionDef {
  return {
    key: `page.${pageKey}`,
    kind: 'page',
    pageKey,
    label,
    group,
    description,
  }
}

/** `area` is the action namespace, e.g. bookings → action.bookings.edit */
function action(
  pageKey: AppPageKey,
  area: string,
  verb: string,
  label: string,
  group: PermissionGroup,
  description?: string
): AppPermissionDef {
  return {
    key: `action.${area}.${verb}`,
    kind: 'action',
    pageKey,
    label,
    group,
    description,
  }
}

/** Full catalog: open-page keys + detailed in-page actions. */
export const APP_PERMISSION_CATALOG: AppPermissionDef[] = [
  page('hotel-dashboard', 'Dashboard', 'RRP Dream Inn', 'Hotel operations overview'),
  action(
    'hotel-dashboard',
    'dashboard',
    'view_room_stats',
    'View room status cards',
    'RRP Dream Inn',
    'Total, occupied, available, cleaning counts'
  ),
  action(
    'hotel-dashboard',
    'dashboard',
    'view_arrivals_departures',
    'View arrival & check-out cards',
    'RRP Dream Inn',
    'Today’s arrivals and check-outs summary'
  ),
  action(
    'hotel-dashboard',
    'dashboard',
    'view_revenue',
    'View revenue & due cards',
    'RRP Dream Inn',
    'Hotel revenue, today’s revenue, and total due'
  ),
  action(
    'hotel-dashboard',
    'dashboard',
    'view_occupancy_chart',
    'View occupancy chart',
    'RRP Dream Inn'
  ),
  action(
    'hotel-dashboard',
    'dashboard',
    'view_revenue_chart',
    'View revenue chart',
    'RRP Dream Inn',
    '7-day revenue trend'
  ),
  action(
    'hotel-dashboard',
    'dashboard',
    'view_arrivals_list',
    'View today’s arrivals list',
    'RRP Dream Inn'
  ),
  action(
    'hotel-dashboard',
    'dashboard',
    'view_room_service',
    'View room service orders',
    'RRP Dream Inn'
  ),
  action(
    'hotel-dashboard',
    'dashboard',
    'quick_new_reservation',
    'Quick action: New reservation',
    'RRP Dream Inn'
  ),
  action(
    'hotel-dashboard',
    'dashboard',
    'quick_bookings',
    'Quick action: Bookings',
    'RRP Dream Inn'
  ),
  action(
    'hotel-dashboard',
    'dashboard',
    'quick_check_in',
    'Quick action: Check-in',
    'RRP Dream Inn'
  ),
  action(
    'hotel-dashboard',
    'dashboard',
    'quick_check_out',
    'Quick action: Check-out',
    'RRP Dream Inn'
  ),

  page('rooms', 'Rooms', 'RRP Dream Inn', 'Room board and status'),
  action('rooms', 'rooms', 'create', 'Add room', 'RRP Dream Inn'),
  action('rooms', 'rooms', 'edit', 'Edit room', 'RRP Dream Inn'),
  action('rooms', 'rooms', 'change_status', 'Change room status', 'RRP Dream Inn'),
  action('rooms', 'rooms', 'set_maintenance', 'Set maintenance', 'RRP Dream Inn'),
  action('rooms', 'rooms', 'reserve', 'Reserve room', 'RRP Dream Inn'),
  action('rooms', 'rooms', 'check_in', 'Check-in from room', 'RRP Dream Inn'),
  action('rooms', 'rooms', 'check_out', 'Check-out from room', 'RRP Dream Inn'),
  action('rooms', 'rooms', 'pay', 'Take payment from room', 'RRP Dream Inn'),
  action('rooms', 'rooms', 'add_restaurant_bill', 'Add F&B from room', 'RRP Dream Inn'),
  action('rooms', 'rooms', 'generate_invoice', 'Generate invoice from room', 'RRP Dream Inn'),
  action('rooms', 'rooms', 'start_cleaning', 'Start cleaning', 'RRP Dream Inn'),
  action('rooms', 'rooms', 'complete_cleaning', 'Complete cleaning', 'RRP Dream Inn'),
  action('rooms', 'rooms', 'export', 'Export rooms', 'RRP Dream Inn'),

  page('room-types', 'Room Types', 'RRP Dream Inn'),
  action('room-types', 'room_types', 'create', 'Add room type', 'RRP Dream Inn'),
  action('room-types', 'room_types', 'edit', 'Edit room type', 'RRP Dream Inn'),
  action('room-types', 'room_types', 'delete', 'Delete room type', 'RRP Dream Inn'),

  page('bookings', 'Bookings', 'RRP Dream Inn', 'Reservations and stays'),
  action('bookings', 'bookings', 'create', 'New reservation', 'RRP Dream Inn'),
  action('bookings', 'bookings', 'edit', 'Edit booking', 'RRP Dream Inn'),
  action('bookings', 'bookings', 'check_in', 'Check-in', 'RRP Dream Inn'),
  action('bookings', 'bookings', 'check_out', 'Check-out', 'RRP Dream Inn'),
  action('bookings', 'bookings', 'cancel', 'Cancel reservation', 'RRP Dream Inn'),
  action('bookings', 'bookings', 'pay', 'Record payment', 'RRP Dream Inn'),
  action('bookings', 'bookings', 'transfer_bill', 'Transfer bill', 'RRP Dream Inn'),
  action('bookings', 'bookings', 'add_restaurant_bill', 'Add restaurant bill', 'RRP Dream Inn'),
  action('bookings', 'bookings', 'upload_id', 'Upload ID documents', 'RRP Dream Inn'),
  action('bookings', 'bookings', 'print_reservation', 'Print reservation', 'RRP Dream Inn'),
  action('bookings', 'bookings', 'print_registration', 'Registration form', 'RRP Dream Inn'),
  action('bookings', 'bookings', 'generate_invoice', 'Generate invoice', 'RRP Dream Inn'),
  action('bookings', 'bookings', 'export', 'Export bookings', 'RRP Dream Inn'),
  action('bookings', 'bookings', 'entry_convert', 'Convert reservation entry', 'RRP Dream Inn'),
  action('bookings', 'bookings', 'entry_cancel', 'Cancel reservation entry', 'RRP Dream Inn'),

  page('customers', 'Guests', 'RRP Dream Inn', 'Guest profiles'),
  action('customers', 'customers', 'create', 'Add guest', 'RRP Dream Inn'),
  action('customers', 'customers', 'view_history', 'View guest history', 'RRP Dream Inn'),
  action('customers', 'customers', 'export', 'Export guests', 'RRP Dream Inn'),

  page('company-ledger', 'Company Ledger', 'RRP Dream Inn', 'Corporate billing ledger'),
  action('company-ledger', 'company_ledger', 'create', 'Add company', 'RRP Dream Inn'),
  action('company-ledger', 'company_ledger', 'edit', 'Edit company', 'RRP Dream Inn'),
  action('company-ledger', 'company_ledger', 'delete', 'Delete company', 'RRP Dream Inn'),
  action('company-ledger', 'company_ledger', 'pay_bill', 'Record ledger payment', 'RRP Dream Inn'),
  action('company-ledger', 'company_ledger', 'hotel_clear', 'Clear hotel due', 'RRP Dream Inn'),
  action('company-ledger', 'company_ledger', 'export', 'Export ledger', 'RRP Dream Inn'),

  page('housekeeping', 'Housekeeping', 'RRP Dream Inn'),
  action('housekeeping', 'housekeeping', 'create_task', 'Create task', 'RRP Dream Inn'),
  action('housekeeping', 'housekeeping', 'start', 'Start task', 'RRP Dream Inn'),
  action('housekeeping', 'housekeeping', 'complete', 'Complete task', 'RRP Dream Inn'),
  action('housekeeping', 'housekeeping', 'manage_staff', 'Manage cleaning staff', 'RRP Dream Inn'),

  page('hotel-beverage-sales', 'Beverage Sales', 'RRP Dream Inn'),
  action('hotel-beverage-sales', 'beverage', 'sell', 'Complete beverage sale', 'RRP Dream Inn'),
  action('hotel-beverage-sales', 'beverage', 'manage_menu', 'Manage beverage menu', 'RRP Dream Inn'),
  action('hotel-beverage-sales', 'beverage', 'view_history', 'View beverage history', 'RRP Dream Inn'),
  action('hotel-beverage-sales', 'beverage', 'print_receipt', 'Print beverage receipt', 'RRP Dream Inn'),

  page('transport-sales', 'Transport', 'RRP Dream Inn'),
  action('transport-sales', 'transport', 'sell', 'Complete transport sale', 'RRP Dream Inn'),
  action('transport-sales', 'transport', 'pay', 'Take transport payment', 'RRP Dream Inn'),
  action('transport-sales', 'transport', 'view_history', 'View transport history', 'RRP Dream Inn'),
  action('transport-sales', 'transport', 'print_invoice', 'Print transport invoice', 'RRP Dream Inn'),

  page('invoices', 'Invoices', 'Billing'),
  action('invoices', 'invoices', 'generate', 'Generate invoice', 'Billing'),
  action('invoices', 'invoices', 'view', 'View invoice', 'Billing'),
  action('invoices', 'invoices', 'print', 'Print invoice', 'Billing'),
  action('invoices', 'invoices', 'record_payment', 'Record invoice payment', 'Billing'),

  page('payments', 'Payments', 'Billing'),
  action('payments', 'payments', 'record', 'Record payment', 'Billing'),
  action('payments', 'payments', 'send_to_room', 'Send charge to room', 'Billing'),
  action('payments', 'payments', 'manage_types', 'Manage payment types', 'Billing'),
  action('payments', 'payments', 'print_slip', 'Print payment slip', 'Billing'),
  action('payments', 'payments', 'export', 'Export payments', 'Billing'),

  page('deposits', 'Head Office', 'Billing', 'Head-office remittances'),
  action('deposits', 'deposits', 'create', 'Record remittance', 'Billing'),
  action('deposits', 'deposits', 'export', 'Export remittances', 'Billing'),

  page('reports', 'Reports', 'Analytics'),
  action('reports', 'reports', 'export', 'Export reports', 'Analytics'),

  page('day-close', 'Day Close', 'Analytics'),
  action('day-close', 'day_close', 'save_opening', 'Save opening cash', 'Analytics'),
  action('day-close', 'day_close', 'close', 'Close business day', 'Analytics'),

  page('business-day-reports', 'Business Day Reports', 'Analytics'),
  action('business-day-reports', 'business_day_reports', 'export', 'Export business day reports', 'Analytics'),

  page('admin-dashboard', 'Admin Overview', 'System'),
  action(
    'admin-dashboard',
    'admin_dashboard',
    'view_stats',
    'View overview stats',
    'System'
  ),
  action(
    'admin-dashboard',
    'admin_dashboard',
    'view_revenue',
    'View revenue summary',
    'System'
  ),
  action(
    'admin-dashboard',
    'admin_dashboard',
    'view_revenue_chart',
    'View revenue chart',
    'System'
  ),
  action(
    'admin-dashboard',
    'admin_dashboard',
    'view_activity',
    'View recent activity',
    'System'
  ),
  action(
    'admin-dashboard',
    'admin_dashboard',
    'navigate_modules',
    'Use module shortcuts',
    'System'
  ),

  page('users', 'Users', 'System', 'Create and manage user accounts'),
  action('users', 'users', 'create', 'Add user', 'System'),
  action('users', 'users', 'edit', 'Edit user', 'System'),
  action('users', 'users', 'toggle_active', 'Activate / deactivate user', 'System'),

  page('roles-permissions', 'Roles & Permissions', 'System', 'Control menu, page, and action access'),
  action('roles-permissions', 'roles', 'create', 'Add custom role', 'System'),
  action('roles-permissions', 'roles', 'edit', 'Edit role', 'System'),
  action('roles-permissions', 'roles', 'delete', 'Delete custom role', 'System'),
  action('roles-permissions', 'roles', 'save', 'Save permission matrix', 'System'),

  page('inventory', 'Inventory', 'System'),
  action('inventory', 'inventory', 'create_item', 'Add inventory item', 'System'),
  action('inventory', 'inventory', 'edit_item', 'Edit inventory item', 'System'),
  action('inventory', 'inventory', 'stock_in', 'Stock in', 'System'),
  action('inventory', 'inventory', 'stock_out', 'Stock out', 'System'),
  action('inventory', 'inventory', 'manage_categories', 'Manage categories', 'System'),
  action('inventory', 'inventory', 'export', 'Export inventory', 'System'),

  page('settings', 'Settings', 'System'),
  action('settings', 'settings', 'save', 'Save settings', 'System'),

  page('logs', 'Activity Logs', 'System'),

  page('profile', 'My Profile', 'Account', 'Always available to signed-in users'),
]

export const PERMISSION_GROUPS: PermissionGroup[] = [
  'RRP Dream Inn',
  'Billing',
  'Analytics',
  'System',
  'Account',
]

/** Keys that cannot be removed from system Admin role. */
export const ADMIN_LOCKED_PERMISSION_KEYS = [
  'page.admin-dashboard',
  'page.users',
  'page.roles-permissions',
  'action.roles.save',
  'page.profile',
] as const

/** Always granted to every active user. */
export const ALWAYS_GRANTED_PERMISSION_KEYS = ['page.profile'] as const

const ALL_KEYS = APP_PERMISSION_CATALOG.map((p) => p.key)

function keysForPages(pageKeys: AppPageKey[], extraActions: string[] = []): string[] {
  const set = new Set<string>()
  for (const def of APP_PERMISSION_CATALOG) {
    if (pageKeys.includes(def.pageKey)) {
      if (def.kind === 'page') set.add(def.key)
    }
  }
  for (const key of extraActions) set.add(key)
  for (const key of ALWAYS_GRANTED_PERMISSION_KEYS) set.add(key)
  return [...set]
}

function allActionsForPages(pageKeys: AppPageKey[]): string[] {
  return APP_PERMISSION_CATALOG.filter(
    (p) => p.kind === 'action' && pageKeys.includes(p.pageKey)
  ).map((p) => p.key)
}

const HOTEL_PAGES: AppPageKey[] = [
  'hotel-dashboard',
  'rooms',
  'room-types',
  'bookings',
  'customers',
  'company-ledger',
  'housekeeping',
  'hotel-beverage-sales',
  'transport-sales',
  'invoices',
  'payments',
  'deposits',
  'reports',
  'day-close',
  'business-day-reports',
]

const FD_PAGES: AppPageKey[] = HOTEL_PAGES.filter((p) => p !== 'room-types')

/**
 * Default matrix for system roles (pages + actions).
 * Used to seed AccessRole permissions and as API fallback.
 */
export const DEFAULT_ROLE_PERMISSION_KEYS: Record<AppRole, string[]> = {
  ADMIN: ALL_KEYS,
  HOTEL_STAFF: [
    ...keysForPages(HOTEL_PAGES),
    ...allActionsForPages(HOTEL_PAGES).filter(
      (key) =>
        !key.startsWith('action.users.') &&
        !key.startsWith('action.roles.') &&
        !key.startsWith('action.settings.')
    ),
  ],
  HOTEL_FD: [
    ...keysForPages(FD_PAGES),
    ...allActionsForPages(FD_PAGES).filter(
      (key) =>
        ![
          'action.rooms.create',
          'action.rooms.edit',
          'action.room_types.create',
          'action.room_types.edit',
          'action.room_types.delete',
          'action.company_ledger.delete',
          'action.users.create',
          'action.users.edit',
          'action.users.toggle_active',
          'action.roles.create',
          'action.roles.edit',
          'action.roles.delete',
          'action.roles.save',
          'action.settings.save',
          'action.inventory.create_item',
          'action.inventory.edit_item',
          'action.inventory.stock_in',
          'action.inventory.stock_out',
          'action.inventory.manage_categories',
        ].includes(key)
    ),
  ],
  RESTAURANT_STAFF: [
    ...keysForPages(['company-ledger', 'payments', 'reports', 'business-day-reports']),
    'action.company_ledger.pay_bill',
    'action.company_ledger.export',
    'action.payments.record',
    'action.payments.print_slip',
    'action.payments.export',
    'action.reports.export',
    'action.business_day_reports.export',
  ],
  HOUSEKEEPER: [
    ...keysForPages(['rooms', 'inventory']),
    'action.rooms.start_cleaning',
    'action.rooms.complete_cleaning',
    'action.inventory.stock_in',
    'action.inventory.stock_out',
    'action.inventory.export',
  ],
}

export const SYSTEM_ACCESS_ROLE_DEFS: Array<{
  key: string
  label: string
  baseRole: AppRole
  description: string
  sortOrder: number
}> = [
  {
    key: 'admin',
    label: 'Admin',
    baseRole: 'ADMIN',
    description: 'Full system access',
    sortOrder: 10,
  },
  {
    key: 'hotel_manager',
    label: 'Hotel Manager',
    baseRole: 'HOTEL_STAFF',
    description: 'Full hotel operations',
    sortOrder: 20,
  },
  {
    key: 'hotel_fd',
    label: 'Hotel F.D.',
    baseRole: 'HOTEL_FD',
    description: 'Front desk operations',
    sortOrder: 30,
  },
  {
    key: 'restaurant_staff',
    label: 'Restaurant Staff',
    baseRole: 'RESTAURANT_STAFF',
    description: 'Restaurant and ledger payments',
    sortOrder: 40,
  },
  {
    key: 'housekeeper',
    label: 'Housekeeper',
    baseRole: 'HOUSEKEEPER',
    description: 'Rooms cleaning and inventory',
    sortOrder: 50,
  },
]

export function permissionKeyForPage(pageKey: string): string {
  return `page.${pageKey}`
}

export function pageKeyFromPermission(permissionKey: string): AppPageKey | null {
  if (permissionKey.startsWith('page.')) {
    const pageKey = permissionKey.slice(5) as AppPageKey
    return APP_PERMISSION_CATALOG.some((p) => p.pageKey === pageKey)
      ? pageKey
      : null
  }
  const match = APP_PERMISSION_CATALOG.find((p) => p.key === permissionKey)
  return match?.pageKey ?? null
}

export function isKnownPermissionKey(key: string): boolean {
  return APP_PERMISSION_CATALOG.some((p) => p.key === key)
}

export function defaultPermissionKeysForRole(role: string): string[] {
  if ((APP_ROLES as string[]).includes(role)) {
    return [...new Set(DEFAULT_ROLE_PERMISSION_KEYS[role as AppRole])]
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
  return PERMISSION_GROUPS.map((group) => {
    const pages = APP_PERMISSION_CATALOG.filter(
      (p) => p.group === group && p.kind === 'page'
    )
    return {
      group,
      pages: pages.map((pageDef) => ({
        page: pageDef,
        actions: APP_PERMISSION_CATALOG.filter(
          (p) => p.kind === 'action' && p.pageKey === pageDef.pageKey
        ),
      })),
    }
  }).filter((section) => section.pages.length > 0)
}

/** When a page is enabled, optionally ensure related actions stay selectable. */
export function expandPageSelection(keys: Iterable<string>): string[] {
  const set = new Set(keys)
  for (const key of ALWAYS_GRANTED_PERMISSION_KEYS) set.add(key)
  return [...set]
}

export function slugifyRoleKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || `role_${Date.now()}`
}
