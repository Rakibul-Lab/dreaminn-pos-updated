'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '../shared/StatusBadge';
import { useAuthStore } from '@/lib/auth-store';
import { format } from 'date-fns';
import {
  BedDouble,
  CheckCircle2,
  LogIn,
  LogOut,
  SprayCan,
  TrendingUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { openNewReservationTab } from '@/lib/reservation-navigation';
import { TakaIcon } from '@/components/icons/TakaIcon';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';

const COLORS = {
  AVAILABLE: '#10b981',
  OCCUPIED: '#ef4444',
  CLEANING: '#f59e0b',
  MAINTENANCE: '#64748b',
};

interface DashboardData {
  role: string;
  today: string;
  rooms: {
    total: number;
    occupied: number;
    available: number;
    cleaning: number;
    maintenance?: number;
    occupancyRate: number;
    byStatus?: Record<string, number>;
  };
  checkIns?: { count: number; items: any[]; expectedArrivals?: number };
  checkOuts?: { count: number; items: any[] };
  arrivals?: { count: number; items: any[]; expectedArrivals?: number };
  departures?: { count: number; items: any[] };
  activeBookings?: { count: number; items: any[] } | number;
  roomServiceOrders?: any[];
  housekeeping?: { pending: number; inProgress: number };
  revenue?: {
    hotelRevenue: number;
    restaurantRevenue: number;
    totalRevenue: number;
    totalDue: number;
    todaysRevenue: number;
  };
  restaurant?: {
    todaysOrders: number;
    todaysFoodSales: number;
    activeOrders: number;
  };
  sales?: {
    todaysSales: number;
    todaysOrderCount: number;
    averageOrderValue: number;
  };
  tables?: {
    total: number;
    available: number;
    occupied: number;
    reserved: number;
  };
  kotQueue?: {
    pending: number;
    cooking: number;
    items: any[];
  };
  activeOrders?: {
    count: number;
    items: any[];
  };
  charts?: {
    revenueByDay: { date: string; amount: number }[];
  };
  pendingInvoices?: number;
  recentActivities?: any[];
}

type DashboardPageKey = 'bookings';

interface DashboardProps {
  onNavigate?: (page: DashboardPageKey) => void;
}

export function Dashboard({ onNavigate }: DashboardProps = {}) {
  const user = useAuthStore((s) => s.user);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: DashboardData }>('/dashboard');
      return res.data;
    },
    refetchInterval: 2000,
  });

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  const dashboard = data as DashboardData | undefined;
  if (!dashboard) return null;

  // For ADMIN and HOTEL_STAFF
  if (dashboard.role === 'ADMIN' || dashboard.role === 'HOTEL_STAFF' || dashboard.role === 'HOTEL_FD') {
    return <HotelAdminDashboard data={dashboard} onNavigate={onNavigate} />;
  }

  return <div className="text-center text-muted-foreground py-10">Dashboard</div>;
}

