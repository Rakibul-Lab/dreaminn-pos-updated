import { format } from 'date-fns'
import { jsPDF } from 'jspdf'
import { HOTEL_NAME } from './reservation-terms'
import { getLogoDataUrl } from './reservation-document-html'
import { formatBdtForPdf } from './currency'
import {
  formatPaymentLastFourDisplay,
  formatPaymentMethod,
  formatPaymentReferenceDisplay,
} from './payment-method'
import {
  formatBookingDateFilterLabel,
  type BookingDatePreset,
} from './booking-date-filter'

const AMOUNT_COL_INDEX = 4
const PDF_LINE_HEIGHT = 3.6
const PDF_CELL_PAD = 1.5

export type PaymentExportRecord = {
  id: string
  amount: number
  method: string
  paymentType: string
  settlementSource?: string | null
  reference?: string | null
  accountLastFour?: string | null
  notes?: string | null
  createdAt: string
  booking?: {
    customer?: { name: string }
    room?: { roomNumber: string }
  } | null
  order?: {
    orderNumber: string
    orderType: string
  } | null
  receiver?: { name: string } | null
}

export type PaymentsExportMeta = {
  exportedAt?: Date
  generatedBy?: { name: string; email?: string; role?: string }
  datePreset?: BookingDatePreset
  customDateFrom?: string
  customDateTo?: string
  paymentType?: string
  method?: string
}

function formatGeneratedBy(user?: PaymentsExportMeta['generatedBy']): string {
  if (!user?.name) return '—'
  if (user.email) return `${user.name} (${user.email})`
  return user.name
}

function formatRoom(payment: PaymentExportRecord): string {
  if (payment.booking?.room?.roomNumber) {
    return `Room ${payment.booking.room.roomNumber}`
  }
  return '—'
}

function mapPaymentRow(payment: PaymentExportRecord): Record<string, string> {
  const at = new Date(payment.createdAt)
  return {
    Date: format(at, 'dd MMM yyyy'),
    Time: format(at, 'HH:mm'),
    Type: payment.paymentType,
    Method: formatPaymentMethod(payment.method),
    Amount: formatBdtForPdf(payment.amount),
    Reference: formatPaymentReferenceDisplay(payment.method, payment.reference),
    'Last 4': formatPaymentLastFourDisplay(payment.method, payment.accountLastFour),
    Notes: payment.notes ?? '',
    Rooms: formatRoom(payment),
    'Received By': payment.receiver?.name ?? '—',
  }
}

export function paymentsExportFileName(): string {
  return `payments-${format(new Date(), 'yyyy-MM-dd-HHmm')}.pdf`
}

