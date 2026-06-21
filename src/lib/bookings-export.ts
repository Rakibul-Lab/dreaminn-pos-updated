import { format } from 'date-fns'
import { jsPDF } from 'jspdf'
import ExcelJS from 'exceljs'
import { formatConfirmationNumber } from './confirmation-number'
import {
  formatListBookingCheckIn,
  formatListBookingCheckOut,
  type HotelTimes,
} from './hotel-times'
import { HOTEL_NAME } from './reservation-terms'
import { formatBdtForPdf } from './currency'
import type { BookingsExportFilterLabels } from './booking-date-filter'
import { getBookingSourceLabel } from './booking-company'
import { formatBookingListDiscount } from './booking-discount'
import { computeBookingDisplayVat } from './booking-totals'
import { resolveBookingRegistrationNumber } from './booking-registration'
import { getLogoDataUrl } from './reservation-document-html'

export type BookingExportRecord = {
  id: string
  confirmationNumber?: string | null
  status: string
  company?: string | null
  companyLedgerId?: string | null
  companyLedger?: { name: string } | null
  isInitialReservation?: boolean
  checkIn: string
  checkOut: string
  actualCheckIn?: string | null
  actualCheckOut?: string | null
  totalRoomCharge: number
  advancePayment: number
  dueAmount: number
  discountEnabled?: boolean | null
  discountType?: string | null
  discountValue?: number | null
  discountAmount?: number | null
  vatApplied?: boolean | null
  vatPercent?: number
  vatAmount?: number
  serviceChargePercent?: number | null
  totalWithVat?: number
  createdAt?: string
  customer: {
    name: string
    phone: string
    email?: string | null
    registrationNumber?: string | null
  }
  companyLedgerGuest?: { registrationNumber?: string | null } | null
  room: { roomNumber: string; type: { name: string } }
}

export type BookingsExportMeta = {
  filters?: BookingsExportFilterLabels
  /** @deprecated Use filters — kept for backwards compatibility */
  filterSummary?: string
  exportedAt?: Date
  generatedBy?: {
    name: string
    email?: string
    role?: string
  }
}

function resolveExportFilters(meta: BookingsExportMeta): BookingsExportFilterLabels {
  if (meta.filters) return meta.filters
  return {
    date: 'All dates',
    status: 'All status',
    search: meta.filterSummary && meta.filterSummary !== 'All reservations' ? meta.filterSummary : '—',
  }
}

function formatGeneratedBy(user?: BookingsExportMeta['generatedBy']): string {
  if (!user?.name) return '—'
  if (user.email) return `${user.name} (${user.email})`
  return user.name
}

function bookingStatusLabel(booking: BookingExportRecord): string {
  if (booking.isInitialReservation && booking.status === 'RESERVED') {
    return 'Reserved (N.D)'
  }
  return booking.status.replace(/_/g, ' ')
}

function computeBookingExportTotals(bookings: BookingExportRecord[]) {
  return bookings.reduce(
    (acc, b) => ({
      totalSum: acc.totalSum + (b.totalWithVat ?? b.totalRoomCharge),
      dueSum: acc.dueSum + (b.dueAmount ?? 0),
    }),
    { totalSum: 0, dueSum: 0 }
  )
}

function buildExcelTotalsRow(
  headers: string[],
  totals: { totalSum: number; dueSum: number }
): (string | number)[] {
  return headers.map((h, i) => {
    if (h === 'Total (incl. VAT)') return totals.totalSum
    if (h === 'Due (incl. VAT)') return totals.dueSum
    if (i === 0) return 'Grand Total'
    return ''
  })
}

export function mapBookingToExportRow(
  booking: BookingExportRecord,
  times: HotelTimes
): Record<string, string | number> {
  const vat = computeBookingDisplayVat(booking)
  const discount = formatBookingListDiscount(booking)
  return {
    'Confirmation No.': formatConfirmationNumber(booking),
    Guest: booking.customer?.name ?? '',
    Phone: booking.customer?.phone ?? '',
    Email: booking.customer?.email ?? '',
    Room: booking.room?.roomNumber ?? '',
    'Room Type': booking.room?.type?.name ?? '',
    'Check-in': formatListBookingCheckIn(booking, times),
    'Check-out': formatListBookingCheckOut(booking, times),
    Booking: bookingStatusLabel(booking),
    Company: getBookingSourceLabel(booking),
    'Reg. No.': resolveBookingRegistrationNumber(booking) || '',
    Discount: discount.amount > 0 ? discount.amount : '',
    'Discount type': discount.amount > 0 ? discount.label : '',
    'Total (incl. VAT)': booking.totalWithVat ?? booking.totalRoomCharge,
    'VAT %': vat.percent,
    'VAT Amount': vat.amount,
    'Advance Paid': booking.advancePayment,
    'Due (incl. VAT)': booking.dueAmount,
    'Created At': booking.createdAt
      ? format(new Date(booking.createdAt), 'dd/MM/yyyy HH:mm')
      : '',
  }
}

