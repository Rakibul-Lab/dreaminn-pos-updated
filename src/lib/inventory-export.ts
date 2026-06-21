import { format } from 'date-fns'
import { formatBdtForPdf } from './currency'
import {
  downloadTableExcel,
  downloadTablePdf,
  tableExportFileName,
  type PdfColumnDef,
  type TableExportMeta,
} from './table-report-export'

export type InventoryExportRecord = {
  id: string
  name: string
  category: string | null
  unit: string
  quantity: number
  minQuantity: number
  costPerUnit: number | null
  supplier: string | null
  updatedAt: string
}

export type InventoryExportMeta = TableExportMeta & {
  category?: string
  lowStockOnly?: boolean
}

const HEADERS = [
  'Name',
  'Category',
  'Unit',
  'Quantity',
  'Min Qty',
  'Status',
  'Cost/Unit (BDT)',
  'Stock Value (BDT)',
  'Supplier',
  'Last Updated',
] as const

function stockStatus(item: InventoryExportRecord): string {
  return item.quantity <= item.minQuantity ? 'Low Stock' : 'In Stock'
}

function stockValue(item: InventoryExportRecord): number {
  if (!item.costPerUnit) return 0
  return item.quantity * item.costPerUnit
}

function mapInventoryRow(item: InventoryExportRecord): Record<string, string | number> {
  return {
    Name: item.name,
    Category: item.category || 'Uncategorized',
    Unit: item.unit,
    Quantity: item.quantity,
    'Min Qty': item.minQuantity,
    Status: stockStatus(item),
    'Cost/Unit (BDT)': item.costPerUnit ?? 0,
    'Stock Value (BDT)': stockValue(item),
    Supplier: item.supplier?.trim() || '—',
    'Last Updated': format(new Date(item.updatedAt), 'dd MMM yyyy, HH:mm'),
  }
}

function computeTotals(items: InventoryExportRecord[]) {
  const lowStockCount = items.filter((i) => i.quantity <= i.minQuantity).length
  const totalStockValue = items.reduce((sum, i) => sum + stockValue(i), 0)
  return { lowStockCount, totalStockValue }
}

function buildInfoRows(meta: InventoryExportMeta, items: InventoryExportRecord[]): [string, string | number][] {
  const { lowStockCount, totalStockValue } = computeTotals(items)
  return [
    ['Category filter', meta.category && meta.category !== 'all' ? meta.category : 'All categories'],
    ['Stock filter', meta.lowStockOnly ? 'Low stock only' : 'All items'],
    ['Low stock items', lowStockCount],
    ['Total stock value (BDT)', totalStockValue],
  ]
}

export function buildInventoryExportQuery(
  filters: { category?: string; lowStock?: boolean; search?: string },
  limit = 5000
): string {
  const params = new URLSearchParams()
  params.set('page', '1')
  params.set('limit', String(limit))
  if (filters.category && filters.category !== 'all') params.set('category', filters.category)
  if (filters.lowStock) params.set('lowStock', 'true')
  if (filters.search?.trim()) params.set('search', filters.search.trim())
  return `/inventory?${params.toString()}`
}

function pdfColumns(): PdfColumnDef[] {
  return [
    { header: 'Name', width: 32, value: (r) => String(r.Name) },
    { header: 'Category', width: 22, value: (r) => String(r.Category) },
    { header: 'Unit', width: 14, value: (r) => String(r.Unit) },
    { header: 'Qty', width: 14, value: (r) => String(r.Quantity), align: 'right' },
    { header: 'Min', width: 14, value: (r) => String(r['Min Qty']), align: 'right' },
    { header: 'Status', width: 18, value: (r) => String(r.Status) },
    { header: 'Cost/Unit', width: 20, value: (r) => formatBdtForPdf(Number(r['Cost/Unit (BDT)'])), align: 'right' },
    { header: 'Stock Value', width: 22, value: (r) => formatBdtForPdf(Number(r['Stock Value (BDT)'])), align: 'right' },
    { header: 'Supplier', width: 28, value: (r) => String(r.Supplier) },
  ]
}

export async function downloadInventoryExcel(
  items: InventoryExportRecord[],
  meta: InventoryExportMeta = {}
): Promise<void> {
  const rows = items.map(mapInventoryRow)
  const { totalStockValue } = computeTotals(items)
  const totalsRow: (string | number)[] = [
    'Grand Total',
    '',
    '',
    '',
    '',
    '',
    '',
    totalStockValue,
    '',
    '',
  ]

  await downloadTableExcel({
    title: 'Inventory Report',
    sheetName: 'Inventory',
    headers: [...HEADERS],
    rows,
    meta: { ...meta, infoRows: buildInfoRows(meta, items) },
    fileName: tableExportFileName('inventory', 'xlsx'),
    totalsRow,
  })
}

export async function downloadInventoryPdf(
  items: InventoryExportRecord[],
  meta: InventoryExportMeta = {}
): Promise<void> {
  const rows = items.map(mapInventoryRow)
  const { lowStockCount, totalStockValue } = computeTotals(items)

  await downloadTablePdf({
    title: 'Inventory Report',
    columns: pdfColumns(),
    rows,
    meta: { ...meta, infoRows: buildInfoRows(meta, items) },
    fileName: tableExportFileName('inventory', 'pdf'),
    summaryLine: `Low stock: ${lowStockCount}  |  Total stock value: ${formatBdtForPdf(totalStockValue)}`,
    totalsRow: {
      Name: 'Grand Total',
      Category: '',
      Unit: '',
      Quantity: '',
      'Min Qty': '',
      Status: '',
      'Cost/Unit (BDT)': '',
      'Stock Value (BDT)': totalStockValue,
      Supplier: '',
    },
  })
}
