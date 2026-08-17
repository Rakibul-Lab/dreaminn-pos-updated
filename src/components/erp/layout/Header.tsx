'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Bell, Search, LogOut, User, Menu } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAuthStore } from '@/lib/auth-store';
import { Badge } from '@/components/ui/badge';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { ViewId } from './Sidebar';

const viewTitles: Record<ViewId, string> = {
  dashboard: 'Dashboard',
  rooms: 'Room Management',
  'room-types': 'Room Types',
  bookings: 'Bookings',
  customers: 'Customers',
  'company-ledger': 'Company Ledger',
  invoices: 'Invoices',
  payments: 'Payments',
  deposits: 'Head Office',
  reports: 'Reports',
  housekeeping: 'Housekeeping',
  inventory: 'Inventory',
  settings: 'Settings',
  'activity-logs': 'Activity Logs',
};

interface HeaderProps {
  activeView: ViewId;
  onToggleSidebar: () => void;
}

export function Header({ activeView, onToggleSidebar }: HeaderProps) {
  const { user, logout } = useAuthStore();

  const { data: notifData } = useQuery({
    queryKey: ['notifications-count'],
    queryFn: async () => {
      try {
        const res = await api.get<{ success: boolean; meta?: { unreadCount?: number } }>(
          '/notifications?limit=1'
        )
        if (res?.success) return res
      } catch {
        // ignore transient dev 404s while routes compile
      }
      return { success: true, meta: { unreadCount: 0 } }
    },
    refetchInterval: 30_000,
    retry: 1,
  });

  const unreadCount = notifData?.meta?.unreadCount ?? 0;

  const getInitials = (name: string) => {
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <header className="h-16 border-b bg-card flex items-center gap-4 px-4 lg:px-6 shrink-0">
      {/* Mobile menu toggle */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onToggleSidebar}
      >
        <Menu className="w-5 h-5" />
      </Button>

      {/* Page title */}
      <div className="flex-1 min-w-0">
        <h1 className="text-lg font-semibold text-foreground truncate">
          {viewTitles[activeView] || 'Dashboard'}
        </h1>
      </div>

      {/* Quick search */}
      <div className="hidden md:flex items-center relative max-w-xs flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Quick search..."
          className="pl-9 h-9 bg-muted/50 border-0 focus-visible:ring-1"
        />
      </div>

      <ThemeToggle />

      {/* Notifications */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="w-5 h-5 text-muted-foreground" />
            {unreadCount > 0 && (
              <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center bg-red-500 text-white text-[10px] border-0">
                {unreadCount > 9 ? '9+' : unreadCount}
              </Badge>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <div className="p-3">
            <p className="text-sm font-medium">Notifications</p>
            <p className="text-xs text-muted-foreground">{unreadCount} unread</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-sm text-muted-foreground">
            No new notifications
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* User dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="flex items-center gap-2 h-auto py-1.5 px-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-amber-100 text-amber-700 text-xs font-semibold">
                {user ? getInitials(user.name) : '?'}
              </AvatarFallback>
            </Avatar>
            <div className="hidden sm:block text-left">
              <p className="text-sm font-medium leading-none">{user?.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{user?.role?.replace('_', ' ')}</p>
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="p-2">
            <p className="text-sm font-medium">{user?.name}</p>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <User className="mr-2 h-4 w-4" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout} className="text-red-600 focus:text-red-600">
            <LogOut className="mr-2 h-4 w-4" />
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
