import { format } from 'date-fns'
import { jsPDF } from 'jspdf'
import { formatConfirmationNumber } from './confirmation-number'
import { formatBdtForPdf } from './currency'
import { formatGuestId } from './id-type-label'
import {
  formatListBookingCheckIn,
  formatListBookingCheckOut,
  type BookingListDatetimeFields,
  type HotelTimes,
} from './hotel-times'
import { HOTEL_NAME } from './reservation-terms'
import { getLogoDataUrl } from './reservation-document-html'

export type GuestHistoryBooking = BookingListDatetimeFields & {
  id: string
  confirmationNumber?: string | null
  registrationNumber?: string | null
  status: string
  totalRoomCharge: number
  totalWithVat?: number
  dueAmount?: number
  room?: { roomNumber: string; type?: { name: string } }
}

export type GuestHistoryExportGuest = {
  name: string
  phone: string
  email?: string | null
  address?: string | null
  nationality?: string | null
  idType?: string | null
  idNumber?: string | null
  stay?: BookingListDatetimeFields | null
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ')
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^\w\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'guest'
}

export function guestHistoryPdfFileName(guestName: string): string {
  const stamp = format(new Date(), 'yyyy-MM-dd-HHmm')
  return `guest-history-${sanitizeFilePart(guestName)}-${stamp}.pdf`
}

async function loadExportLogo(): Promise<{ dataUrl: string } | null> {
  try {
    const dataUrl = await getLogoDataUrl()
    return { dataUrl }
  } catch {
    return null
  }
}

type PdfColumn = {
  header: string
  width: number
  value: (b: GuestHistoryBooking, t: HotelTimes) => string
}

const PDF_COLUMNS: PdfColumn[] = [
  {
    header: 'Reg. no.',
    width: 22,
    value: (b) => b.registrationNumber?.trim() || '—',
  },
  {
    header: 'Confirmation',
    width: 24,
    value: (b) => formatConfirmationNumber(b),
  },
  { header: 'Room', width: 14, value: (b) => b.room?.roomNumber ?? '—' },
  { header: 'Type', width: 20, value: (b) => b.room?.type?.name ?? '—' },
  {
    header: 'Check-in',
    width: 30,
    value: (b, t) => formatListBookingCheckIn(b, t),
  },
  {
    header: 'Check-out',
    width: 30,
    value: (b, t) => formatListBookingCheckOut(b, t),
  },
  { header: 'Status', width: 20, value: (b) => statusLabel(b.status) },
  {
    header: 'Total',
    width: 22,
    value: (b) => formatBdtForPdf(b.totalWithVat ?? b.totalRoomCharge),
  },
]

const PDF_LINE_HEIGHT = 3.6
const PDF_CELL_PAD = 1.5

function splitCellLines(pdf: jsPDF, text: string, colWidth: number): string[] {
  const content = (text || '—').trim() || '—'
  return pdf.splitTextToSize(content, Math.max(colWidth - PDF_CELL_PAD * 2, 8))
}

function drawPdfHeader(pdf: jsPDF, logo: { dataUrl: string } | null): number {
  const pageWidth = pdf.internal.pageSize.getWidth()
  const marginTop = 10
  const logoSize = 12
  const headerGap = 4
  const headerY = marginTop

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  const nameWidth = pdf.getTextWidth(HOTEL_NAME)
  pdf.setFontSize(12)
  const subtitleWidth = pdf.getTextWidth('Guest History Report')
  const textWidth = Math.max(nameWidth, subtitleWidth)
  const blockWidth = (logo ? logoSize + headerGap : 0) + textWidth
  const blockStartX = (pageWidth - blockWidth) / 2

  if (logo) {
    pdf.addImage(logo.dataUrl, 'PNG', blockStartX, headerY, logoSize, logoSize)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(16)
    pdf.text(HOTEL_NAME, blockStartX + logoSize + headerGap, headerY + 5)
    pdf.setFontSize(12)
    pdf.text('Guest History Report', blockStartX + logoSize + headerGap, headerY + 10)
  } else {
    pdf.text(HOTEL_NAME, pageWidth / 2, headerY + 7, { align: 'center' })
    pdf.setFontSize(12)
    pdf.text('Guest History Report', pageWidth / 2, headerY + 14, { align: 'center' })
  }

  return headerY + (logo ? logoSize : 14) + 4
}

