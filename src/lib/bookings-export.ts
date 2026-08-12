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
import { formatGuestId, idTypeLabel } from './id-type-label'

export type BookingExportCompanion = {
  name: string
  companionType?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  nationality?: string | null
  idType?: string | null
  idNumber?: string | null
  visaExpiryDate?: string | null
  registrationNumber?: string | null
  company?: string | null
  designation?: string | null
}

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
  adults?: number
  children?: number
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
  recordType?: string
  customer: {
    name: string
    phone: string
    email?: string | null
    address?: string | null
    nationality?: string | null
    idType?: string | null
    idNumber?: string | null
    visaExpiryDate?: string | null
    registrationNumber?: string | null
    company?: string | null
    designation?: string | null
  }
  companions?: BookingExportCompanion[] | null
  companyLedgerGuest?: { registrationNumber?: string | null } | null
  room: { roomNumber: string; type: { name: string } }
}

export type BookingGuestExportRow = {
  booking: BookingExportRecord
  guestRole: 'Primary' | 'Companion'
  guestName: string
  guestPhone: string
  guestEmail: string
  guestAddress: string
  guestNationality: string
  guestIdType: string
  guestIdNumber: string
  guestIdDisplay: string
  guestVisaExpiry: string
  guestCompany: string
  guestDesignation: string
  guestRegNo: string
  /** Financial columns only on the primary guest row to avoid double-counting. */
  includeFinancials: boolean
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

function isExportableBooking(booking: BookingExportRecord): boolean {
  if (booking.recordType === 'reservation_entry') return false
  return Boolean(booking.customer?.name && booking.room?.roomNumber)
}

/** One export row per guest (primary + companions), each carrying the booking room number. */
export function expandBookingsToGuestRows(
  bookings: BookingExportRecord[]
): BookingGuestExportRow[] {
  const rows: BookingGuestExportRow[] = []

  for (const booking of bookings) {
    if (!isExportableBooking(booking)) continue

    const primaryReg =
      resolveBookingRegistrationNumber(booking) ||
      booking.customer.registrationNumber?.trim() ||
      ''

    rows.push({
      booking,
      guestRole: 'Primary',
      guestName: booking.customer.name?.trim() || '',
      guestPhone: booking.customer.phone?.trim() || '',
      guestEmail: booking.customer.email?.trim() || '',
      guestAddress: booking.customer.address?.trim() || '',
      guestNationality: booking.customer.nationality?.trim() || '',
      guestIdType: idTypeLabel(booking.customer.idType),
      guestIdNumber: booking.customer.idNumber?.trim() || '',
      guestIdDisplay: formatGuestId(booking.customer.idType, booking.customer.idNumber),
      guestVisaExpiry: booking.customer.visaExpiryDate?.trim() || '',
      guestCompany: booking.customer.company?.trim() || '',
      guestDesignation: booking.customer.designation?.trim() || '',
      guestRegNo: primaryReg,
      includeFinancials: true,
    })

    const companions = [...(booking.companions ?? [])]
      .filter((c) => c?.name?.trim())
      .sort((a, b) => {
        const aChild = a.companionType === 'CHILD' ? 1 : 0
        const bChild = b.companionType === 'CHILD' ? 1 : 0
        return aChild - bChild
      })

    for (const companion of companions) {
      rows.push({
        booking,
        guestRole: 'Companion',
        guestName: companion.name.trim(),
        guestPhone: companion.phone?.trim() || '',
        guestEmail: companion.email?.trim() || '',
        guestAddress: companion.address?.trim() || '',
        guestNationality: companion.nationality?.trim() || '',
        guestIdType: idTypeLabel(companion.idType),
        guestIdNumber: companion.idNumber?.trim() || '',
        guestIdDisplay: formatGuestId(companion.idType, companion.idNumber),
        guestVisaExpiry: companion.visaExpiryDate?.trim() || '',
        guestCompany: companion.company?.trim() || '',
        guestDesignation: companion.designation?.trim() || '',
        guestRegNo: companion.registrationNumber?.trim() || '',
        includeFinancials: false,
      })
    }
  }

  return rows
}

export function mapBookingGuestToExportRow(
  row: BookingGuestExportRow,
  times: HotelTimes
): Record<string, string | number> {
  const { booking } = row
  const vat = computeBookingDisplayVat(booking)
  const discount = formatBookingListDiscount(booking)
  const financial = row.includeFinancials

  return {
    'Confirmation No.': formatConfirmationNumber(booking),
    Room: financial ? booking.room?.roomNumber ?? '' : '',
    'Room Type': financial ? booking.room?.type?.name ?? '' : '',
    Guest: row.guestName,
    Phone: row.guestPhone,
    Email: row.guestEmail,
    'Check-in': financial ? formatListBookingCheckIn(booking, times) : '',
    'Check-out': financial ? formatListBookingCheckOut(booking, times) : '',
    Booking: financial ? bookingStatusLabel(booking) : '',
    Company: financial ? getBookingSourceLabel(booking) : '',
    'Reg. No.': row.guestRegNo,
    Discount: financial && discount.amount > 0 ? discount.amount : '',
    'Discount type': financial && discount.amount > 0 ? discount.label : '',
    'Total (incl. VAT)': financial ? booking.totalWithVat ?? booking.totalRoomCharge : '',
    'VAT %': financial ? vat.percent : '',
    'VAT Amount': financial ? vat.amount : '',
    'Advance Paid': financial ? booking.advancePayment : '',
    'Due (incl. VAT)': financial ? booking.dueAmount : '',
    'Created At':
      financial && booking.createdAt
        ? format(new Date(booking.createdAt), 'dd/MM/yyyy HH:mm')
        : '',
  }
}

/** @deprecated Prefer expandBookingsToGuestRows + mapBookingGuestToExportRow */
export function mapBookingToExportRow(
  booking: BookingExportRecord,
  times: HotelTimes
): Record<string, string | number> {
  const [row] = expandBookingsToGuestRows([booking])
  if (!row) {
    return {
      'Confirmation No.': formatConfirmationNumber(booking),
      Guest: booking.customer?.name ?? '',
      Phone: booking.customer?.phone ?? '',
      Room: booking.room?.roomNumber ?? '',
    }
  }
  return mapBookingGuestToExportRow(row, times)
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
  const exportBookings = bookings.filter(isExportableBooking)
  const guestRows = expandBookingsToGuestRows(exportBookings)
  if (!guestRows.length) {
    throw new Error('No reservations to export')
  }
  const rows = guestRows.map((row) => mapBookingGuestToExportRow(row, times))
  const headers = Object.keys(rows[0])
  const exportedAt = meta.exportedAt ?? new Date()
  const totals = computeBookingExportTotals(exportBookings)
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
    ['Reservations', exportBookings.length],
    ['Guest rows', guestRows.length],
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
  value: (row: BookingGuestExportRow, times: HotelTimes) => string
}

const PDF_COLUMNS: PdfColumn[] = [
  {
    header: 'Confirmation No.',
    width: 18,
    value: (row) => formatConfirmationNumber(row.booking),
  },
  {
    header: 'Room',
    width: 10,
    value: (row) => (row.includeFinancials ? row.booking.room?.roomNumber ?? '' : ''),
  },
  {
    header: 'Room Type',
    width: 16,
    value: (row) => (row.includeFinancials ? row.booking.room?.type?.name ?? '' : ''),
  },
  { header: 'Guest', width: 22, value: (row) => row.guestName },
  { header: 'Phone', width: 16, value: (row) => row.guestPhone || '—' },
  { header: 'Email', width: 20, value: (row) => row.guestEmail || '—' },
  {
    header: 'Check-in',
    width: 18,
    value: (row, t) =>
      row.includeFinancials ? formatListBookingCheckIn(row.booking, t) : '',
  },
  {
    header: 'Check-out',
    width: 18,
    value: (row, t) =>
      row.includeFinancials ? formatListBookingCheckOut(row.booking, t) : '',
  },
  {
    header: 'Booking',
    width: 14,
    value: (row) => (row.includeFinancials ? bookingStatusLabel(row.booking) : ''),
  },
  {
    header: 'Company',
    width: 14,
    value: (row) => (row.includeFinancials ? getBookingSourceLabel(row.booking) : ''),
  },
  {
    header: 'Reg. No.',
    width: 12,
    value: (row) => row.guestRegNo || (row.includeFinancials ? '—' : ''),
  },
  {
    header: 'Discount',
    width: 12,
    value: (row) => {
      if (!row.includeFinancials) return ''
      const discount = formatBookingListDiscount(row.booking)
      return discount.amount > 0 ? formatBdtForPdf(discount.amount) : '—'
    },
  },
  {
    header: 'Discount type',
    width: 14,
    value: (row) => {
      if (!row.includeFinancials) return ''
      const discount = formatBookingListDiscount(row.booking)
      return discount.amount > 0 ? discount.label : '—'
    },
  },
  {
    header: 'Total (incl. VAT)',
    width: 16,
    value: (row) =>
      row.includeFinancials
        ? formatBdtForPdf(row.booking.totalWithVat ?? row.booking.totalRoomCharge)
        : '',
  },
  {
    header: 'VAT %',
    width: 10,
    value: (row) =>
      row.includeFinancials ? String(computeBookingDisplayVat(row.booking).percent) : '',
  },
  {
    header: 'VAT Amount',
    width: 12,
    value: (row) =>
      row.includeFinancials
        ? formatBdtForPdf(computeBookingDisplayVat(row.booking).amount)
        : '',
  },
  {
    header: 'Advance Paid',
    width: 12,
    value: (row) =>
      row.includeFinancials ? formatBdtForPdf(row.booking.advancePayment) : '',
  },
  {
    header: 'Due (incl. VAT)',
    width: 14,
    value: (row) =>
      row.includeFinancials ? formatBdtForPdf(row.booking.dueAmount) : '',
  },
  {
    header: 'Created At',
    width: 16,
    value: (row) =>
      row.includeFinancials && row.booking.createdAt
        ? format(new Date(row.booking.createdAt), 'dd/MM/yyyy HH:mm')
        : '',
  },
]

const PDF_TOTAL_COL_INDEX = PDF_COLUMNS.findIndex((c) => c.header === 'Total (incl. VAT)')
const PDF_DUE_COL_INDEX = PDF_COLUMNS.findIndex((c) => c.header === 'Due (incl. VAT)')

const PDF_LINE_HEIGHT = 3.6
const PDF_CELL_PAD = 1.5

function splitCellLines(pdf: jsPDF, text: string, colWidth: number): string[] {
  // Preserve intentional blanks (e.g. companion room cell) — do not force '—'.
  if (text === '') return ['']
  const content = text.trim() || '—'
  return pdf.splitTextToSize(content, Math.max(colWidth - PDF_CELL_PAD * 2, 8))
}

export async function downloadBookingsPdf(
  bookings: BookingExportRecord[],
  times: HotelTimes,
  meta: BookingsExportMeta = {}
): Promise<void> {
  const exportBookings = bookings.filter(isExportableBooking)
  const guestRows = expandBookingsToGuestRows(exportBookings)
  if (!guestRows.length) {
    throw new Error('No reservations to export')
  }

  const logo = await loadExportLogo()
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const marginX = 8
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
  pdf.text(
    `Reservations: ${exportBookings.length} · Guest rows: ${guestRows.length}`,
    marginX,
    y
  )
  y += 6

  const drawTableHeader = () => {
    pdf.setFillColor(245, 245, 245)
    pdf.rect(marginX, y - 4.5, pageWidth - marginX * 2, headerRowHeight, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(6.5)
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
  pdf.setFontSize(6)

  for (const guestRow of guestRows) {
    const cellLines = PDF_COLUMNS.map((col) =>
      splitCellLines(pdf, col.value(guestRow, times), col.width)
    )
    const maxLines = Math.max(...cellLines.map((lines) => lines.length), 1)
    const rowHeight = maxLines * PDF_LINE_HEIGHT + 1.5

    if (y + rowHeight > pageHeight - marginBottom) {
      pdf.addPage()
      y = marginTop
      drawTableHeader()
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(6)
    }

    let x = marginX + PDF_CELL_PAD
    for (let i = 0; i < PDF_COLUMNS.length; i++) {
      pdf.text(cellLines[i], x, y)
      x += PDF_COLUMNS[i].width
    }
    y += rowHeight
  }

  const totals = computeBookingExportTotals(exportBookings)
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
