import { format } from 'date-fns'
import ExcelJS from 'exceljs'
import { jsPDF } from 'jspdf'
import { HOTEL_NAME } from './reservation-terms'
import { getLogoDataUrl } from './reservation-document-html'
import { formatBdtForPdf } from './currency'
import {
  formatBookingDateFilterLabel,
  type BookingDatePreset,
} from './booking-date-filter'
import {
  formatOrderBillingDetail,
  formatOrderBillingState,
  resolveOrderBillingState,
  resolveRestaurantBalanceDisplay,
} from './restaurant-order-billing'
import { computeOrderDue } from './restaurant-order-dues'
import { formatPaymentMethod } from './payment-method'

const PDF_LINE_HEIGHT = 3.4
const PDF_CELL_PAD = 1.2

type PdfColumn = {
  header: string
  baseWidth: number
  width: number
  value: (r: Record<string, string>) => string
  align?: 'right'
}

export type RestaurantOrderExportRecord = {
  orderNumber: string
  orderType: string
  status: string
  subtotal?: number
  discount?: number
  vatAmount?: number
  vatPercent?: number
  totalAmount: number
  createdAt: string
  customerName?: string | null
  notes?: string | null
  billingDisposition?: 'PENDING' | 'HOTEL_BILL' | 'PAID_DIRECT' | null
  bookingId?: string | null
  room?: { roomNumber: string } | null
  table?: { tableNumber: string } | null
  items?: { quantity: number; menuItem?: { name: string } }[]
  payments?: {
    amount: number
    paymentType: string
    settlementSource?: string | null
    method?: string
  }[]
  companyLedgerBill?: { id: string } | null
}

export type RestaurantOrdersExportMeta = {
  exportedAt?: Date
  generatedBy?: { name: string; email?: string; role?: string }
  datePreset?: BookingDatePreset
  customDateFrom?: string
  customDateTo?: string
  orderType?: string
  status?: string
  sort?: string
  search?: string
}

export type RestaurantOrdersExportTotals = {
  orderCount: number
  subtotalSum: number
  discountSum: number
  vatSum: number
  totalSum: number
  paidAtRestaurantSum: number
  restaurantDueSum: number
  hotelBillSum: number
}

const ORDER_TYPE_LABELS: Record<string, string> = {
  DINE_IN: 'Dine-in',
  TAKEAWAY: 'Takeaway',
  ROOM_SERVICE: 'Room Service',
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  COOKING: 'Cooking',
  READY: 'Ready',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
}

const EXPORT_HEADERS = [
  'Order #',
  'Date & Time',
  'Type',
  'Location',
  'Status',
  'Items',
  'Subtotal',
  'Discount',
  'VAT',
  'Order Total',
  'Restaurant Received',
  'Restaurant Due',
  'Hotel / Room Bill',
  'Billing Status',
  'Billing Detail',
  'Payments',
  'Notes',
] as const

function formatGeneratedBy(user?: RestaurantOrdersExportMeta['generatedBy']): string {
  if (!user?.name) return '—'
  if (user.email) return `${user.name} (${user.email})`
  return user.name
}

function locationLabel(order: RestaurantOrderExportRecord): string {
  if (order.orderType === 'DINE_IN' && order.table) return `Table ${order.table.tableNumber}`
  if (order.orderType === 'ROOM_SERVICE' && order.room) return `Room ${order.room.roomNumber}`
  if (order.orderType === 'TAKEAWAY' && order.customerName) return order.customerName
  return '—'
}

function itemsSummary(order: RestaurantOrderExportRecord): string {
  if (!order.items?.length) return '—'
  return order.items
    .map((item) => `${item.menuItem?.name ?? 'Item'} x${item.quantity}`)
    .join('; ')
}

function paymentsSummary(order: RestaurantOrderExportRecord): string {
  const lines = (order.payments ?? []).filter((p) => p.paymentType !== 'REFUND' && p.amount > 0)
  if (!lines.length) return '—'
  return lines
    .map((p) => {
      const method = p.method ? formatPaymentMethod(p.method) : 'Payment'
      return `${method}: BDT ${p.amount.toFixed(0)}`
    })
    .join('; ')
}

