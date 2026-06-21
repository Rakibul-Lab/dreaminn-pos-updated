import { formatBdtForPdf } from './currency'
import {
  downloadTableExcel,
  downloadTablePdf,
  tableExportFileName,
  type PdfColumnDef,
  type TableExportMeta,
} from './table-report-export'

export type BeverageMenuExportItem = {
  id: string
  name: string
  description: string | null
  price: number
  available: boolean
  isVeg: boolean
  category: { id: string; name: string }
}

export type BeverageMenuExportMeta = TableExportMeta & {
  categoryLabel?: string
}

const HEADERS = ['Item Name', 'Category', 'Description', 'Price (BDT)', 'Type', 'Availability'] as const

function mapBeverageMenuRow(item: BeverageMenuExportItem): Record<string, string | number> {
  return {
    'Item Name': item.name,
    Category: item.category.name,
    Description: item.description?.trim() || '—',
    'Price (BDT)': item.price,
    Type: item.isVeg ? 'Vegetarian' : 'Non-Veg',
    Availability: item.available ? 'Available' : 'Unavailable',
  }
}

function buildInfoRows(meta: BeverageMenuExportMeta, items: BeverageMenuExportItem[]): [string, string | number][] {
  return [
    ['Category filter', meta.categoryLabel ?? 'All beverages'],
    ['Total items', items.length],
    ['Available items', items.filter((i) => i.available).length],
  ]
}

function pdfColumns(): PdfColumnDef[] {
  return [
    { header: 'Item', width: 40, value: (r) => String(r['Item Name']) },
    { header: 'Category', width: 28, value: (r) => String(r.Category) },
    { header: 'Description', width: 44, value: (r) => String(r.Description) },
    { header: 'Price', width: 20, value: (r) => formatBdtForPdf(Number(r['Price (BDT)'])), align: 'right' },
    { header: 'Type', width: 18, value: (r) => String(r.Type) },
    { header: 'Status', width: 18, value: (r) => String(r.Availability) },
  ]
}

export async function downloadBeverageMenuExcel(
  items: BeverageMenuExportItem[],
  meta: BeverageMenuExportMeta = {}
): Promise<void> {
  const rows = items.map(mapBeverageMenuRow)
  await downloadTableExcel({
    title: 'Hotel Beverage Menu',
    sheetName: 'Beverages',
    headers: [...HEADERS],
    rows,
    meta: { ...meta, infoRows: buildInfoRows(meta, items) },
    fileName: tableExportFileName('hotel-beverage-menu', 'xlsx'),
  })
}

export async function downloadBeverageMenuPdf(
  items: BeverageMenuExportItem[],
  meta: BeverageMenuExportMeta = {}
): Promise<void> {
  const rows = items.map(mapBeverageMenuRow)
  await downloadTablePdf({
    title: 'Hotel Beverage Menu',
    columns: pdfColumns(),
    rows,
    meta: { ...meta, infoRows: buildInfoRows(meta, items) },
    fileName: tableExportFileName('hotel-beverage-menu', 'pdf'),
    summaryLine: `${items.length} beverage item(s)`,
  })
}
