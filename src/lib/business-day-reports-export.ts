import { format, parseISO } from 'date-fns'
import { jsPDF } from 'jspdf'
import ExcelJS from 'exceljs'
import { formatBusinessDateDisplay } from './business-date-format'
import { HOTEL_NAME } from './reservation-terms'
import { getLogoDataUrl } from './reservation-document-html'
import { formatBdtForPdf } from './currency'
import {
  PAPER_SALES_HEADERS,
  buildPaperSalesLines,
  buildPaperSummary,
  computePaperTotals,
  formatPaperAmount,
  formatPaperAmountAlways,
  formatPaperDate,
  paperLineToRow,
  paperTotalsToRow,
} from './daily-sales-paper-format'

export type BusinessDayReportTab =
  | 'summary'
  | 'sales'
  | 'collections'
  | 'discounts'
  | 'checkin-checkout'
  | 'police'

export type PoliceReportData = {
  businessDate: string
  businessDateDisplay?: string
  dateFrom?: string
  dateTo?: string
  totalCheckIns?: number
  guestCount?: number
  guests?: Array<{
    id?: string
    guestName?: string
    mobile?: string | null
    idDocument?: string
    address?: string | null
    nationality?: string | null
    company?: string | null
    roomNumber?: string
    checkInAt?: string | null
    checkInAtDisplay?: string
    businessDate?: string
    isCompanion?: boolean
    guestRole?: 'primary' | 'companion' | 'child' | 'unregistered'
  }>
}

function isPoliceReportDateRange(data: PoliceReportData): boolean {
  const from = data.dateFrom?.trim()
  const to = data.dateTo?.trim()
  return Boolean(from && to && from !== to)
}

export type BusinessDaySummaryData = {
  businessDate: string
  businessDateDisplay?: string
  sales: SalesReportData
  collections: CollectionsReportData
  checkInOut: CheckInOutReportData
}

export type BusinessDayExportMeta = {
  businessDate: string
  businessDateDisplay?: string
  tab: BusinessDayReportTab
  exportedAt?: Date
  generatedBy?: { name: string; email?: string; role?: string }
}

export type SalesReportData = {
  businessDate: string
  businessDateDisplay?: string
  openingBalance?: number
  lines?: Array<{
    guestName?: string | null
    room?: string | null
    regNo?: string | null
    roomAmount?: number
    otherService?: number
    cash?: number
    card?: number
    mbanking?: number
    companyBill?: number
    remark?: string | null
    total?: number
    reference?: string | null
    lineType?: 'charge' | 'payment'
    source?: 'invoice' | 'restaurant' | 'beverage' | 'guest-restaurant-bill' | 'payment'
  }>
  balances?: {
    openingBalance?: number
    salesTotal?: number
    grandTotal?: number
    companyBillTotal?: number
    closingBalance?: number
  }
  summary?: {
    checkIns?: number
    checkOuts?: number
    occupiedRooms?: number
    totalRooms?: number
  }
  hotel?: {
    roomSales?: number
    foodSales?: number
    extraSales?: number
    discount?: number
    vat?: number
    invoiceTotal?: number
    invoicePaid?: number
    invoiceDue?: number
    invoiceCount?: number
    beverageWalkInSales?: number
    beverageRoomSales?: number
    beverageSales?: number
    transportWalkInSales?: number
    transportRoomSales?: number
    transportSales?: number
    hotelSalesTotal?: number
  }
  restaurant?: {
    grossSales?: number
    vat?: number
    discount?: number
    orderCount?: number
  }
  totalDiscount?: number
  grandTotal?: number
  collections?: number
  cashReconciliation?: {
    openingCash?: number
    cashCollectedToday?: number
    cardCollectedToday?: number
    mBankingCollectedToday?: number
    cashRemitted?: number
    cardRemitted?: number
    mBankingRemitted?: number
    cashOnHand?: number
    totalRemitted?: number
  }
  headOfficeRemittances?: Array<{
    id: string
    amount: number
    method: string
    bank?: string | null
    reference?: string | null
    notes?: string | null
    sentBy: string
    at?: string
  }>
  billBreakdown?: {
    hotelBills?: number
    restaurantBills?: number
    transportBills?: number
  }
}

export type CollectionsReportData = {
  businessDate: string
  businessDateDisplay?: string
  summary?: {
    grossCollected?: number
    refunds?: number
    netCollected?: number
    paymentCount?: number
    depositTotal?: number
    depositCount?: number
    openingCash?: number
    cashCollected?: number
    cardCollected?: number
    mBankingCollected?: number
    cashRemitted?: number
    cardRemitted?: number
    mBankingRemitted?: number
    cashOnHand?: number
    salesReportCashTotal?: number
  }
  byMethod?: Array<{ method: string; amount: number }>
  payments?: Array<{
    amount: number
    method: string
    type: string
    purpose?: string
    roomNumber?: string | null
    at: string
    receivedBy: string
    reference?: string | null
  }>
  deposits?: Array<{
    id?: string
    amount: number
    method: string
    bank?: string | null
    reference?: string | null
    notes?: string | null
    sentBy?: string
    at: string
  }>
}

export type CheckInOutGuest = Record<string, unknown>

export type CheckInOutReportData = {
  businessDate: string
  businessDateDisplay?: string
  arrivals?: {
    actualCheckIns?: number
    expectedArrivals?: number
    totalListed?: number
    guests?: CheckInOutGuest[]
  }
  departures?: {
    actualCheckOuts?: number
    totalListed?: number
    guests?: CheckInOutGuest[]
  }
}

export type DiscountReportData = {
  businessDate: string
  businessDateDisplay?: string
  summary?: {
    hotelDiscountTotal?: number
    restaurantDiscountTotal?: number
    totalDiscount?: number
    hotelCount?: number
    restaurantCount?: number
    lineCount?: number
  }
  lines?: Array<{
    id: string
    source: 'hotel' | 'restaurant'
    purpose: string
    reference: string
    guestName: string | null
    roomNumber: string | null
    detail: string | null
    company: string | null
    discountAmount: number
    grossAmount: number
    netAmount: number
    at: string
    createdBy: string | null
  }>
}

const TAB_TITLES: Record<BusinessDayReportTab, string> = {
  summary: 'Business Day Summary',
  sales: 'Daily Sales Report',
  collections: 'Daily Collections Report',
  discounts: 'Daily Discount Report',
  'checkin-checkout': 'Check-in / Check-out Report',
  police: 'Police Report',
}

const IN_HOUSE_BOOKING_REPORT_TITLE = 'Booking Report (In-House)'

function formatGeneratedBy(user?: BusinessDayExportMeta['generatedBy']): string {
  if (!user?.name) return '—'
  if (user.email) return `${user.name} (${user.email})`
  return user.name
}

function fileName(tab: BusinessDayReportTab, businessDate: string, ext: 'xlsx' | 'pdf'): string {
  const stamp = format(new Date(), 'yyyyMMdd-HHmm')
  if (tab === 'police') {
    return `booking-in-house-${businessDate}-${stamp}.${ext}`
  }
  return `business-day-${tab}-${businessDate}-${stamp}.${ext}`
}

function triggerBrowserDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
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

function formatIsoDateTime(value: unknown): string {
  if (!value || typeof value !== 'string') return '—'
  try {
    return format(parseISO(value), 'dd MMM yyyy, HH:mm')
  } catch {
    return value
  }
}

function salesDetailRows(data: SalesReportData): Array<Record<string, string | number>> {
  return buildPaperSalesLines(data.lines).map((line, index) => ({
    Room: line.roomNo,
    'Reg No': line.regNo,
    'Others Service Sale': line.othersServiceSale ?? 0,
    Cash: line.cash ?? 0,
    Card: line.card ?? 0,
    'M-banking': line.mBanking ?? 0,
    'Due Bill': line.dueBill ?? 0,
    Remark: line.remarks,
    'Total (incl. VAT)': line.totalInclVat ?? 0,
    _index: index,
  }))
}

