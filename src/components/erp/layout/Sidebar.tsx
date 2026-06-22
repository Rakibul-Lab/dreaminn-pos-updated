'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Building2,
  Cloud,
  LayoutDashboard,
  BedDouble,
  Layers,
  CalendarCheck,
  Users,
  ShoppingCart,
  UtensilsCrossed,
  Grid3X3,
  ChefHat,
  Receipt,
  CreditCard,
  Landmark,
  BarChart3,
  SprayCan,
  Package,
  Settings,
  ScrollText,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';

export type ViewId =
  | 'dashboard'
  | 'rooms'
  | 'room-types'
  | 'bookings'
  | 'customers'
  | 'company-ledger'
  | 'restaurant-pos'
  | 'menu'
  | 'tables'
  | 'orders'
  | 'kitchen'
  | 'invoices'
  | 'payments'
  | 'deposits'
  | 'reports'
  | 'housekeeping'
  | 'inventory'
  | 'settings'
  | 'activity-logs';

interface NavItem {
  id: ViewId;
  label: string;
  icon: React.ElementType;
  section?: 'hotel' | 'restaurant' | 'admin';
}

const allNavItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'hotel' },
  { id: 'rooms', label: 'Rooms', icon: BedDouble, section: 'hotel' },
  { id: 'room-types', label: 'Room Types', icon: Layers, section: 'hotel' },
  { id: 'bookings', label: 'Bookings', icon: CalendarCheck, section: 'hotel' },
  { id: 'customers', label: 'Customers', icon: Users, section: 'hotel' },
  { id: 'company-ledger', label: 'Company Ledger', icon: Building2, section: 'hotel' },
  { id: 'restaurant-pos', label: 'Restaurant POS', icon: ShoppingCart, section: 'restaurant' },
  { id: 'menu', label: 'Menu', icon: UtensilsCrossed, section: 'restaurant' },
  { id: 'tables', label: 'Tables', icon: Grid3X3, section: 'restaurant' },
  { id: 'orders', label: 'Orders', icon: Receipt, section: 'restaurant' },
  { id: 'kitchen', label: 'Kitchen', icon: ChefHat, section: 'restaurant' },
  { id: 'invoices', label: 'Invoices', icon: Receipt, section: 'hotel' },
  { id: 'payments', label: 'Payments', icon: CreditCard, section: 'admin' },
  { id: 'deposits', label: 'Head Office', icon: Landmark, section: 'hotel' },
  { id: 'reports', label: 'Reports', icon: BarChart3, section: 'admin' },
  { id: 'housekeeping', label: 'Housekeeping', icon: SprayCan, section: 'hotel' },
  { id: 'inventory', label: 'Inventory', icon: Package, section: 'admin' },
  { id: 'settings', label: 'Settings', icon: Settings, section: 'admin' },
  { id: 'activity-logs', label: 'Activity Logs', icon: ScrollText, section: 'admin' },
];

const roleNavItems: Record<string, ViewId[]> = {
  ADMIN: [
    'dashboard', 'rooms', 'room-types', 'bookings', 'customers', 'company-ledger',
    'restaurant-pos', 'menu', 'tables', 'orders', 'kitchen',
    'invoices', 'payments', 'deposits', 'reports', 'housekeeping', 'inventory', 'settings', 'activity-logs',
  ],
  HOTEL_STAFF: [
    'dashboard', 'rooms', 'room-types', 'bookings', 'customers', 'company-ledger',
    'kitchen', 'invoices', 'payments', 'deposits', 'reports', 'housekeeping',
  ],
  HOTEL_FD: [
    'dashboard', 'rooms', 'bookings', 'customers', 'company-ledger',
    'kitchen', 'invoices', 'payments', 'deposits', 'reports', 'housekeeping',
  ],
  RESTAURANT_STAFF: [
    'restaurant-pos', 'menu', 'orders', 'kitchen', 'tables',
  ],
  HOUSEKEEPER: ['rooms', 'inventory'],
};

interface SidebarProps {
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
}

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout } = useAuthStore();
  const role = user?.role || 'HOTEL_STAFF';

  const allowedViews = roleNavItems[role] || roleNavItems.HOTEL_STAFF;
  const filteredNavItems = allNavItems.filter((item) => allowedViews.includes(item.id));

  const hotelItems = filteredNavItems.filter((item) => item.section === 'hotel');
  const restaurantItems = filteredNavItems.filter((item) => item.section === 'restaurant');
  const adminItems = filteredNavItems.filter((item) => item.section === 'admin');

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <aside
      className={cn(
        'flex flex-col h-screen bg-slate-900 text-slate-100 transition-all duration-300 ease-in-out',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-700/50">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 shrink-0">
          <Building2 className="w-4 h-4 text-white" />
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-amber-400 truncate">RRP Dream Inn</p>
            <p className="text-xs text-muted-foreground truncate">+ CloudView</p>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-white hover:bg-slate-700 shrink-0"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </Button>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-2">
        {/* Hotel Section */}
        {hotelItems.length > 0 && (
          <div className="mb-2">
            {!collapsed && (
              <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                RRP Dream Inn
              </p>
            )}
            {hotelItems.map((item) => (
              <NavItemButton
                key={item.id}
                item={item}
                active={activeView === item.id}
                collapsed={collapsed}
                onClick={() => onViewChange(item.id)}
              />
            ))}
          </div>
        )}

        {/* Restaurant Section */}
        {restaurantItems.length > 0 && (
          <div className="mb-2">
            {!collapsed && (
              <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mt-2">
                CloudView Restaurant
              </p>
            )}
            {restaurantItems.map((item) => (
              <NavItemButton
                key={item.id}
                item={item}
                active={activeView === item.id}
                collapsed={collapsed}
                onClick={() => onViewChange(item.id)}
              />
            ))}
          </div>
        )}

        {/* Admin Section */}
        {adminItems.length > 0 && (
          <div className="mb-2">
            {!collapsed && (
              <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mt-2">
                Administration
              </p>
            )}
            {adminItems.map((item) => (
              <NavItemButton
                key={item.id}
                item={item}
                active={activeView === item.id}
                collapsed={collapsed}
                onClick={() => onViewChange(item.id)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* User Info & Logout */}
      <div className="border-t border-slate-700/50 p-3">
        <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="bg-amber-600 text-white text-xs">
              {user ? getInitials(user.name) : '?'}
            </AvatarFallback>
          </Avatar>
          {!collapsed && user && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.name}</p>
              <p className="text-xs text-muted-foreground truncate">{user.role.replace('_', ' ')}</p>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-red-400 hover:bg-slate-700 shrink-0"
            onClick={logout}
            title="Logout"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}

function NavItemButton({
  item,
  active,
  collapsed,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors relative',
        active
          ? 'bg-amber-600/20 text-amber-400 font-medium'
          : 'text-slate-300 hover:bg-slate-800 hover:text-white',
        collapsed && 'justify-center px-2'
      )}
      title={collapsed ? item.label : undefined}
    >
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-amber-500 rounded-r-full" />
      )}
      <Icon className="w-4 h-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </button>
  );
}
