import { format } from 'date-fns'
import {
  downloadTableExcel,
  downloadTablePdf,
  tableExportFileName,
  type PdfColumnDef,
  type TableExportMeta,
} from './table-report-export'

export type InventoryHistoryExportRow = {
  id: string
  type: string
  quantity: number
  notes: string | null
  createdByName: string | null
  createdAt: string
}

export type InventoryHistoryExportMeta = TableExportMeta & {
  itemName: string
  category?: string | null
  unit?: string
  dateFrom?: string
  dateTo?: string
  typeFilter?: string
  currentQuantity?: number
}

const HEADERS = ['Date', 'Type', 'Quantity', 'Notes', 'Recorded By'] as const

function typeLabel(type: string): string {
  if (type === 'in') return 'Stock In'
  if (type === 'out') return 'Stock Out'
  if (type === 'waste') return 'Waste'
  return type
}

function mapHistoryRow(row: InventoryHistoryExportRow): Record<string, string | number> {
  return {
    Date: format(new Date(row.createdAt), 'dd MMM yyyy, HH:mm'),
    Type: typeLabel(row.type),
    Quantity: row.quantity,
    Notes: row.notes?.trim() || '—',
    'Recorded By': row.createdByName?.trim() || '—',
  }
}

function buildInfoRows(
  meta: InventoryHistoryExportMeta,
  rows: InventoryHistoryExportRow[]
): [string, string | number][] {
  const stockIn = rows.filter((r) => r.type === 'in').reduce((s, r) => s + r.quantity, 0)
  const stockOut = rows.filter((r) => r.type === 'out').reduce((s, r) => s + r.quantity, 0)
  const waste = rows.filter((r) => r.type === 'waste').reduce((s, r) => s + r.quantity, 0)

  return [
    ['Item', meta.itemName],
    ['Category', meta.category?.trim() || 'Uncategorized'],
    ['Unit', meta.unit || '—'],
    ['Current quantity', meta.currentQuantity ?? '—'],
    [
      'Date range',
      meta.dateFrom || meta.dateTo
        ? `${meta.dateFrom || '…'} → ${meta.dateTo || '…'}`
        : 'All dates',
    ],
    ['Type filter', meta.typeFilter && meta.typeFilter !== 'all' ? typeLabel(meta.typeFilter) : 'All types'],
    ['Movements', rows.length],
    ['Total stock in', stockIn],
    ['Total stock out', stockOut],
    ['Total waste', waste],
  ]
}

function pdfColumns(): PdfColumnDef[] {
  return [
    { header: 'Date', width: 36, value: (r) => String(r.Date) },
    { header: 'Type', width: 24, value: (r) => String(r.Type) },
    { header: 'Qty', width: 18, value: (r) => String(r.Quantity), align: 'right' },
    { header: 'Notes', width: 55, value: (r) => String(r.Notes) },
    { header: 'Recorded By', width: 32, value: (r) => String(r['Recorded By']) },
  ]
}

export async function downloadInventoryHistoryExcel(
  rows: InventoryHistoryExportRow[],
  meta: InventoryHistoryExportMeta
): Promise<void> {
  const mapped = rows.map(mapHistoryRow)
  await downloadTableExcel({
    title: `Inventory History — ${meta.itemName}`,
    sheetName: 'History',
    headers: [...HEADERS],
    rows: mapped,
    meta: { ...meta, infoRows: buildInfoRows(meta, rows) },
    fileName: tableExportFileName(`inventory-history-${meta.itemName}`, 'xlsx'),
  })
}

export async function downloadInventoryHistoryPdf(
  rows: InventoryHistoryExportRow[],
  meta: InventoryHistoryExportMeta
): Promise<void> {
  const mapped = rows.map(mapHistoryRow)
  const stockIn = rows.filter((r) => r.type === 'in').reduce((s, r) => s + r.quantity, 0)
  const stockOut = rows.filter((r) => r.type === 'out').reduce((s, r) => s + r.quantity, 0)

  await downloadTablePdf({
    title: `Inventory History — ${meta.itemName}`,
    columns: pdfColumns(),
    rows: mapped,
    meta: { ...meta, infoRows: buildInfoRows(meta, rows) },
    fileName: tableExportFileName(`inventory-history-${meta.itemName}`, 'pdf'),
    summaryLine: `Movements: ${rows.length}  |  In: ${stockIn}  |  Out: ${stockOut}`,
  })
}
