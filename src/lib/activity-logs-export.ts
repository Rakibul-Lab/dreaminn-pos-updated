import { format } from 'date-fns'
import {
  downloadTableExcel,
  downloadTablePdf,
  tableExportFileName,
  type PdfColumnDef,
  type TableExportMeta,
} from './table-report-export'

export type ActivityLogExportRecord = {
  id: string
  action: string
  module: string
  details: string | null
  createdAt: string
  user: { id: string; name: string; email: string; role: string } | null
}

export type ActivityLogsExportMeta = TableExportMeta & {
  module?: string
  action?: string
  dateFrom?: string
  dateTo?: string
}

const MODULE_LABELS: Record<string, string> = {
  hotel: 'Hotel',
  restaurant: 'Restaurant',
  billing: 'Billing',
  admin: 'Admin',
  auth: 'Auth',
}

const HEADERS = [
  'Timestamp',
  'User',
  'Email',
  'Role',
  'Action',
  'Module',
  'Details',
] as const

function mapLogRow(log: ActivityLogExportRecord): Record<string, string> {
  const at = new Date(log.createdAt)
  return {
    Timestamp: format(at, 'dd MMM yyyy, HH:mm:ss'),
    User: log.user?.name ?? 'System',
    Email: log.user?.email ?? '—',
    Role: log.user?.role ?? '—',
    Action: log.action,
    Module: MODULE_LABELS[log.module] ?? log.module,
    Details: log.details?.trim() || '—',
  }
}

function buildInfoRows(meta: ActivityLogsExportMeta): [string, string | number][] {
  const dateRange =
    meta.dateFrom || meta.dateTo
      ? `${meta.dateFrom || '…'} to ${meta.dateTo || '…'}`
      : 'All dates'
  return [
    ['Module filter', meta.module && meta.module !== 'all' ? MODULE_LABELS[meta.module] ?? meta.module : 'All modules'],
    ['Action filter', meta.action?.trim() || 'All actions'],
    ['Date range', dateRange],
  ]
}

export function buildActivityLogsExportQuery(
  filters: { module?: string; action?: string; startDate?: string; endDate?: string },
  limit = 5000
): string {
  const params = new URLSearchParams()
  params.set('page', '1')
  params.set('limit', String(limit))
  if (filters.module && filters.module !== 'all') params.set('module', filters.module)
  if (filters.action?.trim()) params.set('action', filters.action.trim())
  if (filters.startDate) params.set('startDate', filters.startDate)
  if (filters.endDate) params.set('endDate', filters.endDate)
  return `/activity-logs?${params.toString()}`
}

function pdfColumns(): PdfColumnDef[] {
  return [
    { header: 'Timestamp', width: 32, value: (r) => String(r.Timestamp) },
    { header: 'User', width: 28, value: (r) => String(r.User) },
    { header: 'Email', width: 36, value: (r) => String(r.Email) },
    { header: 'Role', width: 18, value: (r) => String(r.Role) },
    { header: 'Action', width: 28, value: (r) => String(r.Action) },
    { header: 'Module', width: 18, value: (r) => String(r.Module) },
    { header: 'Details', width: 52, value: (r) => String(r.Details) },
  ]
}

export async function downloadActivityLogsExcel(
  logs: ActivityLogExportRecord[],
  meta: ActivityLogsExportMeta = {}
): Promise<void> {
  const rows = logs.map(mapLogRow)
  await downloadTableExcel({
    title: 'Activity Logs Report',
    sheetName: 'Activity Logs',
    headers: [...HEADERS],
    rows,
    meta: { ...meta, infoRows: buildInfoRows(meta) },
    fileName: tableExportFileName('activity-logs', 'xlsx'),
  })
}

export async function downloadActivityLogsPdf(
  logs: ActivityLogExportRecord[],
  meta: ActivityLogsExportMeta = {}
): Promise<void> {
  const rows = logs.map(mapLogRow)
  await downloadTablePdf({
    title: 'Activity Logs Report',
    columns: pdfColumns(),
    rows,
    meta: { ...meta, infoRows: buildInfoRows(meta) },
    fileName: tableExportFileName('activity-logs', 'pdf'),
  })
}
