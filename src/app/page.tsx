'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore, canAccessHotel, canAccessRestaurant, canAccessAdmin } from '@/lib/auth-store'
import { CURRENT_PAGE_STORAGE_KEY } from '@/lib/session'
import { formatRoleLabel } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthHydration } from '@/hooks/use-auth-hydration'
import { api } from '@/lib/api-client'
import {
  LayoutDashboard, FileText, CreditCard, BarChart3, Users, Settings,
  ScrollText, Package, LogOut, Hotel, UtensilsCrossed, Menu, X,
  Bed, CalendarCheck, UserCircle, SprayCan, ShoppingCart,
  ChefHat, Grid3X3, ClipboardList, DoorOpen, Tag, Bell, Loader2, User, UserRound,
  ChevronLeft, ChevronRight, Building2, Landmark, Lock, CalendarClock, Coffee,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmailInput } from '@/components/ui/email-input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'
import { ThemeToggle } from '@/components/theme-toggle'
import { AppDevelopedByFooter } from '@/components/AppDevelopedByFooter'

import { DayCloseGateBanner } from '@/components/erp/admin/DayCloseGateBanner'
import { useBusinessDate } from '@/hooks/use-business-date'

function ErpPageLoader() {
  return (
    <div className="flex min-h-[16rem] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )
}

const dynamicPage = <T extends React.ComponentType<unknown>>(
  loader: () => Promise<T>
) =>
  dynamic(loader, {
    loading: () => <ErpPageLoader />,
  })

const HotelDashboard = dynamicPage(() =>
  import('@/components/erp/hotel/Dashboard').then((m) => m.Dashboard)
)
const RoomsPage = dynamicPage(() =>
  import('@/components/erp/hotel/RoomsPage').then((m) => m.RoomsPage)
)
const RoomTypesPage = dynamicPage(() =>
  import('@/components/erp/hotel/RoomTypesPage').then((m) => m.RoomTypesPage)
)
const BookingsPage = dynamicPage(() =>
  import('@/components/erp/hotel/BookingsPage').then((m) => m.BookingsPage)
)
const CustomersPage = dynamicPage(() =>
  import('@/components/erp/hotel/CustomersPage').then((m) => m.CustomersPage)
)
const CompanyLedgerPage = dynamicPage(() =>
  import('@/components/erp/hotel/CompanyLedgerPage').then((m) => m.CompanyLedgerPage)
)
const HousekeepingPage = dynamicPage(() =>
  import('@/components/erp/hotel/HousekeepingPage').then((m) => m.HousekeepingPage)
)
const HotelBeverageSalesPage = dynamicPage(() =>
  import('@/components/erp/hotel/HotelBeverageSalesPage').then((m) => m.HotelBeverageSalesPage)
)
const POSPage = dynamicPage(() => import('@/components/erp/restaurant/POSPage'))
const MenuPage = dynamicPage(() => import('@/components/erp/restaurant/MenuPage'))
const OrdersPage = dynamicPage(() => import('@/components/erp/restaurant/OrdersPage'))
const KitchenPage = dynamicPage(() => import('@/components/erp/restaurant/KitchenPage'))
const TablesPage = dynamicPage(() => import('@/components/erp/restaurant/TablesPage'))
const WaitersPage = dynamicPage(() => import('@/components/erp/restaurant/WaitersPage'))
const InvoicesPage = dynamicPage(() => import('@/components/erp/billing/InvoicesPage'))
const PaymentsPage = dynamicPage(() => import('@/components/erp/billing/PaymentsPage'))
const DepositsPage = dynamicPage(() => import('@/components/erp/billing/DepositsPage'))
const ReportsPage = dynamicPage(() => import('@/components/erp/reports/ReportsPage'))
const AdminDashboard = dynamicPage(() => import('@/components/erp/admin/AdminDashboard'))
const SettingsPage = dynamicPage(() => import('@/components/erp/admin/SettingsPage'))
const UsersPage = dynamicPage(() => import('@/components/erp/admin/UsersPage'))
const ActivityLogsPage = dynamicPage(() => import('@/components/erp/admin/ActivityLogsPage'))
const InventoryPage = dynamicPage(() => import('@/components/erp/admin/InventoryPage'))
const DayClosePage = dynamicPage(() => import('@/components/erp/admin/DayClosePage'))
const BusinessDayReportsPage = dynamicPage(() =>
  import('@/components/erp/admin/BusinessDayReportsPage')
)
const ProfilePage = dynamicPage(() =>
  import('@/components/erp/auth/ProfilePage').then((m) => m.ProfilePage)
)

type PageKey = 
  | 'hotel-dashboard' | 'rooms' | 'room-types' | 'bookings' | 'customers' | 'company-ledger' | 'housekeeping' | 'hotel-beverage-sales'
  | 'pos' | 'menu' | 'orders' | 'kitchen' | 'tables' | 'waiters'
  | 'invoices' | 'payments' | 'deposits' | 'reports' | 'day-close' | 'business-day-reports'
  | 'admin-dashboard' | 'users' | 'settings' | 'logs' | 'inventory'
  | 'profile'

interface NavItem {
  key: PageKey
  label: string
  icon: React.ReactNode
  allowedRoles: string[]
  group: string
}

interface AppNotification {
  id: string
  title: string
  message: string
  type: string
  read: boolean
  createdAt: string
}

const navItems: NavItem[] = [
  // Hotel - RRP Dream Inn
  { key: 'hotel-dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF', 'HOTEL_FD'], group: 'RRP Dream Inn' },
  { key: 'rooms', label: 'Rooms', icon: <Bed className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF', 'HOTEL_FD'], group: 'RRP Dream Inn' },
  { key: 'room-types', label: 'Room Types', icon: <Tag className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF'], group: 'RRP Dream Inn' },
  { key: 'bookings', label: 'Bookings', icon: <CalendarCheck className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF', 'HOTEL_FD'], group: 'RRP Dream Inn' },
  { key: 'customers', label: 'Guests', icon: <UserCircle className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF', 'HOTEL_FD'], group: 'RRP Dream Inn' },
  { key: 'company-ledger', label: 'Company Ledger', icon: <Building2 className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF', 'HOTEL_FD'], group: 'RRP Dream Inn' },
  { key: 'housekeeping', label: 'Housekeeping', icon: <SprayCan className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF', 'HOTEL_FD'], group: 'RRP Dream Inn' },
  { key: 'hotel-beverage-sales', label: 'Beverage Sales', icon: <Coffee className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF', 'HOTEL_FD'], group: 'RRP Dream Inn' },
  // Housekeeper — rooms (view only) + inventory
  { key: 'rooms', label: 'Rooms', icon: <Bed className="h-4 w-4" />, allowedRoles: ['HOUSEKEEPER'], group: 'Housekeeping' },
  { key: 'inventory', label: 'Inventory', icon: <Package className="h-4 w-4" />, allowedRoles: ['HOUSEKEEPER'], group: 'Housekeeping' },
  // Restaurant - CloudView
  { key: 'hotel-dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, allowedRoles: ['RESTAURANT_STAFF'], group: 'CloudView' },
  { key: 'pos', label: 'POS Terminal', icon: <ShoppingCart className="h-4 w-4" />, allowedRoles: ['ADMIN', 'RESTAURANT_STAFF'], group: 'CloudView' },
  { key: 'menu', label: 'Menu Management', icon: <UtensilsCrossed className="h-4 w-4" />, allowedRoles: ['ADMIN', 'RESTAURANT_STAFF'], group: 'CloudView' },
  { key: 'orders', label: 'Orders', icon: <ClipboardList className="h-4 w-4" />, allowedRoles: ['ADMIN', 'RESTAURANT_STAFF'], group: 'CloudView' },
  { key: 'kitchen', label: 'Kitchen Display', icon: <ChefHat className="h-4 w-4" />, allowedRoles: ['ADMIN', 'RESTAURANT_STAFF', 'HOTEL_STAFF', 'HOTEL_FD'], group: 'CloudView' },
  { key: 'tables', label: 'Tables', icon: <Grid3X3 className="h-4 w-4" />, allowedRoles: ['ADMIN', 'RESTAURANT_STAFF'], group: 'CloudView' },
  { key: 'waiters', label: 'Waiters', icon: <UserRound className="h-4 w-4" />, allowedRoles: ['ADMIN', 'RESTAURANT_STAFF'], group: 'CloudView' },
  // Billing
  { key: 'invoices', label: 'Invoices', icon: <FileText className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF', 'HOTEL_FD'], group: 'Billing' },
  { key: 'payments', label: 'Payments', icon: <CreditCard className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF', 'HOTEL_FD', 'RESTAURANT_STAFF'], group: 'Billing' },
  { key: 'deposits', label: 'Head Office', icon: <Landmark className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF', 'HOTEL_FD'], group: 'Billing' },
  // Analytics
  { key: 'reports', label: 'Reports', icon: <BarChart3 className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF', 'HOTEL_FD', 'RESTAURANT_STAFF'], group: 'Analytics' },
  { key: 'day-close', label: 'Day Close', icon: <Lock className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF', 'HOTEL_FD'], group: 'Analytics' },
  { key: 'business-day-reports', label: 'Business Day Reports', icon: <CalendarClock className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF', 'HOTEL_FD', 'RESTAURANT_STAFF'], group: 'Analytics' },
  // Admin
  { key: 'admin-dashboard', label: 'Admin Overview', icon: <LayoutDashboard className="h-4 w-4" />, allowedRoles: ['ADMIN'], group: 'System' },
  { key: 'users', label: 'Users', icon: <Users className="h-4 w-4" />, allowedRoles: ['ADMIN'], group: 'System' },
  { key: 'inventory', label: 'Inventory', icon: <Package className="h-4 w-4" />, allowedRoles: ['ADMIN'], group: 'System' },
  { key: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" />, allowedRoles: ['ADMIN'], group: 'System' },
  { key: 'logs', label: 'Activity Logs', icon: <ScrollText className="h-4 w-4" />, allowedRoles: ['ADMIN'], group: 'System' },
  // Account
  { key: 'profile', label: 'My Profile', icon: <User className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF', 'HOTEL_FD', 'RESTAURANT_STAFF', 'HOUSEKEEPER'], group: 'Account' },
]

const SIDEBAR_COLLAPSED_KEY = 'erp_sidebar_collapsed'

function readSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
}

function readSavedPageKey(): PageKey {
  if (typeof window === 'undefined') return 'hotel-dashboard'
  const saved = window.localStorage.getItem(CURRENT_PAGE_STORAGE_KEY)
  if (saved && navItems.some((item) => item.key === saved)) {
    return saved as PageKey
  }
  return 'hotel-dashboard'
}

function LoginForm() {
  const { login } = useAuthStore()
  const { toast } = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [emailBlocking, setEmailBlocking] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (emailBlocking) {
      toast({ title: 'Invalid email', description: 'Enter a valid email address', variant: 'destructive' })
      return
    }
    setLoading(true)
    try {
      const res = await api.post<{ success: boolean; data: { user: { id: string; email: string; name: string; avatar?: string | null; phone?: string | null; role: string }; token: string } }>('/auth/login', { email, password })
      if (res.success && res.data) {
        const u = res.data.user
        login(
          {
            id: u.id,
            email: u.email,
            name: u.name,
            avatar: u.avatar ?? null,
            phone: u.phone ?? null,
            role: u.role as 'ADMIN' | 'HOTEL_STAFF' | 'HOTEL_FD' | 'RESTAURANT_STAFF' | 'HOUSEKEEPER',
          },
          res.data.token
        )
        toast({ title: 'Welcome!', description: `Logged in as ${res.data.user.name}` })
      } else {
        toast({ title: 'Login Failed', description: (res as any).error || 'Invalid credentials', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Login Failed', description: 'Invalid email or password', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-amber-50 via-white to-emerald-50">
      <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <Card className="shadow-xl border-0">
          <CardContent className="p-6">
            <div className="text-center mb-6 pb-6 border-b border-border">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white shadow-lg mb-4 border border-slate-200 overflow-hidden">
                <Image src="/brand-logo.png" alt="RRP Dream Inn logo" width={64} height={64} className="h-full w-full object-cover" />
              </div>
              <h1 className="text-3xl font-bold text-slate-800">ERP System</h1>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100">
                  <Hotel className="h-3 w-3 mr-1" /> RRP Dream Inn
                </Badge>
                <span className="text-slate-300">+</span>
                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
                  <UtensilsCrossed className="h-3 w-3 mr-1" /> CloudView
                </Badge>
              </div>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <EmailInput
                  id="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={setEmail}
                  mode="format-only"
                  onValidationChange={(result) => setEmailBlocking(result.isBlocking)}
                  required
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="mt-1"
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-amber-600 to-emerald-600 hover:from-amber-700 hover:to-emerald-700 text-white shadow-md"
                disabled={loading}
                size="lg"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
      </div>
      <AppDevelopedByFooter showProductLine />
    </div>
  )
}

function getDefaultPage(role: string | undefined): PageKey {
  if (role === 'ADMIN') return 'admin-dashboard'
  if (role === 'HOUSEKEEPER') return 'rooms'
  if (role === 'HOTEL_STAFF' || role === 'HOTEL_FD') return 'hotel-dashboard'
  if (role === 'RESTAURANT_STAFF') return 'hotel-dashboard'
  return 'hotel-dashboard'
}

const pageTitles: Record<PageKey, string> = {
  'hotel-dashboard': 'Hotel Dashboard',
  'rooms': 'Room Management',
  'room-types': 'Room Types',
  'bookings': 'Bookings',
  'customers': 'Guest Management',
  'company-ledger': 'Company Ledger',
  'housekeeping': 'Housekeeping',
  'hotel-beverage-sales': 'Beverage Sales',
  'pos': 'POS Terminal',
  'menu': 'Menu Management',
  'orders': 'Order Management',
  'kitchen': 'Kitchen Display',
  'tables': 'Table Management',
  'waiters': 'Waiter Management',
  'invoices': 'Invoices',
  'payments': 'Payments',
  'deposits': 'Head Office',
  'reports': 'Reports & Analytics',
  'day-close': 'Day Close',
  'business-day-reports': 'Business Day Reports',
  'admin-dashboard': 'Admin Dashboard',
  'users': 'User Management',
  'settings': 'System Settings',
  'logs': 'Activity Logs',
  'inventory': 'Inventory Management',
  'profile': 'My Profile',
}

function ERPApp() {
  const { user, logout } = useAuthStore()
  const queryClient = useQueryClient()
  const { data: businessDateRes } = useBusinessDate()
  const [currentPage, setCurrentPage] = useState<PageKey>(readSavedPageKey)
  const [pageRefreshNonce, setPageRefreshNonce] = useState(0)
  const [headerLoading, setHeaderLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    setSidebarCollapsed(readSidebarCollapsed())
  }, [])

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      }
      return next
    })
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const isPageAllowedForRole = useCallback((page: PageKey, role: string | undefined): boolean => {
    if (!role) return false
    return navItems.some((item) => item.key === page && item.allowedRoles.includes(role))
  }, [])

  const getSavedPage = useCallback((): PageKey | null => {
    if (typeof window === 'undefined') return null
    const saved = window.localStorage.getItem(CURRENT_PAGE_STORAGE_KEY)
    if (!saved) return null
    return saved as PageKey
  }, [])

  // Restore page on login/reload and enforce role-safe fallback.
  useEffect(() => {
    if (!user?.role) return

    const savedPage = getSavedPage()
    const targetPage =
      savedPage && isPageAllowedForRole(savedPage, user.role)
        ? savedPage
        : getDefaultPage(user.role)

    setCurrentPage((prev) => (prev === targetPage ? prev : targetPage))
  }, [user?.id, user?.role, getSavedPage, isPageAllowedForRole])

  // Persist current section so refresh lands on same page.
  useEffect(() => {
    if (typeof window === 'undefined' || !user?.role) return
    if (!isPageAllowedForRole(currentPage, user.role)) return
    window.localStorage.setItem(CURRENT_PAGE_STORAGE_KEY, currentPage)
  }, [currentPage, user?.role, isPageAllowedForRole])

  const handleLogout = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(CURRENT_PAGE_STORAGE_KEY)
    }
    logout()
  }, [logout])

  // Get allowed nav items based on role
  const allowedNavItems = navItems.filter(
    (item) => user && item.allowedRoles.includes(user.role)
  )

  const roleBadgeColors: Record<string, string> = {
    ADMIN: 'bg-red-50 text-red-700 border-red-200',
    HOTEL_STAFF: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    HOTEL_FD: 'bg-teal-50 text-teal-700 border-teal-200',
    RESTAURANT_STAFF: 'bg-amber-50 text-amber-700 border-amber-200',
    HOUSEKEEPER: 'bg-violet-50 text-violet-700 border-violet-200',
  }

  const handlePageNavigation = useCallback((page: PageKey) => {
    setHeaderLoading(true)
    setCurrentPage((prev) => {
      if (prev === page) {
        setPageRefreshNonce((nonce) => nonce + 1)
      }
      return page
    })
  }, [])

  useEffect(() => {
    if (!headerLoading) return

    const timer = setTimeout(() => setHeaderLoading(false), 550)
    return () => clearTimeout(timer)
  }, [headerLoading, currentPage, pageRefreshNonce])

  const renderPage = useCallback(() => {
    switch (currentPage) {
      case 'hotel-dashboard': return <HotelDashboard onNavigate={handlePageNavigation} />
      case 'rooms': return <RoomsPage />
      case 'room-types': return <RoomTypesPage />
      case 'bookings': return <BookingsPage />
      case 'customers': return <CustomersPage />
      case 'company-ledger': return <CompanyLedgerPage />
      case 'housekeeping': return <HousekeepingPage />
      case 'hotel-beverage-sales': return <HotelBeverageSalesPage />
      case 'pos': return <POSPage />
      case 'menu': return <MenuPage />
      case 'orders': return <OrdersPage />
      case 'kitchen': return <KitchenPage />
      case 'tables': return <TablesPage />
      case 'waiters': return <WaitersPage />
      case 'invoices': return <InvoicesPage />
      case 'payments': return <PaymentsPage />
      case 'deposits': return <DepositsPage />
      case 'reports': return <ReportsPage />
      case 'day-close': return <DayClosePage />
      case 'business-day-reports': return <BusinessDayReportsPage />
      case 'admin-dashboard': return <AdminDashboard onNavigate={handlePageNavigation} />
      case 'users': return <UsersPage />
      case 'settings': return <SettingsPage />
      case 'logs': return <ActivityLogsPage />
      case 'inventory': return <InventoryPage />
      case 'profile': return <ProfilePage />
      default: return <HotelDashboard onNavigate={handlePageNavigation} />
    }
  }, [currentPage, handlePageNavigation])

  const { data: notifRes } = useQuery({
    queryKey: ['header-notifications'],
    queryFn: async () => {
      try {
        const res = await api.get<{
          success: boolean
          data: AppNotification[]
          meta?: { total: number; unreadCount?: number }
        }>('/notifications?limit=10')
        if (res?.success) return res
      } catch {
        // ignore — dev server may still be compiling routes
      }
      return { success: true, data: [] as AppNotification[], meta: { total: 0, unreadCount: 0 } }
    },
    refetchInterval: 30_000,
    retry: 1,
  })
  const notifications = notifRes?.data || []
  const unreadCount =
    notifRes?.meta?.unreadCount ?? notifications.filter((n) => !n.read).length

  const markAllReadMutation = useMutation({
    mutationFn: () => api.put('/notifications', { markAll: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['header-notifications'] })
    },
  })

  // Group nav items
  const groupedNav: Record<string, NavItem[]> = {}
  allowedNavItems.forEach((item) => {
    if (!groupedNav[item.group]) groupedNav[item.group] = []
    groupedNav[item.group].push(item)
  })

  const groupColors: Record<string, string> = {
    'RRP Dream Inn': 'text-emerald-600',
    'CloudView': 'text-amber-600',
    'Billing': 'text-muted-foreground',
    'Analytics': 'text-muted-foreground',
    'System': 'text-red-600',
    'Account': 'text-muted-foreground',
  }

  const groupBgColors: Record<string, string> = {
    'RRP Dream Inn': 'bg-emerald-50',
    'CloudView': 'bg-amber-50',
    'Billing': 'bg-muted',
    'Analytics': 'bg-muted',
    'System': 'bg-red-50',
    'Account': 'bg-muted',
  }

  const renderNavItems = (items: NavItem[], group: string, collapsed = false) => (
    <div key={group} className={cn('mb-3', collapsed && 'mb-1')}>
      {!collapsed && (
        <p className={`text-[10px] font-bold uppercase tracking-widest px-3 mb-1.5 ${groupColors[group] || 'text-muted-foreground'}`}>
          {group}
        </p>
      )}
      {items.map((item) => (
        <button
          key={`${group}-${item.key}-${item.label}`}
          type="button"
          title={collapsed ? item.label : undefined}
          onClick={() => { handlePageNavigation(item.key); setSidebarOpen(false) }}
          className={cn(
            'w-full flex items-center rounded-lg text-sm transition-all duration-150',
            collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2',
            currentPage === item.key
              ? `${groupBgColors[group] || 'bg-amber-50'} font-semibold ${groupColors[group] || 'text-amber-700'}`
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          {item.icon}
          {!collapsed && item.label}
        </button>
      ))}
    </div>
  )

  return (
    <div className="min-h-screen flex bg-background">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-1 overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r from-amber-500 via-emerald-500 to-amber-500 shadow-[0_0_10px_rgba(16,185,129,0.55)] transition-all duration-500 ease-out ${
            headerLoading ? 'w-full opacity-100' : 'w-0 opacity-0'
          }`}
        />
      </div>

      {/* Sidebar - Desktop */}
      <aside
        className={cn(
          'hidden lg:flex lg:flex-col bg-card border-r border-border shadow-sm fixed inset-y-0 left-0 z-30 transition-[width] duration-300 ease-in-out',
          sidebarCollapsed ? 'lg:w-16' : 'lg:w-60'
        )}
      >
        <div className={cn('border-b border-border', sidebarCollapsed ? 'p-2' : 'p-4')}>
          <div className={cn('flex items-center', sidebarCollapsed ? 'flex-col gap-2' : 'gap-2.5')}>
            <div className="h-9 w-9 rounded-xl bg-background border border-border shadow-sm overflow-hidden shrink-0">
              <Image src="/brand-logo.png" alt="RRP Dream Inn logo" width={36} height={36} className="h-full w-full object-cover" />
            </div>
            {!sidebarCollapsed && (
              <div className="flex-1 min-w-0">
                <h1 className="font-bold text-foreground text-sm leading-tight">RRP Dream Inn</h1>
                <p className="text-[11px] text-amber-600 font-medium">+ CloudView Restaurant</p>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={toggleSidebarCollapsed}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <nav className={cn('flex-1 overflow-y-auto space-y-0.5', sidebarCollapsed ? 'p-1.5' : 'p-2.5')}>
          {Object.entries(groupedNav).map(([group, items], index) => (
            <div key={group}>
              {sidebarCollapsed && index > 0 && <Separator className="my-1.5" />}
              {renderNavItems(items, group, sidebarCollapsed)}
            </div>
          ))}
        </nav>

        <div className={cn('border-t border-border bg-muted/50', sidebarCollapsed ? 'p-2' : 'p-3')}>
          <Button
            variant="ghost"
            title="Logout"
            className={cn(
              'w-full text-muted-foreground hover:text-foreground',
              sidebarCollapsed ? 'justify-center px-0' : 'justify-start gap-2'
            )}
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && 'Logout'}
          </Button>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed inset-y-0 left-0 w-72 bg-card shadow-2xl z-50 animate-in slide-in-from-left duration-200">
            <div className="p-4 border-b border-border flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-card border border-border overflow-hidden">
                  <Image src="/brand-logo.png" alt="RRP Dream Inn logo" width={28} height={28} className="h-full w-full object-cover" />
                </div>
                <span className="font-bold text-foreground text-sm">ERP System</span>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <nav className="p-2.5 space-y-0.5 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 120px)' }}>
              {Object.entries(groupedNav).map(([group, items]) => renderNavItems(items, group))}
            </nav>
            <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-border bg-card">
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSidebarOpen(false)
                  handleLogout()
                }}
              >
                <LogOut className="h-4 w-4" />
                Logout
              </Button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <main
        className={cn(
          'flex-1 flex flex-col min-h-screen transition-[margin] duration-300 ease-in-out',
          sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-60'
        )}
      >
        {/* Top Bar */}
        <header className="sticky top-0 z-50 bg-background/90 backdrop-blur-md border-b border-border px-4 py-3 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {pageTitles[currentPage] || currentPage}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex flex-row flex-wrap items-center justify-end gap-2">
              {businessDateRes?.data?.businessDate && (
                <div
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-[11px] font-semibold sm:text-xs',
                    businessDateRes.data.dayCloseRequired
                      ? 'border-amber-400 bg-amber-50 text-amber-800'
                      : 'border-amber-300 bg-amber-50 text-amber-800'
                  )}
                  title={
                    businessDateRes.data.dayCloseRequired
                      ? businessDateRes.data.dayCloseMessage ?? 'Day close pending'
                      : undefined
                  }
                >
                  Business: {businessDateRes.data.businessDate}
                  {businessDateRes.data.dayCloseRequired ? ' · Close pending' : ''}
                </div>
              )}
              <div className="rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground sm:text-xs">
                {now.toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: '2-digit',
                  year: 'numeric',
                })}
              </div>
              <div className="rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground sm:text-xs">
                <span className="sm:hidden">
                  {now.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <span className="hidden sm:inline">
                  {now.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>
            </div>
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative h-9 w-9">
                  <Bell className="h-4 w-4 text-muted-foreground" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-red-500 text-[10px] font-semibold text-white flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[340px] p-0">
                <div className="px-3 py-2 border-b bg-muted/70">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">Notifications</p>
                    <button
                      type="button"
                      onClick={() => markAllReadMutation.mutate()}
                      disabled={markAllReadMutation.isPending || unreadCount === 0}
                      className="text-xs text-amber-700 hover:text-amber-800 disabled:text-muted-foreground"
                    >
                      Mark all read
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {unreadCount} unread
                  </p>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                      No notifications yet
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`px-3 py-2 border-b last:border-b-0 ${n.read ? 'bg-card' : 'bg-amber-50/40 dark:bg-amber-950/40'}`}
                      >
                        <p className="text-sm font-medium text-foreground">{n.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {new Date(n.createdAt).toLocaleString()}
                        </p>
                      </div>
                    ))
                  )}
                </div>
                <div className="px-3 py-2 border-t bg-muted/60">
                  <button
                    type="button"
                    onClick={() => handlePageNavigation('orders')}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Go to orders
                  </button>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-9 gap-2 px-2">
                  <div className="h-8 w-8 rounded-full border border-border bg-muted overflow-hidden flex items-center justify-center text-sm font-bold text-muted-foreground shrink-0">
                    {user?.avatar ? (
                      <img src={user.avatar} alt={user.name || 'User'} className="h-full w-full object-cover" />
                    ) : (
                      <span>{user?.name?.charAt(0) || 'U'}</span>
                    )}
                  </div>
                  <span className="hidden md:inline text-sm font-medium text-foreground max-w-[120px] truncate">
                    {user?.name}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-3 py-2 border-b">
                  <p className="text-sm font-semibold text-foreground truncate">{user?.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                  <Badge variant="outline" className={`mt-1.5 text-[10px] px-1.5 py-0 ${roleBadgeColors[user?.role || ''] || ''}`}>
                    {formatRoleLabel(user?.role)}
                  </Badge>
                </div>
                <DropdownMenuItem onClick={() => handlePageNavigation('profile')}>
                  <User className="h-4 w-4 mr-2" />
                  My Profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-red-600 focus:text-red-600"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {businessDateRes?.data?.dayCloseRequired && canAccessHotel(user?.role) && (
          <div className="px-4 md:px-6 pt-3">
            <DayCloseGateBanner onGoToDayClose={() => handlePageNavigation('day-close')} />
          </div>
        )}

        {/* Page Content */}
        <div key={`${currentPage}-${pageRefreshNonce}`} className="flex-1 p-4 md:p-6 overflow-auto">
          {renderPage()}
        </div>

        <AppDevelopedByFooter showProductLine />
      </main>
    </div>
  )
}

function AppContent() {
  const hasHydrated = useAuthHydration()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  if (!hasHydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 via-orange-50 to-emerald-50">
        <Loader2 className="h-8 w-8 animate-spin text-amber-600" aria-label="Loading application" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <LoginForm />
  }
  return <ERPApp />
}

export default function Home() {
  return <AppContent />
}