const EXCEL_RED = { argb: 'FFCC0000' }
const EXCEL_BLUE = { argb: 'FF0000CC' }
const EXCEL_GREEN_FILL = { argb: 'FF548235' }
const EXCEL_YELLOW_FILL = { argb: 'FFFFFF00' }
const EXCEL_HEADER_FILL = { argb: 'FFD9D9D9' }

function setExcelBorder(cell: ExcelJS.Cell) {
  cell.border = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  }
}

async function writeDailySalesExcel(
  data: SalesReportData,
  meta: Omit<BusinessDayExportMeta, 'tab'>
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Daily Sales')
  const logo = await loadExportLogo()
  const paperLines = buildPaperSalesLines(data.lines)
  const totals = computePaperTotals(paperLines)
  const summary = buildPaperSummary(data)
  const mainCols = PAPER_SALES_HEADERS.length

  const dateLabel = formatPaperDate(meta.businessDate, meta.businessDateDisplay)

  sheet.getColumn(1).width = 10
  sheet.getColumn(2).width = 12
  sheet.getColumn(3).width = 16
  for (let c = 4; c <= 9; c++) sheet.getColumn(c).width = 12
  sheet.getColumn(8).width = 16
  sheet.getColumn(9).width = 16

  let row = 1
  sheet.getCell(row, 1).value = `Date: ${dateLabel}`
  sheet.getCell(row, 1).font = { bold: true }

  if (logo) {
    const imageId = workbook.addImage({ base64: logo.base64, extension: 'png' })
    sheet.addImage(imageId, {
      tl: { col: 3.2, row: 0.15 },
      ext: { width: 36, height: 36 },
    })
  }

  sheet.mergeCells(1, 3, 1, 7)
  const hotelCell = sheet.getCell(1, 3)
  hotelCell.value = HOTEL_NAME
  hotelCell.font = { bold: true, size: 13 }
  hotelCell.alignment = { horizontal: 'center', vertical: 'middle' }

  sheet.mergeCells(2, 3, 2, 7)
  const titleCell = sheet.getCell(2, 3)
  titleCell.value = 'Daily Sales Report'
  titleCell.font = { bold: true, size: 14 }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }

  row = 3
  sheet.mergeCells(row, 1, row, mainCols - 1)
  sheet.getCell(row, 1).value = 'Opening Balance(Cash)'
  sheet.getCell(row, 1).font = { bold: true }
  sheet.getCell(row, mainCols).value = summary.openingBalance
  sheet.getCell(row, mainCols).numFmt = '#,##0.00'
  sheet.getCell(row, mainCols).font = { bold: true }
  for (let c = 1; c <= mainCols; c++) setExcelBorder(sheet.getCell(row, c))

  row += 1
  PAPER_SALES_HEADERS.forEach((header, index) => {
    const cell = sheet.getCell(row, index + 1)
    cell.value = header
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: EXCEL_HEADER_FILL }
    cell.alignment = { horizontal: 'center', wrapText: true }
    setExcelBorder(cell)
  })

  row += 1
  const dataStartRow = row
  if (paperLines.length) {
    for (const line of paperLines) {
      const values = paperLineToRow(line)
      values.forEach((value, index) => {
        const cell = sheet.getCell(row, index + 1)
        cell.value = value
        cell.alignment = { horizontal: index >= 2 ? 'right' : 'center' }
        setExcelBorder(cell)
      })
      row += 1
    }
  } else {
    sheet.mergeCells(row, 1, row, mainCols)
    sheet.getCell(row, 1).value = 'No sales recorded for this business day'
    row += 1
  }

  const totalValues = paperTotalsToRow(totals, summary.totalSale)
  totalValues.forEach((value, index) => {
    const cell = sheet.getCell(row, index + 1)
    cell.value = value
    cell.font = { bold: true }
    if (index === 6 && totals.dueBill > 0) cell.font = { bold: true, color: EXCEL_RED }
    if (index === 8 && summary.totalSale > 0) cell.font = { bold: true, color: EXCEL_BLUE }
    cell.alignment = { horizontal: index >= 2 ? 'right' : 'left' }
    setExcelBorder(cell)
  })
  // Right-side totals block (like paper sheet)
  const grandTotal = summary.openingBalance + summary.totalSale
  const rightBlockStartRow = row + 1
  const rightLabelCol = 8
  const rightValueCol = 9
  const rightBlock: Array<[string, number]> = [
    ['Opening balance', summary.openingBalance],
    ['Grand total', grandTotal],
    ['Hotel bills (incl. beverage)', summary.hotelBills],
    ['Transport bills', summary.transportBills],
    ['Restaurant bills', summary.restaurantBills],
    ['Hotel discount', summary.hotelDiscount],
    ['Restaurant discount', summary.restaurantDiscount],
    ['Total discount', summary.totalDiscount],
    ['Company bill total', summary.dueBill],
    ['Closing balance', summary.closingBalance],
    ['Cash collected', summary.cashCollectedToday],
    ['Card collected', summary.cardCollectedToday],
    ['M. banking collected', summary.mBankingCollectedToday],
    ['Sent to head office (cash)', summary.cashSentToHeadOffice],
    ['Sent to head office (card)', summary.cardSentToHeadOffice],
    ['Sent to head office (m. banking)', summary.mBankingSentToHeadOffice],
    ['Cash on hand', summary.cashOnHand],
  ]
  rightBlock.forEach(([label, value], i) => {
    const r = rightBlockStartRow + i
    const labelCell = sheet.getCell(r, rightLabelCol)
    const valueCell = sheet.getCell(r, rightValueCol)
    labelCell.value = label
    valueCell.value = value
    valueCell.numFmt = '#,##0.00'
    valueCell.alignment = { horizontal: 'right' }
    setExcelBorder(labelCell)
    setExcelBorder(valueCell)
  })

  const hoRows = data.headOfficeRemittances ?? []
  if (hoRows.length > 0) {
    const hoHeaderRow = rightBlockStartRow + rightBlock.length + 1
    const headerLabel = sheet.getCell(hoHeaderRow, rightLabelCol)
    const headerValue = sheet.getCell(hoHeaderRow, rightValueCol)
    headerLabel.value = 'Sent to HO'
    headerValue.value = 'Amount'
    headerLabel.font = { bold: true }
    headerValue.font = { bold: true }
    headerValue.alignment = { horizontal: 'right' }
    setExcelBorder(headerLabel)
    setExcelBorder(headerValue)

    hoRows.forEach((hoRow, index) => {
      const r = hoHeaderRow + 1 + index
      const subtitle = hoRow.reference || hoRow.notes || hoRow.sentBy || '—'
      const labelCell = sheet.getCell(r, rightLabelCol)
      const valueCell = sheet.getCell(r, rightValueCol)
      labelCell.value = `${hoRow.method}\n${subtitle}`
      labelCell.alignment = { wrapText: true, vertical: 'top' }
      valueCell.value = hoRow.amount
      valueCell.numFmt = '#,##0.00'
      valueCell.alignment = { horizontal: 'right', vertical: 'top' }
      setExcelBorder(labelCell)
      setExcelBorder(valueCell)
    })
  }

  row += 2

  // Occupancy block (bottom-left)
  const occupancyStart = row + 1
  const occupancyRows: Array<[string, string]> = [
    ['Todays Check In Room', `${summary.checkIns} Room`],
    ['Todays Check Out Room', `${summary.checkOuts} Room`],
    ['Occupied Room', `${summary.occupiedRooms} Room`],
  ]
  occupancyRows.forEach(([label, value], index) => {
    const r = occupancyStart + index
    sheet.mergeCells(r, 1, r, 2)
    sheet.getCell(r, 1).value = label
    sheet.getCell(r, 1).font = { bold: true }
    sheet.mergeCells(r, 3, r, 4)
    sheet.getCell(r, 3).value = value
    for (let c = 1; c <= 4; c++) setExcelBorder(sheet.getCell(r, c))
  })

  const buffer = await workbook.xlsx.writeBuffer()
  triggerBrowserDownload(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    fileName('sales', meta.businessDate, 'xlsx')
  )
}