export function bookingsExportFileName(ext: 'xlsx' | 'pdf'): string {
  const stamp = format(new Date(), 'yyyy-MM-dd-HHmm')
  return `reservations-${stamp}.${ext}`
}

async function loadExportLogo(): Promise<{ dataUrl: string; base64: string } | null> {
  try {
    const dataUrl = await getLogoDataUrl()
    const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1]! : dataUrl
    return { dataUrl, base64 }
  } catch {
    return null
  }
}

function triggerBrowserDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function downloadBookingsExcel(
  bookings: BookingExportRecord[],
  times: HotelTimes,
  meta: BookingsExportMeta = {}
): Promise<void> {
  if (!bookings.length) {
    throw new Error('No reservations to export')
  }
  const rows = bookings.map((b) => mapBookingToExportRow(b, times))
  const headers = Object.keys(rows[0])
  const exportedAt = meta.exportedAt ?? new Date()
  const totals = computeBookingExportTotals(bookings)
  const filters = resolveExportFilters(meta)
  const colCount = headers.length
  const logo = await loadExportLogo()

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Reservations')
  let row = 1

  sheet.getRow(1).height = 22
  sheet.getRow(2).height = 18

  const logoColSpan = 1.6
  const textColSpan = 5.5
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
  titleCell.value = 'Reservations Report'
  titleCell.font = { bold: true, size: 12 }
  titleCell.alignment = { horizontal: logo ? 'left' : 'center', vertical: 'middle' }

  row = 3

  const infoRows: [string, string | number][] = [
    ['Generated by', formatGeneratedBy(meta.generatedBy)],
    ['Exported', format(exportedAt, 'dd MMM yyyy, HH:mm')],
    ['Date', filters.date],
    ['Status', filters.status],
    ['Search', filters.search],
    ['Total records', bookings.length],
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
  })
  row += 1

  for (const dataRow of rows) {
    headers.forEach((header, index) => {
      sheet.getCell(row, index + 1).value = dataRow[header] ?? ''
    })
    row += 1
  }

  const totalsRow = buildExcelTotalsRow(headers, totals)
  totalsRow.forEach((value, index) => {
    const cell = sheet.getCell(row, index + 1)
    cell.value = value
    cell.font = { bold: true }
  })

  headers.forEach((_, index) => {
    sheet.getColumn(index + 1).width = Math.max(14, headers[index]?.length ?? 10)
  })

  const buffer = await workbook.xlsx.writeBuffer()
  triggerBrowserDownload(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    bookingsExportFileName('xlsx')
  )
}

type PdfColumn = {
  header: string
  width: number
  value: (booking: BookingExportRecord, times: HotelTimes) => string
}

const PDF_COLUMNS: PdfColumn[] = [
  {
    header: 'Confirmation',
    width: 30,
    value: (b) => formatConfirmationNumber(b),
  },
  { header: 'Guest', width: 34, value: (b) => b.customer?.name ?? '' },
  { header: 'Phone', width: 26, value: (b) => b.customer?.phone ?? '' },
  { header: 'Room', width: 14, value: (b) => b.room?.roomNumber ?? '' },
  {
    header: 'Check-in',
    width: 36,
    value: (b, t) => formatListBookingCheckIn(b, t),
  },
  {
    header: 'Check-out',
    width: 36,
    value: (b, t) => formatListBookingCheckOut(b, t),
  },
  {
    header: 'Booking',
    width: 22,
    value: (b) => bookingStatusLabel(b),
  },
  {
    header: 'Company',
    width: 24,
    value: (b) => getBookingSourceLabel(b),
  },
  {
    header: 'Reg. No.',
    width: 22,
    value: (b) => resolveBookingRegistrationNumber(b) || '—',
  },
  {
    header: 'Discount',
    width: 18,
    value: (b) => {
      const discount = formatBookingListDiscount(b)
      return discount.amount > 0 ? formatBdtForPdf(discount.amount) : '—'
    },
  },
  {
    header: 'Total',
    width: 22,
    value: (b) => formatBdtForPdf(b.totalWithVat ?? b.totalRoomCharge),
  },
  { header: 'Due', width: 18, value: (b) => formatBdtForPdf(b.dueAmount) },
]

const PDF_TOTAL_COL_INDEX = PDF_COLUMNS.findIndex((c) => c.header === 'Total')
const PDF_DUE_COL_INDEX = PDF_COLUMNS.findIndex((c) => c.header === 'Due')

const PDF_LINE_HEIGHT = 3.6
const PDF_CELL_PAD = 1.5

function splitCellLines(pdf: jsPDF, text: string, colWidth: number): string[] {
  const content = (text || '—').trim() || '—'
  return pdf.splitTextToSize(content, Math.max(colWidth - PDF_CELL_PAD * 2, 8))
}