export function buildPaymentsExportQuery(
  filters: {
    paymentType?: string
    settlementSource?: string
    method?: string
    dateFrom?: string
    dateTo?: string
    search?: string
  },
  limit = 5000
): string {
  const params = new URLSearchParams()
  params.set('page', '1')
  params.set('limit', String(limit))
  if (filters.settlementSource && filters.settlementSource !== 'all') {
    params.set('settlementSource', filters.settlementSource)
  } else if (filters.paymentType && filters.paymentType !== 'all') {
    params.set('paymentType', filters.paymentType)
  }
  if (filters.method && filters.method !== 'all') {
    params.set('method', filters.method)
  }
  if (filters.search?.trim()) {
    params.set('search', filters.search.trim())
  } else {
    if (filters.dateFrom) params.set('startDate', filters.dateFrom)
    if (filters.dateTo) params.set('endDate', filters.dateTo)
  }
  return `/payments?${params.toString()}`
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

export async function downloadPaymentsPdf(
  payments: PaymentExportRecord[],
  meta: PaymentsExportMeta = {}
): Promise<void> {
  if (!payments.length) {
    throw new Error('No payments to export')
  }

  const logo = await loadExportLogo()
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const marginX = 10
  const marginTop = 10
  const marginBottom = 10
  let y = marginTop

  const exportedAt = meta.exportedAt ?? new Date()
  const dateLabel = formatBookingDateFilterLabel(
    meta.datePreset ?? 'all',
    meta.customDateFrom,
    meta.customDateTo
  )
  const typeLabel =
    !meta.paymentType || meta.paymentType === 'all' ? 'All types' : meta.paymentType
  const methodLabel =
    !meta.method || meta.method === 'all' ? 'All methods' : formatPaymentMethod(meta.method)

  const logoSize = 12
  const headerY = marginTop
  const headerGap = 4

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  const nameWidth = pdf.getTextWidth(HOTEL_NAME)
  pdf.setFontSize(12)
  const subtitleWidth = pdf.getTextWidth('Payments Report')
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
    pdf.text('Payments Report', blockStartX + logoSize + headerGap, headerY + 10)
  } else {
    pdf.text(HOTEL_NAME, pageWidth / 2, headerY + 7, { align: 'center' })
    pdf.setFontSize(12)
    pdf.text('Payments Report', pageWidth / 2, headerY + 14, { align: 'center' })
  }

  y = headerY + (logo ? logoSize : 14) + 4

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.text(`Exported: ${format(exportedAt, 'dd MMM yyyy, HH:mm')}`, marginX, y)
  y += 4
  pdf.text(`Generated by: ${formatGeneratedBy(meta.generatedBy)}`, marginX, y)
  y += 4
  pdf.text(`Date: ${dateLabel}`, marginX, y)
  y += 4
  pdf.text(`Type: ${typeLabel}  |  Method: ${methodLabel}`, marginX, y)
  y += 4
  pdf.text(`Total records: ${payments.length}`, marginX, y)
  y += 6

  const columns = [
    { header: 'Date', width: 20, value: (r: Record<string, string>) => r.Date },
    { header: 'Time', width: 12, value: (r: Record<string, string>) => r.Time },
    { header: 'Type', width: 18, value: (r: Record<string, string>) => r.Type },
    { header: 'Method', width: 20, value: (r: Record<string, string>) => r.Method },
    { header: 'Amount', width: 20, value: (r: Record<string, string>) => r.Amount, align: 'right' as const },
    { header: 'Reference', width: 26, value: (r: Record<string, string>) => r.Reference || '—' },
    { header: 'Last 4', width: 14, value: (r: Record<string, string>) => r['Last 4'] || '—' },
    { header: 'Notes', width: 28, value: (r: Record<string, string>) => r.Notes || '—' },
    { header: 'Rooms', width: 18, value: (r: Record<string, string>) => r.Rooms },
    { header: 'Received By', width: 24, value: (r: Record<string, string>) => r['Received By'] },
  ]

  const rows = payments.map(mapPaymentRow)
  const totalAmount = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
  const tableWidth = pageWidth - marginX * 2

  const columnOffsetX = (index: number) => {
    let x = marginX + PDF_CELL_PAD
    for (let i = 0; i < index; i++) x += columns[i].width
    return x
  }

  const drawRightAligned = (text: string, colIndex: number, baselineY: number) => {
    const colX = columnOffsetX(colIndex)
    const colWidth = columns[colIndex].width
    const textWidth = pdf.getTextWidth(text)
    pdf.text(text, colX + colWidth - PDF_CELL_PAD - textWidth, baselineY)
  }

  const drawHeader = () => {
    pdf.setFillColor(245, 245, 245)
    pdf.rect(marginX, y - 4.5, tableWidth, 7, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7)
    let x = marginX + PDF_CELL_PAD
    for (const col of columns) {
      pdf.text(col.header, x, y)
      x += col.width
    }
    y += 7
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(6.5)
  }

  drawHeader()

  for (const row of rows) {
    const lines = columns.map((col, index) => {
      const value = col.value(row)
      if (index === AMOUNT_COL_INDEX) return [value]
      return pdf.splitTextToSize(value, Math.max(columns[index].width - PDF_CELL_PAD * 2, 8))
    })
    const maxLines = Math.max(...lines.map((l) => l.length), 1)
    const rowHeight = maxLines * PDF_LINE_HEIGHT + 1.5

    if (y + rowHeight > pageHeight - marginBottom - 10) {
      pdf.addPage()
      y = marginTop
      drawHeader()
    }

    for (let i = 0; i < columns.length; i++) {
      if (i === AMOUNT_COL_INDEX) {
        drawRightAligned(lines[i][0] ?? '', i, y)
      } else {
        pdf.text(lines[i], columnOffsetX(i), y)
      }
    }
    y += rowHeight
  }

  const totalsRowHeight = PDF_LINE_HEIGHT + 3
  if (y + totalsRowHeight > pageHeight - marginBottom) {
    pdf.addPage()
    y = marginTop
  }

  y += 2
  pdf.setFillColor(236, 253, 245)
  pdf.rect(marginX, y - 4, tableWidth, totalsRowHeight + 1, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(7)

  pdf.text('Total', marginX + PDF_CELL_PAD, y)
  drawRightAligned(formatBdtForPdf(totalAmount), AMOUNT_COL_INDEX, y)
  pdf.setFont('helvetica', 'normal')

  pdf.save(paymentsExportFileName())
}