async function writeDailySalesPdf(
  data: SalesReportData,
  meta: Omit<BusinessDayExportMeta, 'tab'>
): Promise<void> {
  const logo = await loadExportLogo()
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const marginX = 8
  const marginTop = 8
  let y = marginTop

  const paperLines = buildPaperSalesLines(data.lines)
  const totals = computePaperTotals(paperLines)
  const summary = buildPaperSummary(data)
  const dateLabel = formatPaperDate(meta.businessDate, meta.businessDateDisplay)

  const mainColWidths = [14, 16, 22, 16, 14, 18, 18, 22, 24]
  const mainTableWidth = mainColWidths.reduce((s, w) => s + w, 0)
  const mainStartX = marginX

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.text(`Date: ${dateLabel}`, marginX, y + 3)

  const logoSize = 12
  const title = 'Daily Sales Report'
  pdf.setFontSize(14)
  const titleWidth = pdf.getTextWidth(title)
  const titleX = (pageWidth - titleWidth) / 2
  if (logo) {
    pdf.addImage(logo.dataUrl, 'PNG', titleX - logoSize - 2, y, logoSize, logoSize)
  }
  pdf.text(title, titleX, y + 8)
  y += 14

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.text('Opening Balance(Cash)', mainStartX + 1, y + 3)
  pdf.text(formatPaperAmountAlways(summary.openingBalance), mainStartX + mainTableWidth - 2, y + 3, {
    align: 'right',
  })
  pdf.rect(mainStartX, y, mainTableWidth, 6)
  y += 8

  const drawMainHeader = () => {
    pdf.setFillColor(217, 217, 217)
    pdf.rect(mainStartX, y, mainTableWidth, 7, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(6)
    let x = mainStartX + 1
    PAPER_SALES_HEADERS.forEach((header, i) => {
      const lines = pdf.splitTextToSize(header, mainColWidths[i]! - 2)
      pdf.text(lines, x, y + 3.5)
      x += mainColWidths[i]!
    })
    y += 7
  }

  drawMainHeader()

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(6.5)
  for (const line of paperLines) {
    if (y > pageHeight - 20) {
      pdf.addPage()
      y = marginTop
      drawMainHeader()
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(6.5)
    }
    const values = paperLineToRow(line)
    let x = mainStartX + 1
    values.forEach((text, i) => {
      const clipped = pdf.splitTextToSize(text, mainColWidths[i]! - 2)[0] ?? text
      if (i >= 2) pdf.text(clipped, x + mainColWidths[i]! - 2, y, { align: 'right' })
      else pdf.text(clipped, x, y)
      x += mainColWidths[i]!
    })
    pdf.setDrawColor(180)
    pdf.line(mainStartX, y + 1.5, mainStartX + mainTableWidth, y + 1.5)
    y += 4.5
  }

  pdf.setFont('helvetica', 'bold')
  const totalValues = paperTotalsToRow(totals, summary.totalSale)
  let x = mainStartX + 1
  totalValues.forEach((text, i) => {
    if (i === 6 && totals.dueBill > 0) pdf.setTextColor(204, 0, 0)
    else if (i === 8 && summary.totalSale > 0) pdf.setTextColor(0, 0, 204)
    else pdf.setTextColor(0, 0, 0)
    const clipped = pdf.splitTextToSize(text, mainColWidths[i]! - 2)[0] ?? text
    if (i >= 2) pdf.text(clipped, x + mainColWidths[i]! - 2, y, { align: 'right' })
    else pdf.text(clipped, x, y)
    x += mainColWidths[i]!
  })
  pdf.setTextColor(0, 0, 0)
  pdf.line(mainStartX, y + 1.5, mainStartX + mainTableWidth, y + 1.5)
  y += 8

  // Right-side totals block (opening/grand/company/closing)
  const grandTotal = summary.openingBalance + summary.totalSale
  const blockX = mainStartX + mainTableWidth - 58
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7)
  const rightRows: Array<[string, string]> = [
    ['Opening balance', formatPaperAmountAlways(summary.openingBalance)],
    ['Grand total', formatPaperAmountAlways(grandTotal)],
    ['Hotel bills (incl. beverage)', formatPaperAmountAlways(summary.hotelBills)],
    ['Transport bills', formatPaperAmountAlways(summary.transportBills)],
    ['Restaurant bills', formatPaperAmountAlways(summary.restaurantBills)],
    ['Hotel discount', formatPaperAmountAlways(summary.hotelDiscount)],
    ['Restaurant discount', formatPaperAmountAlways(summary.restaurantDiscount)],
    ['Total discount', formatPaperAmountAlways(summary.totalDiscount)],
    ['Company bill total', formatPaperAmountAlways(summary.dueBill)],
    ['Closing balance', formatPaperAmountAlways(summary.closingBalance)],
    ['Cash collected', formatPaperAmountAlways(summary.cashCollectedToday)],
    ['Card collected', formatPaperAmountAlways(summary.cardCollectedToday)],
    ['M. banking collected', formatPaperAmountAlways(summary.mBankingCollectedToday)],
    ['Sent to head office (cash)', formatPaperAmountAlways(summary.cashSentToHeadOffice)],
    ['Sent to head office (card)', formatPaperAmountAlways(summary.cardSentToHeadOffice)],
    ['Sent to head office (m. banking)', formatPaperAmountAlways(summary.mBankingSentToHeadOffice)],
    ['Cash on hand', formatPaperAmountAlways(summary.cashOnHand)],
  ]
  const rightBlockHeight = rightRows.length * 4.5
  let blockY = y

  const hoRows = data.headOfficeRemittances ?? []
  const hoTableHeight = hoRows.length > 0 ? 5 + hoRows.length * 8 : 0

  const occupancyRows: Array<[string, string]> = [
    ['Todays Check In Room', `${summary.checkIns} Room`],
    ['Todays Check Out Room', `${summary.checkOuts} Room`],
    ['Occupied Room', `${summary.occupiedRooms} Room`],
  ]
  const occupancyHeight = occupancyRows.length * 6
  const desiredEndY = blockY + rightBlockHeight + 4 + hoTableHeight + 4 + occupancyHeight
  if (desiredEndY > pageHeight - 10) {
    const shiftUp = desiredEndY - (pageHeight - 10)
    blockY = Math.max(marginTop + 20, blockY - shiftUp)
  }
  for (const [label, value] of rightRows) {
    pdf.text(label, blockX, blockY)
    pdf.text(value, mainStartX + mainTableWidth - 2, blockY, { align: 'right' })
    blockY += 4.5
  }

  const boxWidth = 70
  const boxX = mainStartX + mainTableWidth - boxWidth
  let noteY = blockY + 4

  if (hoRows.length > 0) {
    pdf.setFillColor(217, 217, 217)
    pdf.rect(boxX, noteY, boxWidth, 5, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7)
    pdf.text('Sent to HO', boxX + 2, noteY + 3.5)
    pdf.text('Amount', boxX + boxWidth - 2, noteY + 3.5, { align: 'right' })
    noteY += 5

    const colSplit = boxWidth * 0.62
    for (const hoRow of hoRows) {
      const rowHeight = 8
      pdf.rect(boxX, noteY, boxWidth, rowHeight)
      pdf.line(boxX + colSplit, noteY, boxX + colSplit, noteY + rowHeight)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(7)
      pdf.text(hoRow.method, boxX + 2, noteY + 3.5)
      const subtitle = hoRow.reference || hoRow.notes || hoRow.sentBy || '—'
      pdf.setFontSize(6)
      pdf.setTextColor(100, 100, 100)
      pdf.text(subtitle, boxX + 2, noteY + 6.5)
      pdf.setTextColor(0, 0, 0)
      pdf.setFontSize(7)
      pdf.text(formatPaperAmountAlways(hoRow.amount), boxX + boxWidth - 2, noteY + 4.5, {
        align: 'right',
      })
      noteY += rowHeight
    }
    noteY += 4
  }

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(7)
  for (const [label, value] of occupancyRows) {
    pdf.rect(boxX, noteY, boxWidth, 6)
    pdf.text(label, boxX + 2, noteY + 4)
    pdf.text(value, boxX + boxWidth - 2, noteY + 4, { align: 'right' })
    noteY += 6
  }

  pdf.save(fileName('sales', meta.businessDate, 'pdf'))
}