export async function downloadBookingsPdf(
  bookings: BookingExportRecord[],
  times: HotelTimes,
  meta: BookingsExportMeta = {}
): Promise<void> {
  if (!bookings.length) {
    throw new Error('No reservations to export')
  }

  const logo = await loadExportLogo()
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const marginX = 10
  const marginTop = 10
  const marginBottom = 10
  const headerRowHeight = 7
  let y = marginTop

  const exportedAt = meta.exportedAt ?? new Date()
  const filters = resolveExportFilters(meta)

  const logoSize = 12
  const headerY = marginTop
  const headerGap = 4

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  const nameWidth = pdf.getTextWidth(HOTEL_NAME)
  pdf.setFontSize(12)
  const subtitleWidth = pdf.getTextWidth('Reservations Report')
  const textWidth = Math.max(nameWidth, subtitleWidth)
  const blockWidth = (logo ? logoSize + headerGap : 0) + textWidth
  const blockStartX = (pageWidth - blockWidth) / 2

  if (logo) {
    pdf.addImage(logo.dataUrl, 'PNG', blockStartX, headerY, logoSize, logoSize)
  }

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  if (logo) {
    pdf.text(HOTEL_NAME, blockStartX + logoSize + headerGap, headerY + 5)
    pdf.setFontSize(12)
    pdf.text('Reservations Report', blockStartX + logoSize + headerGap, headerY + 10)
  } else {
    pdf.text(HOTEL_NAME, pageWidth / 2, headerY + 7, { align: 'center' })
    pdf.setFontSize(12)
    pdf.text('Reservations Report', pageWidth / 2, headerY + 14, { align: 'center' })
  }

  y = headerY + (logo ? logoSize : 14) + 4

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.text(`Exported: ${format(exportedAt, 'dd MMM yyyy, HH:mm')}`, marginX, y)
  y += 4
  pdf.text(`Generated by: ${formatGeneratedBy(meta.generatedBy)}`, marginX, y)
  y += 4
  pdf.text(`Date: ${filters.date}`, marginX, y)
  y += 4
  pdf.text(`Status: ${filters.status}`, marginX, y)
  y += 4
  pdf.text(`Search: ${filters.search}`, marginX, y)
  y += 4
  pdf.text(`Total records: ${bookings.length}`, marginX, y)
  y += 6

  const drawTableHeader = () => {
    pdf.setFillColor(245, 245, 245)
    pdf.rect(marginX, y - 4.5, pageWidth - marginX * 2, headerRowHeight, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7)
    let x = marginX + PDF_CELL_PAD
    for (const col of PDF_COLUMNS) {
      const headerLines = splitCellLines(pdf, col.header, col.width)
      pdf.text(headerLines, x, y)
      x += col.width
    }
    y += headerRowHeight
  }

  drawTableHeader()

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(6.5)

  for (const booking of bookings) {
    const cellLines = PDF_COLUMNS.map((col) =>
      splitCellLines(pdf, col.value(booking, times), col.width)
    )
    const maxLines = Math.max(...cellLines.map((lines) => lines.length), 1)
    const rowHeight = maxLines * PDF_LINE_HEIGHT + 1.5

    if (y + rowHeight > pageHeight - marginBottom) {
      pdf.addPage()
      y = marginTop
      drawTableHeader()
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(6.5)
    }

    let x = marginX + PDF_CELL_PAD
    for (let i = 0; i < PDF_COLUMNS.length; i++) {
      pdf.text(cellLines[i], x, y)
      x += PDF_COLUMNS[i].width
    }
    y += rowHeight
  }

  const totals = computeBookingExportTotals(bookings)
  const totalsRowHeight = PDF_LINE_HEIGHT + 3

  if (y + totalsRowHeight > pageHeight - marginBottom) {
    pdf.addPage()
    y = marginTop
  }

  pdf.setFillColor(235, 235, 235)
  pdf.rect(marginX, y - 4, pageWidth - marginX * 2, totalsRowHeight + 1, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(7)

  pdf.text('Grand Total', marginX + PDF_CELL_PAD, y)

  let totalX = marginX + PDF_CELL_PAD
  for (let i = 0; i < PDF_TOTAL_COL_INDEX; i++) {
    totalX += PDF_COLUMNS[i].width
  }
  pdf.text(formatBdtForPdf(totals.totalSum), totalX, y)

  let dueX = totalX
  for (let i = PDF_TOTAL_COL_INDEX; i < PDF_DUE_COL_INDEX; i++) {
    dueX += PDF_COLUMNS[i].width
  }
  pdf.text(formatBdtForPdf(totals.dueSum), dueX, y)

  pdf.save(bookingsExportFileName('pdf'))
}

export function buildBookingsExportQuery(
  filters: {
    status?: string
    search?: string
    dateFrom?: string
    dateTo?: string
  },
  limit = 5000
): string {
  const params = new URLSearchParams()
  params.set('page', '1')
  params.set('limit', String(limit))
  if (filters.status && filters.status !== 'all') params.set('status', filters.status)
  if (filters.search) params.set('search', filters.search)
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  return `/bookings?${params.toString()}`
}
