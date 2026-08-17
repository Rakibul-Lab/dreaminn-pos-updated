'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useAuthStore, canAccessAdmin } from '@/lib/auth-store'
import { format } from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import {
  LayoutDashboard, BedDouble, Users, Activity,
  Database, ScrollText, AlertTriangle, TrendingUp, ArrowUpRight, CalendarCheck
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Separator } from '@/components/ui/separator'
import { TakaIcon } from '@/components/icons/TakaIcon'

const revenueChartConfig: ChartConfig = {
  amount: { label: 'Revenue', color: '#d97706' },
}

export default function AdminDashboard({
  onNavigate,
}: {
  onNavigate?: (page: 'bookings' | 'hotel-dashboard') => void
} = {}) {
  const { user } = useAuthStore()

  const { data: dashboardData, isLoading } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>('/dashboard')
      return res.data
    },
    enabled: !!user && canAccessAdmin(user?.role),
    refetchInterval: 60000,
  })

  if (!user || !canAccessAdmin(user.role)) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="p-6 text-center">
          <p className="text-amber-700 font-medium">Access Denied</p>
          <p className="text-amber-600 text-sm mt-1">Only administrators can access this dashboard.</p>
        </CardContent>
      </Card>
    )
  }

  const d = dashboardData || {}
  const revenue = d.revenue as Record<string, number> | undefined
  const rooms = d.rooms as Record<string, number> | undefined
  const charts = d.charts as { revenueByDay: Array<{ date: string; amount: number }> } | undefined
  const recentActivities = d.recentActivities as Array<Record<string, unknown>> | undefined
  const checkIns = d.checkIns as { count: number; items: Array<Record<string, unknown>> } | undefined
  const checkOuts = d.checkOuts as { count: number; items: Array<Record<string, unknown>> } | undefined

  const revenueByDay = charts?.revenueByDay || []
  const chartData = revenueByDay.map((d) => ({
    date: format(new Date(d.date), 'MMM dd'),
    amount: d.amount,
  }))

  const handleSeedDB = async () => {
    try {
      await api.post('/auth/seed')
      window.location.reload()
    } catch {
      // ignore - might already be seeded
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-6 w-6 text-amber-600" />
          <h2 className="text-2xl font-bold text-foreground">Admin Dashboard</h2>
        </div>
        {onNavigate ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="border-sky-600 text-sky-700 hover:bg-sky-50"
              onClick={() => onNavigate('bookings')}
            >
              <CalendarCheck className="h-4 w-4 mr-2" />
              Bookings
            </Button>
            <Button
              variant="outline"
              onClick={() => onNavigate('hotel-dashboard')}
            >
              Hotel Dashboard
            </Button>
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card className="border-l-4 border-l-amber-500">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-3 rounded-lg bg-amber-50">
                  <TakaIcon className="h-6 w-6 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Revenue</p>
                  <p className="text-2xl font-bold text-foreground">৳{(revenue?.hotelRevenue || 0).toLocaleString()}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-purple-500">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-3 rounded-lg bg-purple-50">
                  <Users className="h-6 w-6 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Bookings</p>
                  <p className="text-2xl font-bold text-purple-700">{(d.activeBookings || 0) as number}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-rose-500">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-3 rounded-lg bg-rose-50">
                  <TrendingUp className="h-6 w-6 text-rose-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Occupancy Rate</p>
                  <p className="text-2xl font-bold text-rose-700">{(rooms?.occupancyRate || 0) as number}%</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Revenue Trend Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-amber-600" />
                Revenue Trend (Last 7 Days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {chartData.length > 0 ? (
                <ChartContainer config={revenueChartConfig} className="h-64 w-full">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="amount" fill="var(--color-amount)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <p className="text-center text-muted-foreground py-8">No revenue data available</p>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Recent Activity Log */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <ScrollText className="h-4 w-4 text-amber-600" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {recentActivities?.length ? recentActivities.slice(0, 10).map((activity, i) => (
                    <div key={i} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted">
                      <div className="h-2 w-2 rounded-full bg-amber-400 mt-2 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{(activity.action as string) || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground">
                          {(activity.user as Record<string, string>)?.name || 'System'} &bull; {activity.module as string} &bull; {format(new Date(activity.createdAt as string), 'MMM dd, HH:mm')}
                        </p>
                      </div>
                    </div>
                  )) : (
                    <p className="text-center text-muted-foreground py-4">No recent activities</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* System Health & Quick Actions */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-emerald-600" />
                  System Health
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Active Bookings</span>
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700">{(d.activeBookings || 0) as number}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Pending Invoices</span>
                    <Badge variant="outline" className="bg-amber-50 text-amber-700">{(d.pendingInvoices || 0) as number}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Rooms Available</span>
                    <Badge variant="outline" className="bg-sky-50 text-sky-700">{(rooms?.available || 0) as number} / {(rooms?.total || 0) as number}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Total Due</span>
                    <Badge variant="outline" className="bg-red-50 text-red-700">৳{(revenue?.totalDue || 0).toLocaleString()}</Badge>
                  </div>
                  <Separator />
                  <div>
                    <p className="text-sm font-medium text-foreground mb-2">Quick Actions</p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={handleSeedDB}>
                        <Database className="h-3 w-3 mr-1" /> Seed DB
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <a href="#/admin/users"><Users className="h-3 w-3 mr-1" /> Users</a>
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <a href="#/admin/logs"><ScrollText className="h-3 w-3 mr-1" /> Logs</a>
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