function salesSummaryRows(data: SalesReportData): Array<Record<string, string | number>> {
  const hotel = data.hotel ?? {}
  const restaurant = data.restaurant ?? {}
  return [
    { Category: 'Room sales', Amount: hotel.roomSales ?? 0 },
    { Category: 'Food (invoice)', Amount: hotel.foodSales ?? 0 },
    { Category: 'Extras', Amount: hotel.extraSales ?? 0 },
    { Category: 'Hotel discount', Amount: hotel.discount ?? 0 },
    { Category: 'Restaurant discount', Amount: restaurant.discount ?? 0 },
    {
      Category: 'Total discount',
      Amount: (data.totalDiscount as number | undefined) ?? (hotel.discount ?? 0) + (restaurant.discount ?? 0),
    },
    { Category: 'VAT', Amount: hotel.vat ?? 0 },
    { Category: 'Invoice total', Amount: hotel.invoiceTotal ?? 0 },
    { Category: 'Invoice paid', Amount: hotel.invoicePaid ?? 0 },
    { Category: 'Invoice due', Amount: hotel.invoiceDue ?? 0 },
    { Category: 'Hotel beverage (walk-in)', Amount: hotel.beverageWalkInSales ?? 0 },
    { Category: 'Hotel sales total', Amount: hotel.hotelSalesTotal ?? hotel.invoiceTotal ?? 0 },
    { Category: 'Transport sales', Amount: hotel.transportSales ?? 0 },
    { Category: 'Restaurant POS', Amount: restaurant.grossSales ?? 0 },
    { Category: 'Grand total', Amount: data.grandTotal ?? 0 },
    { Category: 'Collections', Amount: data.collections ?? 0 },
  ]
}

function mapArrivalRow(g: CheckInOutGuest): Record<string, string | number> {
  return {
    Guest: String(g.guestName ?? ''),
    Phone: String(g.phone ?? ''),
    Room: String(g.roomNumber ?? ''),
    'Room type': String(g.roomType ?? ''),
    Status: String(g.status ?? ''),
    Company: String(g.company ?? ''),
    'Scheduled check-in': formatIsoDateTime(g.scheduledCheckIn),
    'Actual check-in': g.actualCheckIn ? formatIsoDateTime(g.actualCheckIn) : '—',
    Adults: Number(g.adults ?? 0),
    Children: Number(g.children ?? 0),
  }
}

function mapDepartureRow(g: CheckInOutGuest): Record<string, string | number> {
  return {
    Guest: String(g.guestName ?? ''),
    Phone: String(g.phone ?? ''),
    Room: String(g.roomNumber ?? ''),
    Status: String(g.status ?? ''),
    'Scheduled check-out': formatIsoDateTime(g.scheduledCheckOut),
    'Actual check-out': g.actualCheckOut ? formatIsoDateTime(g.actualCheckOut) : '—',
    Invoice: String(g.invoiceNumber ?? '—'),
    'Invoice total': Number(g.invoiceTotal ?? 0),
    Paid: Number(g.paidAmount ?? 0),
    Due: Number(g.dueAmount ?? 0),
  }
}

async function writeExcelWorkbook(
  title: string,
  sections: Array<{ heading: string; rows: Array<Record<string, string | number>> }>,
  meta: BusinessDayExportMeta
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Report')
  let row = 1
  const exportedAt = meta.exportedAt ?? new Date()
  const logo = await loadExportLogo()

  if (logo) {
    const imageId = workbook.addImage({ base64: logo.base64, extension: 'png' })
    sheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 48, height: 48 } })
    row = 4
  }

  sheet.getCell(row, 1).value = HOTEL_NAME
  sheet.getCell(row, 1).font = { bold: true, size: 14 }
  row += 1
  sheet.getCell(row, 1).value = title
  sheet.getCell(row, 1).font = { bold: true, size: 12 }
  row += 2

  const info: [string, string][] = [
    ['Business date', meta.businessDateDisplay ?? meta.businessDate],
    ['Exported', format(exportedAt, 'dd MMM yyyy, HH:mm')],
    ['Generated by', formatGeneratedBy(meta.generatedBy)],
  ]
  for (const [label, value] of info) {
    sheet.getCell(row, 1).value = label
    sheet.getCell(row, 1).font = { bold: true }
    sheet.getCell(row, 2).value = value
    row += 1
  }
  row += 1

  for (const section of sections) {
    if (!section.rows.length) continue
    sheet.getCell(row, 1).value = section.heading
    sheet.getCell(row, 1).font = { bold: true, size: 11 }
    row += 1
    const headers = Object.keys(section.rows[0])
    headers.forEach((header, index) => {
      const cell = sheet.getCell(row, index + 1)
      cell.value = header
      cell.font = { bold: true }
    })
    row += 1
    for (const dataRow of section.rows) {
      headers.forEach((header, index) => {
        sheet.getCell(row, index + 1).value = dataRow[header] ?? ''
      })
      row += 1
    }
    row += 1
  }

  const buffer = await workbook.xlsx.writeBuffer()
  triggerBrowserDownload(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    fileName(meta.tab, meta.businessDate, 'xlsx')
  )
}

type PdfColumn = {
  header: string
  width: number
  value: (row: Record<string, string | number>) => string
  align?: 'right'
}

async function writePdfTable(
  title: string,
  sections: Array<{ heading: string; columns: PdfColumn[]; rows: Record<string, string | number>[] }>,
  meta: BusinessDayExportMeta
): Promise<void> {
  const logo = await loadExportLogo()
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const marginX = 10
  let y = 10

  if (logo) {
    pdf.addImage(logo.dataUrl, 'PNG', marginX, y, 12, 12)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.text(HOTEL_NAME, marginX + 16, y + 5)
    pdf.setFontSize(11)
    pdf.text(title, marginX + 16, y + 10)
    y += 16
  } else {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.text(HOTEL_NAME, marginX, y + 4)
    pdf.setFontSize(11)
    pdf.text(title, marginX, y + 10)
    y += 14
  }

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  const exportedAt = meta.exportedAt ?? new Date()
  pdf.text(`Business date: ${meta.businessDateDisplay ?? meta.businessDate}`, marginX, y)
  y += 4
  pdf.text(`Exported: ${format(exportedAt, 'dd MMM yyyy, HH:mm')}`, marginX, y)
  y += 4
  pdf.text(`Generated by: ${formatGeneratedBy(meta.generatedBy)}`, marginX, y)
  y += 6

  const drawSection = (heading: string, columns: PdfColumn[], rows: Record<string, string | number>[]) => {
    if (!rows.length) return
    if (y > pageHeight - 20) {
      pdf.addPage()
      y = 10
    }
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    pdf.text(heading, marginX, y)
    y += 5

    const totalWidth = columns.reduce((s, c) => s + c.width, 0)
    const scale = (pageWidth - marginX * 2) / totalWidth
    const colWidths = columns.map((c) => c.width * scale)
    let x = marginX

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7)
    columns.forEach((col, i) => {
      pdf.text(col.header, x + 1, y)
      x += colWidths[i]
    })
    y += 4
    pdf.setDrawColor(200)
    pdf.line(marginX, y, pageWidth - marginX, y)
    y += 3

    pdf.setFont('helvetica', 'normal')
    for (const row of rows) {
      if (y > pageHeight - 12) {
        pdf.addPage()
        y = 10
      }
      x = marginX
      columns.forEach((col, i) => {
        const text = col.value(row)
        if (col.align === 'right') {
          pdf.text(text, x + colWidths[i] - 1, y, { align: 'right' })
        } else {
          pdf.text(text, x + 1, y)
        }
        x += colWidths[i]
      })
      y += 4
    }
    y += 4
  }

  for (const section of sections) {
    drawSection(section.heading, section.columns, section.rows)
  }

  pdf.save(fileName(meta.tab, meta.businessDate, 'pdf'))
}