export async function downloadGuestHistoryPdf(
  guest: GuestHistoryExportGuest,
  bookings: GuestHistoryBooking[],
  times: HotelTimes,
  exportedAt: Date = new Date()
): Promise<void> {
  const logo = await loadExportLogo()
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const marginX = 10
  const marginBottom = 10
  const headerRowHeight = 7
  let y = drawPdfHeader(pdf, logo)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(80, 80, 80)
  pdf.text(`Exported: ${format(exportedAt, 'dd MMM yyyy · h:mm a')}`, marginX, y)
  y += 6

  pdf.setTextColor(0, 0, 0)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.text('Guest profile', marginX, y)
  y += 5

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  const profileLines = [
    `Name: ${guest.name}`,
    `Mobile: ${guest.phone}`,
    `Email: ${guest.email?.trim() || '—'}`,
    `Address: ${guest.address?.trim() || '—'}`,
    `Nationality: ${guest.nationality?.trim() || '—'}`,
    `ID: ${formatGuestId(guest.idType, guest.idNumber)}`,
  ]

  if (guest.stay) {
    profileLines.push(
      `Current check-in: ${formatListBookingCheckIn(guest.stay, times)}`,
      `Current check-out: ${formatListBookingCheckOut(guest.stay, times)}`
    )
  }

  for (const line of profileLines) {
    const wrapped = pdf.splitTextToSize(line, pageWidth - marginX * 2)
    pdf.text(wrapped, marginX, y)
    y += wrapped.length * 4.2
  }

  y += 3
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.text('Reservation history', marginX, y)
  y += 5

  if (!bookings.length) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(100, 100, 100)
    pdf.text('No reservations recorded for this guest.', marginX, y)
    pdf.save(guestHistoryPdfFileName(guest.name))
    return
  }

  const colWidths = PDF_COLUMNS.map((c) => c.width)
  const tableWidth = colWidths.reduce((a, b) => a + b, 0)
  const tableStartX = Math.max(marginX, (pageWidth - tableWidth) / 2)

  const drawTableHeader = () => {
    pdf.setFillColor(245, 245, 245)
    pdf.rect(tableStartX, y, tableWidth, headerRowHeight, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(0, 0, 0)
    let x = tableStartX
    for (const col of PDF_COLUMNS) {
      pdf.text(col.header, x + PDF_CELL_PAD, y + 4.8)
      x += col.width
    }
    y += headerRowHeight
  }

  const ensureSpace = (needed: number) => {
    if (y + needed <= pageHeight - marginBottom) return
    pdf.addPage()
    y = drawPdfHeader(pdf, logo) + 4
    drawTableHeader()
  }

  drawTableHeader()

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7.5)

  for (const booking of bookings) {
    const cellLineGroups = PDF_COLUMNS.map((col, i) =>
      splitCellLines(pdf, col.value(booking, times), colWidths[i])
    )
    const rowLines = Math.max(1, ...cellLineGroups.map((g) => g.length))
    const rowHeight = rowLines * PDF_LINE_HEIGHT + PDF_CELL_PAD * 2

    ensureSpace(rowHeight)

    let x = tableStartX
    for (let c = 0; c < PDF_COLUMNS.length; c++) {
      const lines = cellLineGroups[c]
      let lineY = y + PDF_CELL_PAD + PDF_LINE_HEIGHT
      for (const line of lines) {
        pdf.text(line, x + PDF_CELL_PAD, lineY)
        lineY += PDF_LINE_HEIGHT
      }
      x += colWidths[c]
    }

    pdf.setDrawColor(220, 220, 220)
    pdf.line(tableStartX, y + rowHeight, tableStartX + tableWidth, y + rowHeight)
    y += rowHeight
  }

  pdf.save(guestHistoryPdfFileName(guest.name))
}