function HotelAdminDashboard({
  data,
  onNavigate,
}: {
  data: DashboardData;
  onNavigate?: (page: DashboardPageKey) => void;
}) {
  const handleNewReservation = () => {
    openNewReservationTab();
  };

  const rooms = data.rooms;
  const checkIns = data.checkIns || data.arrivals;
  const checkOuts = data.checkOuts || data.departures;

  // Room status distribution for pie chart
  const roomStatusData = [
    { name: 'Available', value: rooms.available, color: COLORS.AVAILABLE },
    { name: 'Occupied', value: rooms.occupied, color: COLORS.OCCUPIED },
    { name: 'Cleaning', value: rooms.cleaning, color: COLORS.CLEANING },
    ...(rooms.maintenance ? [{ name: 'Maintenance', value: rooms.maintenance, color: COLORS.MAINTENANCE }] : []),
  ].filter((d) => d.value > 0);

  // Revenue chart data
  const revenueChartData = data.charts?.revenueByDay?.map((d) => ({
    ...d,
    date: format(new Date(d.date), 'MMM dd'),
  })) || [];

  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Button
          className="bg-amber-600 hover:bg-amber-700 text-white"
          onClick={handleNewReservation}
        >
          <CalendarCheck2 className="w-4 h-4 mr-2" />
          New Reservation
        </Button>
        <Button
          variant="outline"
          className="border-sky-600 text-sky-700 hover:bg-sky-50"
          onClick={() => onNavigate?.('bookings')}
        >
          <CalendarCheck2 className="w-4 h-4 mr-2" />
          Bookings
        </Button>
        <Button
          variant="outline"
          className="border-emerald-600 text-emerald-700 hover:bg-emerald-50"
          onClick={() => onNavigate?.('bookings')}
        >
          <LogIn className="w-4 h-4 mr-2" />
          Check-in
        </Button>
        <Button
          variant="outline"
          className="border-border text-muted-foreground hover:bg-muted"
          onClick={() => onNavigate?.('bookings')}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Check-out
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard
          title="Total Rooms"
          value={rooms.total}
          icon={<BedDouble className="w-5 h-5" />}
          color="slate"
        />
        <StatCard
          title="Occupied"
          value={rooms.occupied}
          icon={<BedDouble className="w-5 h-5" />}
          color="red"
        />
        <StatCard
          title="Available"
          value={rooms.available}
          icon={<CheckCircle2 className="w-5 h-5" />}
          color="emerald"
        />
        <StatCard
          title="Cleaning"
          value={rooms.cleaning}
          icon={<SprayCan className="w-5 h-5" />}
          color="amber"
        />
        <StatCard
          title="Today's Arrivals"
          value={checkIns?.count || 0}
          icon={<LogIn className="w-5 h-5" />}
          color="emerald"
        />
        <StatCard
          title="Today's Check-outs"
          value={checkOuts?.count || 0}
          icon={<LogOut className="w-5 h-5" />}
          color="slate"
        />
      </div>

      {/* Revenue stats for admin */}
      {data.revenue && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard
            title="Hotel Revenue"
            value={`৳${data.revenue.hotelRevenue.toLocaleString()}`}
            icon={<TakaIcon className="w-5 h-5 text-amber-600" />}
            color="amber"
          />
          <StatCard
            title="Today's Revenue"
            value={`৳${data.revenue.todaysRevenue.toLocaleString()}`}
            icon={<TrendingUp className="w-5 h-5" />}
            color="orange"
          />
          <StatCard
            title="Total Due"
            value={`৳${data.revenue.totalDue.toLocaleString()}`}
            icon={<TakaIcon className="w-5 h-5 text-amber-600" />}
            color="red"
          />
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Occupancy Donut Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Room Occupancy</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              <div className="w-48 h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={roomStatusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={75}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {roomStatusData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-3 flex-1">
                <div className="text-center">
                  <p className="text-3xl font-bold text-amber-700">{rooms.occupancyRate}%</p>
                  <p className="text-xs text-muted-foreground">Occupancy Rate</p>
                </div>
                <div className="space-y-1.5">
                  {roomStatusData.map((d) => (
                    <div key={d.name} className="flex items-center gap-2 text-sm">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                      <span className="flex-1 text-muted-foreground">{d.name}</span>
                      <span className="font-medium">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Revenue Line Chart (admin only) or Bar Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {data.revenue ? '7-Day Revenue' : 'Room Status Distribution'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.revenue && revenueChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={revenueChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <Tooltip
                    formatter={(value: number) => [`৳${value.toLocaleString()}`, 'Revenue']}
                  />
                  <Line
                    type="monotone"
                    dataKey="amount"
                    stroke="#d97706"
                    strokeWidth={2}
                    dot={{ fill: '#d97706', r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={roomStatusData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <Tooltip />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {roomStatusData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Bookings & Room Service */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Bookings */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Today&apos;s Arrivals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-64 overflow-y-auto custom-scrollbar">
              {(checkIns?.items || []).length > 0 ? (
                <div className="space-y-3">
                  {(checkIns?.items || []).slice(0, 5).map((booking: any) => (
                    <div key={booking.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{booking.customer?.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Room {booking.room?.roomNumber} • {booking.room?.type?.name}
                        </p>
                      </div>
                      <StatusBadge status={booking.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No arrivals for this business day</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Room Service Orders */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Room Service Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-64 overflow-y-auto custom-scrollbar">
              {(data.roomServiceOrders || []).length > 0 ? (
                <div className="space-y-3">
                  {(data.roomServiceOrders || []).slice(0, 5).map((order: any) => (
                    <div key={order.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">
                          Room {order.room?.roomNumber}
                          <span className="text-muted-foreground font-normal ml-2">
                            {order.orderNumber}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {order.items?.map((i: any) => i.menuItem?.name).join(', ') || 'No items'}
                        </p>
                      </div>
                      <div className="text-right">
                        <StatusBadge status={order.status} />
                        <p className="text-xs text-muted-foreground mt-1">৳{order.totalAmount}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No active room service orders</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  color: 'slate' | 'red' | 'emerald' | 'amber' | 'orange';
}) {
  const colorMap = {
    slate: 'bg-muted text-muted-foreground',
    red: 'bg-red-50 text-red-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    orange: 'bg-orange-50 text-orange-600',
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorMap[color]}`}>
            {icon}
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium">{title}</p>
            <p className="text-xl font-bold">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex gap-3">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-10 w-28" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="w-10 h-10 rounded-lg" />
                <div className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-6 w-12" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CalendarCheck2(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
      <path d="m9 16 2 2 4-4" />
    </svg>
  );
}