function drawCenteredBrandHeaderPdf(
  pdf: jsPDF,
  pageWidth: number,
  title: string,
  logo: { dataUrl: string } | null,
  logoSize = 12
): number {
  const top = 10
  const gap = 3
  const lineGap = 5.5

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  const hotelWidth = pdf.getTextWidth(HOTEL_NAME)
  pdf.setFontSize(11)
  const titleWidth = pdf.getTextWidth(title)
  const textWidth = Math.max(hotelWidth, titleWidth)
  const textBlockHeight = lineGap * 2

  if (logo) {
    const blockWidth = logoSize + gap + textWidth
    const startX = (pageWidth - blockWidth) / 2
    pdf.addImage(logo.dataUrl, 'PNG', startX, top, logoSize, logoSize)
    const textX = startX + logoSize + gap
    const textTop = top + (logoSize - textBlockHeight) / 2 + 3.8
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.text(HOTEL_NAME, textX, textTop)
    pdf.setFontSize(11)
    pdf.text(title, textX, textTop + lineGap)
    return top + logoSize + 6
  }

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.text(HOTEL_NAME, (pageWidth - hotelWidth) / 2, top + 5)
  pdf.setFontSize(11)
  pdf.text(title, (pageWidth - titleWidth) / 2, top + 10)
  return top + 14
}

function getInHouseBrandExcelLayout(
  sheet: ExcelJS.Worksheet,
  columnCount: number,
  options: { logoWidthChars?: number; textWidthChars?: number } = {}
): { logoAnchorCol: number; logoCol: number; textCol: number } {
  const logoWidthChars = options.logoWidthChars ?? 7
  const textWidthChars =
    options.textWidthChars ?? Math.max(HOTEL_NAME.length, IN_HOUSE_BOOKING_REPORT_TITLE.length) + 2
  const blockWidthChars = logoWidthChars + textWidthChars

  let totalChars = 0
  for (let col = 1; col <= columnCount; col += 1) {
    totalChars += sheet.getColumn(col).width ?? 18
  }

  const blockStartChars = Math.max(0, (totalChars - blockWidthChars) / 2)
  let accumulated = 0
  let logoAnchorCol = 0

  for (let col = 1; col <= columnCount; col += 1) {
    const width = sheet.getColumn(col).width ?? 18
    if (accumulated + width >= blockStartChars || col === columnCount) {
      const offset = blockStartChars - accumulated
      logoAnchorCol = col - 1 + Math.max(0, Math.min(1, offset / width))
      break
    }
    accumulated += width
  }

  const logoCol = Math.min(columnCount, Math.floor(logoAnchorCol) + 1)
  const textCol = Math.min(columnCount, logoCol + 1)

  return { logoAnchorCol, logoCol, textCol }
}

function drawCenteredPdfMetaLine(pdf: jsPDF, pageWidth: number, y: number, text: string): number {
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  const width = pdf.getTextWidth(text)
  pdf.text(text, (pageWidth - width) / 2, y)
  return y + 4
}

async function writeInHouseBookingExcelWorkbook(
  sections: Array<{ heading: string; rows: Array<Record<string, string | number>> }>,
  meta: Omit<BusinessDayExportMeta, 'tab'>
): Promise<void> {
  const title = IN_HOUSE_BOOKING_REPORT_TITLE
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Report')
  const exportedAt = meta.exportedAt ?? new Date()
  const logo = await loadExportLogo()

  const columnCount = sections.reduce((max, section) => {
    if (!section.rows.length) return max
    return Math.max(max, Object.keys(section.rows[0]).length)
  }, 7)

  for (let col = 1; col <= columnCount; col++) {
    sheet.getColumn(col).width = 18
  }

  for (let col = 1; col <= columnCount; col++) {
    sheet.getColumn(col).width = 18
  }

  const { logoAnchorCol, logoCol, textCol } = getInHouseBrandExcelLayout(sheet, columnCount)

  sheet.getRow(1).height = 24
  sheet.getRow(2).height = 24
  sheet.getRow(3).height = 6

  const logoSize = 40

  if (logo) {
    const imageId = workbook.addImage({ base64: logo.base64, extension: 'png' })
    sheet.addImage(imageId, {
      tl: { col: logoAnchorCol + 0.05, row: 0.12 },
      ext: { width: logoSize, height: logoSize },
    })
  }

  const hotelCell = sheet.getCell(1, textCol)
  hotelCell.value = HOTEL_NAME
  hotelCell.font = { bold: true, size: 14 }
  hotelCell.alignment = { vertical: 'bottom', horizontal: 'left' }

  const titleCell = sheet.getCell(2, textCol)
  titleCell.value = title
  titleCell.font = { bold: true, size: 12 }
  titleCell.alignment = { vertical: 'top', horizontal: 'left' }

  // Keep logo column clear of stray values while the image is anchored there.
  sheet.getCell(1, logoCol).value = null
  sheet.getCell(2, logoCol).value = null

  let row = 4
  const info: [string, string][] = [
    ['Business date', meta.businessDateDisplay ?? meta.businessDate],
    ['Exported', format(exportedAt, 'dd MMM yyyy, HH:mm')],
    ['Generated by', formatGeneratedBy(meta.generatedBy)],
  ]
  for (const [label, value] of info) {
    sheet.mergeCells(row, 1, row, columnCount)
    const cell = sheet.getCell(row, 1)
    cell.value = `${label}: ${value}`
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    row += 1
  }
  row += 1

  for (const section of sections) {
    if (!section.rows.length) continue
    sheet.mergeCells(row, 1, row, columnCount)
    const headingCell = sheet.getCell(row, 1)
    headingCell.value = section.heading
    headingCell.font = { bold: true, size: 11 }
    headingCell.alignment = { horizontal: 'center' }
    row += 1

    const headers = Object.keys(section.rows[0])
    headers.forEach((header, index) => {
      const cell = sheet.getCell(row, index + 1)
      cell.value = header
      cell.font = { bold: true }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    })
    row += 1

    for (const dataRow of section.rows) {
      headers.forEach((header, index) => {
        const cell = sheet.getCell(row, index + 1)
        cell.value = dataRow[header] ?? ''
        cell.alignment = { vertical: 'top', wrapText: true }
      })
      row += 1
    }
    row += 1
  }

  const buffer = await workbook.xlsx.writeBuffer()
  triggerBrowserDownload(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    fileName('police', meta.businessDate, 'xlsx')
  )
}