function computeOrderExportAmounts(order: RestaurantOrderExportRecord) {
  const { paidAmount, dueAmount } = computeOrderDue(order.totalAmount, order.payments ?? [])
  const balance = resolveRestaurantBalanceDisplay({
    billingDisposition: order.billingDisposition,
    companyLedgerBill: order.companyLedgerBill,
    bookingId: order.bookingId,
    orderType: order.orderType,
    payments: order.payments,
    totalAmount: order.totalAmount,
  })

  const restaurantDue =
    balance.destination === 'RESTAURANT_DUE' && dueAmount > 0.009 ? dueAmount : 0
  const hotelBill =
    (balance.destination === 'SENT_TO_HOTEL' || balance.destination === 'GUEST_ROOM_BILL') &&
    dueAmount > 0.009
      ? dueAmount
      : 0

  return {
    paidAmount,
    dueAmount,
    restaurantDue,
    hotelBill,
    billingState: resolveOrderBillingState(order),
    billingDetail: formatOrderBillingDetail(order),
    billingStatus: formatOrderBillingState(resolveOrderBillingState(order)),
  }
}

export function computeRestaurantOrdersExportTotals(
  orders: RestaurantOrderExportRecord[]
): RestaurantOrdersExportTotals {
  return orders.reduce(
    (acc, order) => {
      const amounts = computeOrderExportAmounts(order)
      acc.orderCount += 1
      acc.subtotalSum += order.subtotal ?? 0
      acc.discountSum += order.discount ?? 0
      acc.vatSum += order.vatAmount ?? 0
      acc.totalSum += order.totalAmount ?? 0
      acc.paidAtRestaurantSum += amounts.paidAmount
      acc.restaurantDueSum += amounts.restaurantDue
      acc.hotelBillSum += amounts.hotelBill
      return acc
    },
    {
      orderCount: 0,
      subtotalSum: 0,
      discountSum: 0,
      vatSum: 0,
      totalSum: 0,
      paidAtRestaurantSum: 0,
      restaurantDueSum: 0,
      hotelBillSum: 0,
    }
  )
}

function mapOrderRow(order: RestaurantOrderExportRecord): Record<string, string | number> {
  const at = new Date(order.createdAt)
  const amounts = computeOrderExportAmounts(order)

  return {
    'Order #': order.orderNumber,
    'Date & Time': format(at, 'dd MMM yyyy, HH:mm'),
    Type: ORDER_TYPE_LABELS[order.orderType] ?? order.orderType,
    Location: locationLabel(order),
    Status: STATUS_LABELS[order.status] ?? order.status,
    Items: itemsSummary(order),
    Subtotal: order.subtotal ?? 0,
    Discount: order.discount ?? 0,
    VAT: order.vatAmount ?? 0,
    'Order Total': order.totalAmount,
    'Restaurant Received': amounts.paidAmount,
    'Restaurant Due': amounts.restaurantDue,
    'Hotel / Room Bill': amounts.hotelBill,
    'Billing Status': amounts.billingStatus,
    'Billing Detail': amounts.billingDetail,
    Payments: paymentsSummary(order),
    Notes: order.notes?.trim() || '—',
  }
}

export function restaurantOrdersExportFileName(ext: 'pdf' | 'xlsx'): string {
  return `restaurant-orders-billing-${format(new Date(), 'yyyy-MM-dd-HHmm')}.${ext}`
}

export function buildRestaurantOrdersExportQuery(
  filters: {
    status?: string
    orderType?: string
    dateFrom?: string
    dateTo?: string
    sort?: string
  },
  limit = 5000
): string {
  const params = new URLSearchParams()
  params.set('page', '1')
  params.set('limit', String(limit))
  if (filters.status && filters.status !== 'ALL') {
    params.set('status', filters.status)
  }
  if (filters.orderType && filters.orderType !== 'all') {
    params.set('orderType', filters.orderType)
  }
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  if (filters.sort) params.set('sort', filters.sort)
  return `/restaurant-orders?${params.toString()}`
}

async function loadExportLogo(): Promise<{ dataUrl: string; base64: string } | null> {
  try {
    const dataUrl = await getLogoDataUrl()
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    return { dataUrl, base64 }
  } catch {
    return null
  }
}

