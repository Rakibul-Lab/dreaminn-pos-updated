'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useAuthStore, canAccessAdmin } from '@/lib/auth-store'
import { format } from 'date-fns'
import {
  buildActivityLogsExportQuery,
  downloadActivityLogsExcel,
  downloadActivityLogsPdf,
  type ActivityLogExportRecord,
} from '@/lib/activity-logs-export'
import { toast } from 'sonner'
import {
  ScrollText, Filter, RefreshCw, ChevronLeft, ChevronRight, FileDown, Loader2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'

interface LogEntry {
  id: string
  action: string
  module: string
  details: string | null
  createdAt: string
  user: { id: string; name: string; email: string; role: string } | null
}

const moduleColors: Record<string, string> = {
  hotel: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  restaurant: 'bg-amber-50 text-amber-700 border-amber-200',
  billing: 'bg-sky-50 text-sky-700 border-sky-200',
  admin: 'bg-purple-50 text-purple-700 border-purple-200',
  auth: 'bg-orange-50 text-orange-700 border-orange-200',
}

export default function ActivityLogsPage() {
  const { user } = useAuthStore()
  const [page, setPage] = useState(1)
  const [moduleFilter, setModuleFilter] = useState<string>('all')
  const [actionFilter, setActionFilter] = useState<string>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)

  const queryParams = new URLSearchParams()
  queryParams.set('page', String(page))
  queryParams.set('limit', '20')
  if (moduleFilter !== 'all') queryParams.set('module', moduleFilter)
  if (actionFilter) queryParams.set('action', actionFilter)
  if (dateFrom) queryParams.set('startDate', dateFrom)
  if (dateTo) queryParams.set('endDate', dateTo)

  const { data: logsData, isLoading } = useQuery({
    queryKey: ['activity-logs', page, moduleFilter, actionFilter, dateFrom, dateTo],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: LogEntry[]; meta?: { total: number; totalPages: number } }>(`/activity-logs?${queryParams.toString()}`)
      return res
    },
    enabled: !!user && canAccessAdmin(user?.role),
  })

  if (!user || !canAccessAdmin(user.role)) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="p-6 text-center">
          <p className="text-amber-700 font-medium">Access Denied</p>
          <p className="text-amber-600 text-sm mt-1">Only administrators can view activity logs.</p>
        </CardContent>
      </Card>
    )
  }

  const logs = logsData?.data || []
  const totalPages = logsData?.meta?.totalPages || 1
  const total = logsData?.meta?.total || 0

  const buildExportMeta = () => ({
    exportedAt: new Date(),
    generatedBy: user ? { name: user.name, email: user.email, role: user.role } : undefined,
    module: moduleFilter,
    action: actionFilter,
    dateFrom,
    dateTo,
  })

  const fetchExportRows = async (): Promise<ActivityLogExportRecord[]> => {
    const path = buildActivityLogsExportQuery({
      module: moduleFilter,
      action: actionFilter,
      startDate: dateFrom,
      endDate: dateTo,
    })
    const res = await api.get<{ success: boolean; data: ActivityLogExportRecord[] }>(path)
    return res.data ?? []
  }

  const handleExportExcel = async () => {
    setExporting('excel')
    const toastId = toast.loading('Preparing Excel export…')
    try {
      const rows = await fetchExportRows()
      if (!rows.length) {
        toast.error('No logs to export', { id: toastId, description: 'Adjust filters to include activity logs.' })
        return
      }
      await downloadActivityLogsExcel(rows, buildExportMeta())
      toast.success(`Exported ${rows.length} log(s) to Excel`, { id: toastId })
    } catch (err) {
      toast.error('Export failed', {
        id: toastId,
        description: err instanceof Error ? err.message : 'Could not export activity logs',
      })
    } finally {
      setExporting(null)
    }
  }

  const handleExportPdf = async () => {
    setExporting('pdf')
    const toastId = toast.loading('Preparing PDF export…')
    try {
      const rows = await fetchExportRows()
      if (!rows.length) {
        toast.error('No logs to export', { id: toastId, description: 'Adjust filters to include activity logs.' })
        return
      }
      await downloadActivityLogsPdf(rows, buildExportMeta())
      toast.success(`Exported ${rows.length} log(s) to PDF`, { id: toastId })
    } catch (err) {
      toast.error('Export failed', {
        id: toastId,
        description: err instanceof Error ? err.message : 'Could not export activity logs',
      })
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <ScrollText className="h-6 w-6 text-amber-600" />
          <h2 className="text-2xl font-bold text-foreground">Activity Logs</h2>
          <Badge variant="outline" className="ml-2">{total} total</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExportExcel()}
            disabled={!!exporting || isLoading}
          >
            {exporting === 'excel' ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4 mr-2" />
            )}
            Export Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExportPdf()}
            disabled={!!exporting || isLoading}
          >
            {exporting === 'pdf' ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4 mr-2" />
            )}
            Export PDF
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={moduleFilter} onValueChange={(v) => { setModuleFilter(v); setPage(1) }}>
              <SelectTrigger className="w-full sm:w-48">
                <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Module" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modules</SelectItem>
                <SelectItem value="hotel">Hotel</SelectItem>
                <SelectItem value="restaurant">Restaurant</SelectItem>
                <SelectItem value="billing">Billing</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="auth">Auth</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Filter by action (e.g., LOGIN, CREATE_BOOKING)"
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setPage(1) }}
              className="flex-1"
            />
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
              className="w-40"
              placeholder="From"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
              className="w-40"
              placeholder="To"
            />
            <Button variant="outline" size="icon" onClick={() => setPage(1)}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Logs Table */}
      <Card>
        <CardContent className="p-0">
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-24" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No logs found</TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id} className="hover:bg-muted">
                      <TableCell className="text-sm font-mono whitespace-nowrap">
                        {format(new Date(log.createdAt), 'MMM dd, yyyy HH:mm:ss')}
                      </TableCell>
                      <TableCell className="text-sm">
                        {log.user ? (
                          <div>
                            <p className="font-medium">{log.user.name}</p>
                            <p className="text-xs text-muted-foreground">{log.user.email}</p>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">System</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {log.action}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={moduleColors[log.module] || ''}>
                          {log.module}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                        {log.details ? (
                          <span title={log.details} className="cursor-help">
                            {log.details.length > 80 ? `${log.details.substring(0, 80)}...` : log.details}
                          </span>
                        ) : '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground px-3">
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