async function writeInHouseBookingPdf(
  sections: Array<{ heading: string; columns: PdfColumn[]; rows: Record<string, string | number>[] }>,
  meta: Omit<BusinessDayExportMeta, 'tab'>
): Promise<void> {
  const title = IN_HOUSE_BOOKING_REPORT_TITLE
  const logo = await loadExportLogo()
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const marginX = 10
  let y = drawCenteredBrandHeaderPdf(pdf, pageWidth, title, logo)

  const exportedAt = meta.exportedAt ?? new Date()
  y = drawCenteredPdfMetaLine(
    pdf,
    pageWidth,
    y,
    `Business date: ${meta.businessDateDisplay ?? meta.businessDate}`
  )
  y = drawCenteredPdfMetaLine(pdf, pageWidth, y, `Exported: ${format(exportedAt, 'dd MMM yyyy, HH:mm')}`)
  y = drawCenteredPdfMetaLine(
    pdf,
    pageWidth,
    y,
    `Generated by: ${formatGeneratedBy(meta.generatedBy)}`
  )
  y += 4

  const tableLeft = marginX
  const tableWidth = pageWidth - marginX * 2
  const cellPad = 1.5
  const headerFontSize = 8.5
  const bodyFontSize = 8.5
  const headerRowHeight = 9
  const minRowHeight = 7
  const lineHeight = 3.4
  const marginBottom = 12

  const drawSection = (heading: string, columns: PdfColumn[], rows: Record<string, string | number>[]) => {
    if (!rows.length) return
    if (y > pageHeight - 24) {
      pdf.addPage()
      y = 10
    }
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    const headingWidth = pdf.getTextWidth(heading)
    pdf.text(heading, (pageWidth - headingWidth) / 2, y)
    y += 5

    const totalWidth = columns.reduce((s, c) => s + c.width, 0)
    const colWidths = columns.map((c) => (c.width / totalWidth) * tableWidth)

    const drawTableHeader = () => {
      pdf.setDrawColor(120)
      pdf.setLineWidth(0.2)
      let x = tableLeft
      columns.forEach((col, i) => {
        pdf.setFillColor(235, 235, 235)
        pdf.rect(x, y, colWidths[i]!, headerRowHeight, 'F')
        pdf.rect(x, y, colWidths[i]!, headerRowHeight, 'S')
        x += colWidths[i]!
      })
      x = tableLeft
      pdf.setTextColor(0, 0, 0)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(headerFontSize)
      columns.forEach((col, i) => {
        const lines = pdf.splitTextToSize(col.header, colWidths[i]! - cellPad * 2)
        pdf.text(lines, x + cellPad, y + 3.6)
        x += colWidths[i]!
      })
      y += headerRowHeight
    }

    drawTableHeader()

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(bodyFontSize)
    pdf.setTextColor(0, 0, 0)

    for (const row of rows) {
      const cellLines = columns.map((col, i) =>
        pdf.splitTextToSize(String(col.value(row)), colWidths[i]! - cellPad * 2)
      )
      const maxLines = Math.max(...cellLines.map((lines) => lines.length), 1)
      const rowHeight = Math.max(minRowHeight, maxLines * lineHeight + cellPad * 2)

      if (y + rowHeight > pageHeight - marginBottom) {
        pdf.addPage()
        y = 10
        drawTableHeader()
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(bodyFontSize)
      }

      let x = tableLeft
      columns.forEach((col, i) => {
        pdf.setDrawColor(120)
        pdf.rect(x, y, colWidths[i]!, rowHeight)
        const lines = cellLines[i]!
        lines.forEach((line, lineIndex) => {
          const textY = y + cellPad + 2.8 + lineIndex * lineHeight
          if (col.align === 'right') {
            pdf.text(line, x + colWidths[i]! - cellPad, textY, { align: 'right' })
          } else {
            pdf.text(line, x + cellPad, textY)
          }
        })
        x += colWidths[i]!
      })
      y += rowHeight
    }
    y += 4
  }

  for (const section of sections) {
    drawSection(section.heading, section.columns, section.rows)
  }

  pdf.save(fileName('police', meta.businessDate, 'pdf'))
}

export async function downloadBusinessDaySalesExcel(
  data: SalesReportData,
  meta: Omit<BusinessDayExportMeta, 'tab'>
): Promise<void> {
  await writeDailySalesExcel(data, meta)
}

export async function downloadBusinessDaySalesPdf(
  data: SalesReportData,
  meta: Omit<BusinessDayExportMeta, 'tab'>
): Promise<void> {
  await writeDailySalesPdf(data, meta)
}

export async function downloadBusinessDayCollectionsExcel(
  data: CollectionsReportData,
  meta: Omit<BusinessDayExportMeta, 'tab'>
): Promise<void> {
  const summary = data.summary ?? {}
  const sections: Array<{ heading: string; rows: Array<Record<string, string | number>> }> = [
    {
      heading: 'Summary',
      rows: [
        { Metric: 'Gross collected', Amount: summary.grossCollected ?? 0 },
        { Metric: 'Refunds', Amount: summary.refunds ?? 0 },
        { Metric: 'Net collected', Amount: summary.netCollected ?? 0 },
        { Metric: 'Payment count', Amount: summary.paymentCount ?? 0 },
        { Metric: 'Sent to head office', Amount: summary.depositTotal ?? 0 },
        { Metric: 'Deposit count', Amount: summary.depositCount ?? 0 },
        { Metric: 'Opening cash', Amount: summary.openingCash ?? 0 },
        { Metric: 'Cash collected (sales report)', Amount: summary.cashCollected ?? 0 },
        { Metric: 'Card collected (sales report)', Amount: summary.cardCollected ?? 0 },
        { Metric: 'M. banking collected (sales report)', Amount: summary.mBankingCollected ?? 0 },
        { Metric: 'Cash sent to head office', Amount: summary.cashRemitted ?? 0 },
        { Metric: 'Card sent to head office', Amount: summary.cardRemitted ?? 0 },
        { Metric: 'M. banking sent to head office', Amount: summary.mBankingRemitted ?? 0 },
        { Metric: 'Cash on hand', Amount: summary.cashOnHand ?? 0 },
      ],
    },
    {
      heading: 'By payment method',
      rows: (data.byMethod ?? []).map((r) => ({ Method: r.method, Amount: r.amount })),
    },
    {
      heading: 'Payment transactions',
      rows: (data.payments ?? []).map((p) => ({
        Time: formatIsoDateTime(p.at),
        Purpose: p.purpose ?? '',
        Room: p.roomNumber ?? '',
        Method: p.method,
        Type: p.type,
        Amount: p.amount,
        'Received by': p.receivedBy,
        Reference: p.reference ?? '',
      })),
    },
    {
      heading: 'Sent to head office',
      rows: (data.deposits ?? []).map((d) => ({
        Time: formatIsoDateTime(d.at),
        Method: d.method,
        Bank: d.bank ?? '',
        Amount: d.amount,
        Reference: d.reference ?? '',
        'Sent by': d.sentBy ?? '',
        Notes: d.notes ?? '',
      })),
    },
  ]
  await writeExcelWorkbook(TAB_TITLES.collections, sections, { ...meta, tab: 'collections' })
}

export async function downloadBusinessDayCollectionsPdf(
  data: CollectionsReportData,
  meta: Omit<BusinessDayExportMeta, 'tab'>
): Promise<void> {
  const summary = data.summary ?? {}
  const summaryRows = [
    { Metric: 'Gross collected', Amount: formatBdtForPdf(summary.grossCollected ?? 0) },
    { Metric: 'Refunds', Amount: formatBdtForPdf(summary.refunds ?? 0) },
    { Metric: 'Net collected', Amount: formatBdtForPdf(summary.netCollected ?? 0) },
    { Metric: 'Payment count', Amount: String(summary.paymentCount ?? 0) },
    { Metric: 'Sent to head office', Amount: formatBdtForPdf(summary.depositTotal ?? 0) },
    { Metric: 'Opening cash', Amount: formatBdtForPdf(summary.openingCash ?? 0) },
    { Metric: 'Cash collected (sales report)', Amount: formatBdtForPdf(summary.cashCollected ?? 0) },
    { Metric: 'Card collected (sales report)', Amount: formatBdtForPdf(summary.cardCollected ?? 0) },
    { Metric: 'M. banking collected (sales report)', Amount: formatBdtForPdf(summary.mBankingCollected ?? 0) },
    { Metric: 'Cash sent to head office', Amount: formatBdtForPdf(summary.cashRemitted ?? 0) },
    { Metric: 'Card sent to head office', Amount: formatBdtForPdf(summary.cardRemitted ?? 0) },
    { Metric: 'M. banking sent to head office', Amount: formatBdtForPdf(summary.mBankingRemitted ?? 0) },
    { Metric: 'Cash on hand', Amount: formatBdtForPdf(summary.cashOnHand ?? 0) },
  ]
  const methodRows = (data.byMethod ?? []).map((r) => ({
    Method: r.method,
    Amount: formatBdtForPdf(r.amount),
  }))
  const paymentRows = (data.payments ?? []).map((p) => ({
    Time: formatIsoDateTime(p.at),
    Purpose: String(p.purpose ?? ''),
    Room: String(p.roomNumber ?? ''),
    Method: p.method,
    Type: p.type,
    Amount: formatBdtForPdf(p.amount),
    'Received by': p.receivedBy,
  }))
  const depositRows = (data.deposits ?? []).map((d) => ({
    Time: formatIsoDateTime(d.at),
    Method: d.method,
    Amount: formatBdtForPdf(d.amount),
    Reference: String(d.reference ?? ''),
    'Sent by': String(d.sentBy ?? ''),
  }))

  await writePdfTable(
    TAB_TITLES.collections,
    [
      {
        heading: 'Summary',
        columns: [
          { header: 'Metric', width: 35, value: (r) => String(r.Metric) },
          { header: 'Amount', width: 25, value: (r) => String(r.Amount), align: 'right' },
        ],
        rows: summaryRows,
      },
      {
        heading: 'By payment method',
        columns: [
          { header: 'Method', width: 35, value: (r) => String(r.Method) },
          { header: 'Amount', width: 25, value: (r) => String(r.Amount), align: 'right' },
        ],
        rows: methodRows,
      },
      {
        heading: 'Payment transactions',
        columns: [
          { header: 'Time', width: 24, value: (r) => String(r.Time) },
          { header: 'Purpose', width: 16, value: (r) => String(r.Purpose) },
          { header: 'Room', width: 12, value: (r) => String(r.Room) },
          { header: 'Method', width: 16, value: (r) => String(r.Method) },
          { header: 'Type', width: 14, value: (r) => String(r.Type) },
          { header: 'Amount', width: 18, value: (r) => String(r.Amount), align: 'right' },
          { header: 'Received by', width: 20, value: (r) => String(r['Received by']) },
        ],
        rows: paymentRows,
      },
      {
        heading: 'Sent to head office',
        columns: [
          { header: 'Time', width: 24, value: (r) => String(r.Time) },
          { header: 'Method', width: 16, value: (r) => String(r.Method) },
          { header: 'Amount', width: 18, value: (r) => String(r.Amount), align: 'right' },
          { header: 'Reference', width: 20, value: (r) => String(r.Reference) },
          { header: 'Sent by', width: 20, value: (r) => String(r['Sent by']) },
        ],
        rows: depositRows,
      },
    ],
    { ...meta, tab: 'collections' }
  )
}

