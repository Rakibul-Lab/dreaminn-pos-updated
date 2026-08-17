'use client';

import { useState, useMemo } from 'react';
import { Sidebar, type ViewId } from './Sidebar';
import { Header } from './Header';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent } from '@/components/ui/sheet';

// Import page components
import { Dashboard } from '../hotel/Dashboard';
import { RoomsPage } from '../hotel/RoomsPage';
import { RoomTypesPage } from '../hotel/RoomTypesPage';
import { BookingsPage } from '../hotel/BookingsPage';
import { CustomersPage } from '../hotel/CustomersPage';
import { CompanyLedgerPage } from '../hotel/CompanyLedgerPage';
import { HousekeepingPage } from '../hotel/HousekeepingPage';
import { PlaceholderPage } from '../shared/PlaceholderPage';

const viewComponents: Record<ViewId, React.ComponentType> = {
  dashboard: Dashboard,
  rooms: RoomsPage,
  'room-types': RoomTypesPage,
  bookings: BookingsPage,
  customers: CustomersPage,
  'company-ledger': CompanyLedgerPage,
  housekeeping: HousekeepingPage,
  invoices: PlaceholderPage,
  payments: PlaceholderPage,
  deposits: PlaceholderPage,
  reports: PlaceholderPage,
  inventory: PlaceholderPage,
  settings: PlaceholderPage,
  'activity-logs': PlaceholderPage,
};

export function AppShell() {
  const [activeView, setActiveView] = useState<ViewId>('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const user = useAuthStore((s) => s.user);

  const PageComponent = useMemo(() => viewComponents[activeView] || PlaceholderPage, [activeView]);

  const handleViewChange = (view: ViewId) => {
    setActiveView(view);
    setMobileSidebarOpen(false);
  };

  // Determine default view based on role
  if (activeView === 'dashboard' && user?.role === 'RESTAURANT_STAFF') {
    if (activeView === 'dashboard') {
      setTimeout(() => setActiveView('payments'), 0);
    }
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop Sidebar */}
      <div className="hidden lg:flex">
        <Sidebar activeView={activeView} onViewChange={handleViewChange} />
      </div>

      {/* Mobile Sidebar (Sheet) */}
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="p-0 w-64 bg-slate-900 border-0">
          <Sidebar activeView={activeView} onViewChange={handleViewChange} />
        </SheetContent>
      </Sheet>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          activeView={activeView}
          onToggleSidebar={() => setMobileSidebarOpen(true)}
        />
        <main className="flex-1 overflow-auto p-4 lg:p-6">
          <PageComponent />
        </main>
      </div>
    </div>
  );
}