function resolveExportFilters(meta: RestaurantOrdersExportMeta) {
  return {
    date: formatBookingDateFilterLabel(
      meta.datePreset ?? 'today',
      meta.customDateFrom,
      meta.customDateTo
    ),
    type:
      !meta.orderType || meta.orderType === 'all'
        ? 'All types'
        : ORDER_TYPE_LABELS[meta.orderType] ?? meta.orderType,
    status:
      !meta.status || meta.status === 'ALL'
        ? 'All statuses'
        : STATUS_LABELS[meta.status] ?? meta.status,
    sort: meta.sort === 'oldest' ? 'Oldest first' : 'Newest first',
    search: meta.search?.trim() ? meta.search.trim() : '—',
  }
}

function downloadBlob(buffer: ArrayBuffer, fileName: string, mime: string) {
  const blob = new Blob([buffer], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function buildExcelTotalsRow(totals: RestaurantOrdersExportTotals): (string | number)[] {
  return [
    'Grand Total',
    '',
    '',
    '',
    '',
    `${totals.orderCount} orders`,
    totals.subtotalSum,
    totals.discountSum,
    totals.vatSum,
    totals.totalSum,
    totals.paidAtRestaurantSum,
    totals.restaurantDueSum,
    totals.hotelBillSum,
    '',
    '',
    '',
    '',
  ]
}

export async function downloadRestaurantOrdersExcel(
  orders: RestaurantOrderExportRecord[],
  meta: RestaurantOrdersExportMeta = {}
): Promise<void> {
  if (!orders.length) {
    throw new Error('No orders to export')
  }

  const rows = orders.map(mapOrderRow)
  const totals = computeRestaurantOrdersExportTotals(orders)
  const exportedAt = meta.exportedAt ?? new Date()
  const filters = resolveExportFilters(meta)
  const headers = [...EXPORT_HEADERS]
  const logo = await loadExportLogo()

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Restaurant Orders')
  let row = 1

  sheet.getRow(1).height = 22
  sheet.getRow(2).height = 18

  const colCount = headers.length
  const logoColSpan = 1.6
  const textColSpan = 6
  const headerBlockCols = logo ? logoColSpan + textColSpan : colCount
  const headerStartCol0 = logo ? Math.max(0, (colCount - headerBlockCols) / 2) : 0
  const textStartCol = logo ? Math.floor(headerStartCol0 + logoColSpan) + 1 : 1
  const textEndCol = logo
    ? Math.min(colCount, Math.max(textStartCol, Math.ceil(headerStartCol0 + logoColSpan + textColSpan)))
    : colCount

  if (logo) {
    const imageId = workbook.addImage({ base64: logo.base64, extension: 'png' })
    sheet.addImage(imageId, {
      tl: { col: headerStartCol0 + 0.05, row: 0.08 },
      ext: { width: 44, height: 44 },
    })
  }

  if (textEndCol >= textStartCol) {
    sheet.mergeCells(1, textStartCol, 1, textEndCol)
    sheet.mergeCells(2, textStartCol, 2, textEndCol)
  }

  const hotelCell = sheet.getCell(1, textStartCol)
  hotelCell.value = HOTEL_NAME
  hotelCell.font = { bold: true, size: 16 }
  hotelCell.alignment = { horizontal: logo ? 'left' : 'center', vertical: 'middle' }

  const titleCell = sheet.getCell(2, textStartCol)
  titleCell.value = 'Restaurant Orders & Billing Report'
  titleCell.font = { bold: true, size: 12 }
  titleCell.alignment = { horizontal: logo ? 'left' : 'center', vertical: 'middle' }

  row = 3

  const infoRows: [string, string | number][] = [
    ['Generated by', formatGeneratedBy(meta.generatedBy)],
    ['Exported', format(exportedAt, 'dd MMM yyyy, HH:mm')],
    ['Date range', filters.date],
    ['Order type', filters.type],
    ['Status', filters.status],
    ['Sort', filters.sort],
    ['Search', filters.search],
    ['Total orders', orders.length],
    ['Order value (BDT)', totals.totalSum],
    ['Restaurant received (BDT)', totals.paidAtRestaurantSum],
    ['Restaurant due (BDT)', totals.restaurantDueSum],
    ['Hotel / room bill (BDT)', totals.hotelBillSum],
  ]

  for (const [label, value] of infoRows) {
    sheet.getCell(row, 1).value = label
    sheet.getCell(row, 1).font = { bold: true }
    sheet.getCell(row, 2).value = value
    row += 1
  }

  row += 1
  headers.forEach((header, index) => {
    const cell = sheet.getCell(row, index + 1)
    cell.value = header
    cell.font = { bold: true }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF5F5F5' },
    }
  })
  row += 1

  for (const dataRow of rows) {
    headers.forEach((header, index) => {
      sheet.getCell(row, index + 1).value = dataRow[header] ?? ''
    })
    row += 1
  }

  const totalsRow = buildExcelTotalsRow(totals)
  totalsRow.forEach((value, index) => {
    const cell = sheet.getCell(row, index + 1)
    cell.value = value
    cell.font = { bold: true }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFFBEB' },
    }
  })

  headers.forEach((header, index) => {
    const col = sheet.getColumn(index + 1)
    col.width = Math.min(
      42,
      Math.max(
        header.length + 2,
        ...rows.map((r) => String(r[header] ?? '').length + 2)
      )
    )
  })

  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(
    buffer as ArrayBuffer,
    restaurantOrdersExportFileName('xlsx'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
}

export async function downloadRestaurantOrdersPdf(
  orders: RestaurantOrderExportRecord[],
  meta: RestaurantOrdersExportMeta = {}
): Promise<void> {
  if (!orders.length) {
    throw new Error('No orders to export')
  }

  const logo = await loadExportLogo()
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const marginX = 8
  const marginTop = 8
  const marginBottom = 8
  let y = marginTop

  const exportedAt = meta.exportedAt ?? new Date()
  const filters = resolveExportFilters(meta)
  const totals = computeRestaurantOrdersExportTotals(orders)

  const logoSize = 11
  const headerY = marginTop
  const headerGap = 3

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  const nameWidth = pdf.getTextWidth(HOTEL_NAME)
  pdf.setFontSize(11)
  const subtitleWidth = pdf.getTextWidth('Restaurant Orders & Billing Report')
  const textWidth = Math.max(nameWidth, subtitleWidth)
  const blockWidth = (logo ? logoSize + headerGap : 0) + textWidth
  const blockStartX = (pageWidth - blockWidth) / 2

  if (logo) {
    pdf.addImage(logo.dataUrl, 'PNG', blockStartX, headerY, logoSize, logoSize)
  }

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  if (logo) {
    pdf.text(HOTEL_NAME, blockStartX + logoSize + headerGap, headerY + 4.5)
    pdf.setFontSize(11)
    pdf.text('Restaurant Orders & Billing Report', blockStartX + logoSize + headerGap, headerY + 9)
  } else {
    pdf.text(HOTEL_NAME, pageWidth / 2, headerY + 5, { align: 'center' })
    pdf.setFontSize(11)
    pdf.text('Restaurant Orders & Billing Report', pageWidth / 2, headerY + 10, { align: 'center' })
  }

  y = headerY + (logo ? logoSize : 12) + 3

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7)
  pdf.text(`Exported: ${format(exportedAt, 'dd MMM yyyy, HH:mm')}`, marginX, y)
  y += 3.5
  pdf.text(`Generated by: ${formatGeneratedBy(meta.generatedBy)}`, marginX, y)
  y += 3.5
  pdf.text(`Date range: ${filters.date}  |  Type: ${filters.type}  |  Status: ${filters.status}`, marginX, y)
  y += 3.5
  pdf.text(
    `Orders: ${orders.length}  |  Total: ${formatBdtForPdf(totals.totalSum)}  |  Received: ${formatBdtForPdf(totals.paidAtRestaurantSum)}  |  Restaurant due: ${formatBdtForPdf(totals.restaurantDueSum)}  |  Hotel/Room bill: ${formatBdtForPdf(totals.hotelBillSum)}`,
    marginX,
    y
  )
  y += 5

  const tableWidth = pageWidth - marginX * 2
  const columnDefs: Omit<PdfColumn, 'width'>[] = [
    { header: 'Order #', baseWidth: 28, value: (r) => r['Order #'] },
    { header: 'Date', baseWidth: 22, value: (r) => r['Date & Time'] },
    { header: 'Type', baseWidth: 16, value: (r) => r.Type },
    { header: 'Location', baseWidth: 18, value: (r) => r.Location },
    { header: 'Status', baseWidth: 14, value: (r) => r.Status },
    { header: 'Total', baseWidth: 18, value: (r) => formatBdtForPdf(Number(r['Order Total'])), align: 'right' },
    {
      header: 'Received',
      baseWidth: 18,
      value: (r) => formatBdtForPdf(Number(r['Restaurant Received'])),
      align: 'right',
    },
    {
      header: 'Rest. Due',
      baseWidth: 16,
      value: (r) => formatBdtForPdf(Number(r['Restaurant Due'])),
      align: 'right',
    },
    {
      header: 'Hotel Bill',
      baseWidth: 16,
      value: (r) => formatBdtForPdf(Number(r['Hotel / Room Bill'])),
      align: 'right',
    },
    { header: 'Billing', baseWidth: 24, value: (r) => r['Billing Detail'] },
    { header: 'Items', baseWidth: 30, value: (r) => r.Items },
  ]

  const baseWidthSum = columnDefs.reduce((sum, col) => sum + col.baseWidth, 0)
  const columns: PdfColumn[] = columnDefs.map((col) => ({
    ...col,
    width: (col.baseWidth / baseWidthSum) * tableWidth,
  }))

  const rows = orders.map(mapOrderRow)

  const columnLeftX = (index: number) => {
    let x = marginX
    for (let i = 0; i < index; i++) x += columns[i].width
    return x
  }

  const columnRightX = (index: number) => columnLeftX(index) + columns[index].width - PDF_CELL_PAD

  const drawRightAlignedInColumn = (text: string, colIndex: number, baselineY: number) => {
    const rightX = columnRightX(colIndex)
    pdf.text(text, rightX - pdf.getTextWidth(text), baselineY)
  }

  const totalColIndex = columns.findIndex((col) => col.header === 'Total')
  const receivedColIndex = columns.findIndex((col) => col.header === 'Received')
  const restDueColIndex = columns.findIndex((col) => col.header === 'Rest. Due')
  const hotelColIndex = columns.findIndex((col) => col.header === 'Hotel Bill')

  const drawHeader = () => {
    pdf.setFillColor(245, 245, 245)
    pdf.rect(marginX, y - 4, tableWidth, 6.5, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(6)
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]
      if (col.align === 'right') {
        drawRightAlignedInColumn(col.header, i, y)
      } else {
        pdf.text(col.header, columnLeftX(i) + PDF_CELL_PAD, y)
      }
    }
    y += 6.5
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(5.5)
  }

  drawHeader()

  for (const row of rows) {
    const stringRow = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, String(value)])
    ) as Record<string, string>

    const lines = columns.map((col, index) => {
      const value = col.value(stringRow)
      if (col.align === 'right') return [value]
      return pdf.splitTextToSize(value, Math.max(columns[index].width - PDF_CELL_PAD * 2, 6))
    })
    const maxLines = Math.max(...lines.map((l) => l.length), 1)
    const rowHeight = maxLines * PDF_LINE_HEIGHT + 1.2

    if (y + rowHeight > pageHeight - marginBottom - 8) {
      pdf.addPage()
      y = marginTop
      drawHeader()
    }

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]
      if (col.align === 'right') {
        drawRightAlignedInColumn(lines[i][0] ?? '', i, y)
      } else {
        pdf.text(lines[i], columnLeftX(i) + PDF_CELL_PAD, y)
      }
    }
    y += rowHeight
  }

  const totalsRowHeight = PDF_LINE_HEIGHT + 3
  if (y + totalsRowHeight > pageHeight - marginBottom) {
    pdf.addPage()
    y = marginTop
    drawHeader()
  }

  y += 1.5
  pdf.setFillColor(255, 251, 235)
  pdf.rect(marginX, y - 3.5, tableWidth, totalsRowHeight + 1, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(6)
  pdf.text('Grand Total', columnLeftX(0) + PDF_CELL_PAD, y)
  drawRightAlignedInColumn(formatBdtForPdf(totals.totalSum), totalColIndex, y)
  drawRightAlignedInColumn(formatBdtForPdf(totals.paidAtRestaurantSum), receivedColIndex, y)
  drawRightAlignedInColumn(formatBdtForPdf(totals.restaurantDueSum), restDueColIndex, y)
  drawRightAlignedInColumn(formatBdtForPdf(totals.hotelBillSum), hotelColIndex, y)

  pdf.save(restaurantOrdersExportFileName('pdf'))
}