export async function downloadBusinessDayCheckInOutExcel(
  data: CheckInOutReportData,
  meta: Omit<BusinessDayExportMeta, 'tab'>
): Promise<void> {
  const arrivals = data.arrivals?.guests ?? []
  const departures = data.departures?.guests ?? []
  await writeExcelWorkbook(
    TAB_TITLES['checkin-checkout'],
    [
      {
        heading: `Arrivals / Check-ins (${data.arrivals?.actualCheckIns ?? 0} actual, ${data.arrivals?.expectedArrivals ?? 0} expected)`,
        rows: arrivals.map(mapArrivalRow),
      },
      {
        heading: `Departures / Check-outs (${data.departures?.actualCheckOuts ?? 0} actual)`,
        rows: departures.map(mapDepartureRow),
      },
    ],
    { ...meta, tab: 'checkin-checkout' }
  )
}

export async function downloadBusinessDayCheckInOutPdf(
  data: CheckInOutReportData,
  meta: Omit<BusinessDayExportMeta, 'tab'>
): Promise<void> {
  const arrivalRows = (data.arrivals?.guests ?? []).map((g) => {
    const row = mapArrivalRow(g)
    return {
      Guest: String(row.Guest),
      Room: String(row.Room),
      Status: String(row.Status),
      'Check-in': String(row['Actual check-in'] !== '—' ? row['Actual check-in'] : row['Scheduled check-in']),
    }
  })
  const departureRows = (data.departures?.guests ?? []).map((g) => {
    const row = mapDepartureRow(g)
    return {
      Guest: String(row.Guest),
      Room: String(row.Room),
      Status: String(row.Status),
      Due: formatBdtForPdf(Number(row.Due)),
    }
  })

  await writePdfTable(
    TAB_TITLES['checkin-checkout'],
    [
      {
        heading: `Arrivals / Check-ins (${data.arrivals?.actualCheckIns ?? 0} actual)`,
        columns: [
          { header: 'Guest', width: 35, value: (r) => String(r.Guest) },
          { header: 'Room', width: 15, value: (r) => String(r.Room) },
          { header: 'Status', width: 18, value: (r) => String(r.Status) },
          { header: 'Check-in', width: 32, value: (r) => String(r['Check-in']) },
        ],
        rows: arrivalRows,
      },
      {
        heading: `Departures / Check-outs (${data.departures?.actualCheckOuts ?? 0} actual)`,
        columns: [
          { header: 'Guest', width: 35, value: (r) => String(r.Guest) },
          { header: 'Room', width: 15, value: (r) => String(r.Room) },
          { header: 'Status', width: 18, value: (r) => String(r.Status) },
          { header: 'Due', width: 22, value: (r) => String(r.Due), align: 'right' },
        ],
        rows: departureRows,
      },
    ],
    { ...meta, tab: 'checkin-checkout' }
  )
}

function collectionsSummaryRows(data: CollectionsReportData): Array<Record<string, string | number>> {
  const summary = data.summary ?? {}
  return [
    { Metric: 'Gross collected', Amount: summary.grossCollected ?? 0 },
    { Metric: 'Refunds', Amount: summary.refunds ?? 0 },
    { Metric: 'Net collected', Amount: summary.netCollected ?? 0 },
    { Metric: 'Payment count', Amount: summary.paymentCount ?? 0 },
    { Metric: 'Deposits', Amount: summary.depositTotal ?? 0 },
    { Metric: 'Deposit count', Amount: summary.depositCount ?? 0 },
  ]
}

function checkInOutSummaryRows(data: CheckInOutReportData): Array<Record<string, string | number>> {
  return [
    { Metric: 'Actual check-ins', Count: data.arrivals?.actualCheckIns ?? 0 },
    { Metric: 'Expected arrivals', Count: data.arrivals?.expectedArrivals ?? 0 },
    { Metric: 'Arrivals listed', Count: data.arrivals?.totalListed ?? 0 },
    { Metric: 'Actual check-outs', Count: data.departures?.actualCheckOuts ?? 0 },
    { Metric: 'Departures listed', Count: data.departures?.totalListed ?? 0 },
  ]
}

export async function downloadBusinessDaySummaryExcel(
  data: BusinessDaySummaryData,
  meta: Omit<BusinessDayExportMeta, 'tab'>
): Promise<void> {
  const collections = data.collections
  await writeExcelWorkbook(
    TAB_TITLES.summary,
    [
      { heading: 'Sales', rows: salesSummaryRows(data.sales) },
      { heading: 'Collections', rows: collectionsSummaryRows(collections) },
      {
        heading: 'Collections by method',
        rows: (collections.byMethod ?? []).map((r) => ({ Method: r.method, Amount: r.amount })),
      },
      { heading: 'Check-in / Check-out', rows: checkInOutSummaryRows(data.checkInOut) },
      {
        heading: 'Arrivals',
        rows: (data.checkInOut.arrivals?.guests ?? []).map(mapArrivalRow),
      },
      {
        heading: 'Departures',
        rows: (data.checkInOut.departures?.guests ?? []).map(mapDepartureRow),
      },
    ],
    { ...meta, tab: 'summary' }
  )
}

