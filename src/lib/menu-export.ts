import { formatBdtForPdf } from './currency'
import {
  downloadTableExcel,
  downloadTablePdf,
  tableExportFileName,
  type PdfColumnDef,
  type TableExportMeta,
} from './table-report-export'

export type MenuItemExportRecord = {
  id: string
  name: string
  description: string | null
  price: number
  available: boolean
  isVeg: boolean
  preparationTime: number | null
  category: { id: string; name: string }
}

export type MenuCategoryExportRecord = {
  id: string
  name: string
  description: string | null
  active: boolean
  sortOrder: number
  itemCount?: number
}

export type MenuExportMeta = TableExportMeta & {
  category?: string
  categoryLabel?: string
  search?: string
  sort?: string
}

const HEADERS = [
  'Item Name',
  'Category',
  'Description',
  'Price (BDT)',
  'Type',
  'Availability',
  'Prep Time (min)',
] as const

function mapMenuItemRow(item: MenuItemExportRecord): Record<string, string | number> {
  return {
    'Item Name': item.name,
    Category: item.category.name,
    Description: item.description?.trim() || '—',
    'Price (BDT)': item.price,
    Type: item.isVeg ? 'Vegetarian' : 'Non-Veg',
    Availability: item.available ? 'Available' : 'Unavailable',
    'Prep Time (min)': item.preparationTime ?? '—',
  }
}

function buildInfoRows(meta: MenuExportMeta, items: MenuItemExportRecord[]): [string, string | number][] {
  const availableCount = items.filter((i) => i.available).length
  const vegCount = items.filter((i) => i.isVeg).length
  return [
    ['Category filter', meta.categoryLabel ?? 'All categories'],
    ['Search', meta.search?.trim() || '—'],
    ['Sort', meta.sort === 'price' ? 'Price (low to high)' : 'Name (A–Z)'],
    ['Available items', availableCount],
    ['Vegetarian items', vegCount],
  ]
}

export function buildMenuItemsExportQuery(
  filters: { categoryId?: string; available?: string; search?: string },
  limit = 5000
): string {
  const params = new URLSearchParams()
  params.set('page', '1')
  params.set('limit', String(limit))
  if (filters.categoryId && filters.categoryId !== 'all') params.set('categoryId', filters.categoryId)
  if (filters.available) params.set('available', filters.available)
  if (filters.search?.trim()) params.set('search', filters.search.trim())
  return `/menu-items?${params.toString()}`
}

function pdfColumns(): PdfColumnDef[] {
  return [
    { header: 'Item', width: 36, value: (r) => String(r['Item Name']) },
    { header: 'Category', width: 24, value: (r) => String(r.Category) },
    { header: 'Description', width: 42, value: (r) => String(r.Description) },
    { header: 'Price', width: 18, value: (r) => formatBdtForPdf(Number(r['Price (BDT)'])), align: 'right' },
    { header: 'Type', width: 18, value: (r) => String(r.Type) },
    { header: 'Status', width: 18, value: (r) => String(r.Availability) },
    { header: 'Prep', width: 14, value: (r) => String(r['Prep Time (min)']), align: 'right' },
  ]
}

export async function downloadMenuExcel(
  items: MenuItemExportRecord[],
  meta: MenuExportMeta = {}
): Promise<void> {
  const rows = items.map(mapMenuItemRow)

  await downloadTableExcel({
    title: 'Menu Management Report',
    sheetName: 'Menu Items',
    headers: [...HEADERS],
    rows,
    meta: { ...meta, infoRows: buildInfoRows(meta, items) },
    fileName: tableExportFileName('menu-items', 'xlsx'),
  })
}

export async function downloadMenuPdf(
  items: MenuItemExportRecord[],
  meta: MenuExportMeta = {}
): Promise<void> {
  const rows = items.map(mapMenuItemRow)
  const availableCount = items.filter((i) => i.available).length

  await downloadTablePdf({
    title: 'Menu Management Report',
    columns: pdfColumns(),
    rows,
    meta: { ...meta, infoRows: buildInfoRows(meta, items) },
    fileName: tableExportFileName('menu-items', 'pdf'),
    summaryLine: `Available: ${availableCount} / ${items.length}`,
  })
}