export async function downloadBusinessDaySummaryPdf(
  data: BusinessDaySummaryData,
  meta: Omit<BusinessDayExportMeta, 'tab'>
): Promise<void> {
  const collections = data.collections
  const salesRows = salesSummaryRows(data.sales).map((r) => ({
    Category: String(r.Category),
    Amount: formatBdtForPdf(Number(r.Amount)),
  }))
  const collectionRows = collectionsSummaryRows(collections).map((r) => ({
    Metric: String(r.Metric),
    Amount: typeof r.Amount === 'number' ? formatBdtForPdf(r.Amount) : String(r.Amount),
  }))
  const movementRows = checkInOutSummaryRows(data.checkInOut).map((r) => ({
    Metric: String(r.Metric),
    Count: String(r.Count),
  }))
  const methodRows = (collections.byMethod ?? []).map((r) => ({
    Method: r.method,
    Amount: formatBdtForPdf(r.amount),
  }))

  await writePdfTable(
    TAB_TITLES.summary,
    [
      {
        heading: 'Sales',
        columns: [
          { header: 'Category', width: 40, value: (r) => String(r.Category) },
          { header: 'Amount', width: 25, value: (r) => String(r.Amount), align: 'right' },
        ],
        rows: salesRows,
      },
      {
        heading: 'Collections',
        columns: [
          { header: 'Metric', width: 35, value: (r) => String(r.Metric) },
          { header: 'Amount', width: 25, value: (r) => String(r.Amount), align: 'right' },
        ],
        rows: collectionRows,
      },
      {
        heading: 'Collections by method',
        columns: [
          { header: 'Method', width: 35, value: (r) => String(r.Method) },
          { header: 'Amount', width: 25, value: (r) => String(r.Amount), align: 'right' },
        ],
        rows: methodRows,
      },
      {
        heading: 'Check-in / Check-out',
        columns: [
          { header: 'Metric', width: 40, value: (r) => String(r.Metric) },
          { header: 'Count', width: 20, value: (r) => String(r.Count), align: 'right' },
        ],
        rows: movementRows,
      },
    ],
    { ...meta, tab: 'summary' }
  )
}

function discountDetailRows(data: DiscountReportData): Array<Record<string, string | number>> {
  return (data.lines ?? []).map((line) => ({
    Time: formatIsoDateTime(line.at),
    Purpose: line.purpose,
    Reference: line.reference,
    Guest: line.guestName ?? '',
    Room: line.roomNumber ?? '',
    Detail: line.detail ?? '',
    Company: line.company ?? '',
    'Gross amount': line.grossAmount,
    Discount: line.discountAmount,
    'Net amount': line.netAmount,
  }))
}

function discountSummaryRows(data: DiscountReportData): Array<Record<string, string | number>> {
  const summary = data.summary ?? {}
  return [
    { Metric: 'Hotel invoice discounts', Amount: summary.hotelDiscountTotal ?? 0 },
    { Metric: 'Restaurant POS discounts', Amount: summary.restaurantDiscountTotal ?? 0 },
    { Metric: 'Total discount', Amount: summary.totalDiscount ?? 0 },
    { Metric: 'Hotel discount lines', Count: summary.hotelCount ?? 0 },
    { Metric: 'Restaurant discount lines', Count: summary.restaurantCount ?? 0 },
    { Metric: 'Total lines', Count: summary.lineCount ?? 0 },
  ]
}

export async function downloadBusinessDayDiscountsExcel(
  data: DiscountReportData,
  meta: Omit<BusinessDayExportMeta, 'tab'>
): Promise<void> {
  await writeExcelWorkbook(
    TAB_TITLES.discounts,
    [
      { heading: 'Summary', rows: discountSummaryRows(data) },
      { heading: 'Discount transactions', rows: discountDetailRows(data) },
    ],
    { ...meta, tab: 'discounts' }
  )
}

export async function downloadBusinessDayDiscountsPdf(
  data: DiscountReportData,
  meta: Omit<BusinessDayExportMeta, 'tab'>
): Promise<void> {
  const summaryRows = discountSummaryRows(data).map((r) => ({
    Metric: String(r.Metric),
    Value:
      'Amount' in r
        ? formatBdtForPdf(Number(r.Amount))
        : String(r.Count ?? ''),
  }))
  const detailRows = discountDetailRows(data).map((r) => ({
    Time: String(r.Time),
    Purpose: String(r.Purpose),
    Reference: String(r.Reference),
    Guest: String(r.Guest),
    Room: String(r.Room),
    Detail: String(r.Detail),
    Company: String(r.Company),
    Gross: formatBdtForPdf(Number(r['Gross amount'])),
    Discount: formatBdtForPdf(Number(r.Discount)),
    Net: formatBdtForPdf(Number(r['Net amount'])),
  }))

  await writePdfTable(
    TAB_TITLES.discounts,
    [
      {
        heading: 'Summary',
        columns: [
          { header: 'Metric', width: 45, value: (r) => String(r.Metric) },
          { header: 'Value', width: 25, value: (r) => String(r.Value), align: 'right' },
        ],
        rows: summaryRows,
      },
      {
        heading: 'Discount transactions',
        columns: [
          { header: 'Time', width: 28, value: (r) => String(r.Time) },
          { header: 'Purpose', width: 22, value: (r) => String(r.Purpose) },
          { header: 'Ref', width: 18, value: (r) => String(r.Reference) },
          { header: 'Guest', width: 20, value: (r) => String(r.Guest) },
          { header: 'Room', width: 10, value: (r) => String(r.Room) },
          { header: 'Detail', width: 24, value: (r) => String(r.Detail) },
          { header: 'Company', width: 18, value: (r) => String(r.Company) },
          { header: 'Discount', width: 14, value: (r) => String(r.Discount), align: 'right' },
          { header: 'Net', width: 16, value: (r) => String(r.Net), align: 'right' },
        ],
        rows: detailRows,
      },
    ],
    { ...meta, tab: 'discounts' }
  )
}

function mapPoliceGuestRow(
  g: NonNullable<PoliceReportData['guests']>[number],
  includeBusinessDate: boolean
): Record<string, string> {
  const row: Record<string, string> = {
    'Guest name': String(g.guestName ?? ''),
    Mobile: String(g.mobile ?? '—'),
    'NID / Passport / License': String(g.idDocument ?? '—'),
    Address: String(g.address ?? '—'),
    Nationality: String(g.nationality ?? '—'),
    Company: String(g.company ?? '—'),
    Room: String(g.roomNumber ?? ''),
    'Checked-in date & time': String(g.checkInAtDisplay ?? '—'),
  }
  if (includeBusinessDate) {
    row['Business date'] = g.businessDate
      ? formatBusinessDateDisplay(g.businessDate)
      : '—'
  }
  return row
}

function policePdfColumns(includeBusinessDate: boolean): PdfColumn[] {
  const columns: PdfColumn[] = [
    { header: 'Guest name', width: 26, value: (r) => String(r['Guest name']) },
    { header: 'Mobile', width: 16, value: (r) => String(r.Mobile) },
    { header: 'NID / Passport / License', width: 24, value: (r) => String(r['NID / Passport / License']) },
    { header: 'Address', width: 24, value: (r) => String(r.Address) },
    { header: 'Nationality', width: 12, value: (r) => String(r.Nationality) },
    { header: 'Company', width: 16, value: (r) => String(r.Company) },
    { header: 'Room', width: 10, value: (r) => String(r.Room) },
    { header: 'Checked-in date & time', width: 20, value: (r) => String(r['Checked-in date & time']) },
  ]
  if (includeBusinessDate) {
    columns.splice(7, 0, {
      header: 'Business date',
      width: 14,
      value: (r) => String(r['Business date']),
    })
  }
  return columns
}

export async function downloadBusinessDayPoliceExcel(
  data: PoliceReportData,
  meta: Omit<BusinessDayExportMeta, 'tab'>
): Promise<void> {
  const guests = data.guests ?? []
  const includeBusinessDate = isPoliceReportDateRange(data)
  await writeInHouseBookingExcelWorkbook(
    [
      {
        heading: `Guests in-house (${data.totalCheckIns ?? 0} booking(s), ${data.guestCount ?? guests.length} guest(s))`,
        rows: guests.map((guest) => mapPoliceGuestRow(guest, includeBusinessDate)),
      },
    ],
    meta
  )
}

export async function downloadBusinessDayPolicePdf(
  data: PoliceReportData,
  meta: Omit<BusinessDayExportMeta, 'tab'>
): Promise<void> {
  const guests = data.guests ?? []
  const includeBusinessDate = isPoliceReportDateRange(data)
  const rows = guests.map((guest) => mapPoliceGuestRow(guest, includeBusinessDate))
  await writeInHouseBookingPdf(
    [
      {
        heading: `Guests in-house (${data.totalCheckIns ?? 0} booking(s), ${data.guestCount ?? guests.length} guest(s))`,
        columns: policePdfColumns(includeBusinessDate),
        rows,
      },
    ],
    meta
  )
}
