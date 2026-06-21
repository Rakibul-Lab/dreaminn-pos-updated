import { jsPDF } from 'jspdf'
import { domToPng } from 'modern-screenshot'
import { getLogoDataUrl } from './reservation-document-html'

/** A4 width at 96 CSS px — standard document width */
const A4_WIDTH_PX = 794
/** ~300 DPI equivalent width for A4 (8.27 in × 300) */
const MAX_CAPTURE_WIDTH_PX = 2480
const CAPTURE_SCALE = 3
const JPEG_QUALITY = 0.96
const PAGE_MARGIN_MM = 8
const HEADER_BODY_GAP_MM = 2
const SLICE_ALIGN_TOLERANCE_CSS = 4

type CapturedElement = {
  img: HTMLImageElement
  jpegDataUrl: string
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = src
  })
}

async function toCompressedJpegDataUrl(
  dataUrl: string,
  quality: number,
  maxWidth = MAX_CAPTURE_WIDTH_PX
): Promise<string> {
  const img = await loadImage(dataUrl)
  let w = img.naturalWidth || img.width
  let h = img.naturalHeight || img.height
  if (w > maxWidth) {
    h = Math.round((h * maxWidth) / w)
    w = maxWidth
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', quality)
}

async function embedImagesAsDataUrls(root: HTMLElement): Promise<() => void> {
  const originals: { img: HTMLImageElement; src: string }[] = []
  const logoDataUrl = await getLogoDataUrl().catch(() => null)

  for (const img of Array.from(root.querySelectorAll('img'))) {
    originals.push({ img, src: img.src })
    if (logoDataUrl && (img.src.includes('brand-logo') || img.alt.includes('Dream Inn'))) {
      img.src = logoDataUrl
    }
  }

  return () => {
    originals.forEach(({ img, src }) => {
      img.src = src
    })
  }
}

function waitForImages(root: ParentNode): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'))
  if (images.length === 0) return Promise.resolve()

  return Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) resolve()
          else {
            img.onload = () => resolve()
            img.onerror = () => resolve()
          }
        })
    )
  ).then(() => undefined)
}

function sliceImageToDataUrl(
  img: HTMLImageElement,
  sourceY: number,
  sourceH: number
): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = sourceH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, sourceY, img.width, sourceH, 0, 0, img.width, sourceH)
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
}

function displayHeight(img: HTMLImageElement, displayW: number): number {
  return (img.height * displayW) / img.width
}

/** Source pixels that fit within a given display height at the target width. */
function sourceHeightForDisplay(img: HTMLImageElement, displayW: number, displayH: number): number {
  return Math.max(1, Math.round((displayH * img.width) / displayW))
}

function bodyCssHeight(bodyEl: HTMLElement): number {
  return Math.max(bodyEl.scrollHeight, bodyEl.getBoundingClientRect().height)
}

/** Safe horizontal breaks — table row edges and major sections (CSS px in body). */
function collectBodyBreakPointsCss(bodyEl: HTMLElement): number[] {
  const bodyTop = bodyEl.getBoundingClientRect().top
  const points = new Set<number>([0])

  const selectors = [
    '.invoice-charge-section',
    '.invoice-pdf-summary',
    '.invoice-print-footer',
    '.invoice-charge-table thead',
    '.invoice-charge-table tbody tr',
  ]

  for (const el of bodyEl.querySelectorAll(selectors.join(','))) {
    const rect = el.getBoundingClientRect()
    const top = Math.round(rect.top - bodyTop)
    const bottom = Math.round(rect.bottom - bodyTop)
    if (top > 0) points.add(top)
    points.add(bottom)
  }

  points.add(bodyCssHeight(bodyEl))
  return Array.from(points)
    .filter((p) => p >= 0)
    .sort((a, b) => a - b)
}

function alignSliceEnd(
  breakPoints: number[],
  startY: number,
  idealEnd: number,
  maxEnd: number
): number {
  const minSlice = 20
  let aligned = Math.min(idealEnd, maxEnd)
  for (const point of breakPoints) {
    if (point <= startY + minSlice) continue
    if (point <= idealEnd) aligned = point
    else break
  }
  if (aligned <= startY) aligned = Math.min(idealEnd, maxEnd)
  return aligned
}

function planSliceEndsCss(
  breakPoints: number[],
  totalHeight: number,
  sliceMaxCss: number
): number[] {
  if (totalHeight <= 0 || sliceMaxCss <= 0) return [totalHeight]

  const ends: number[] = []
  let y = 0
  while (y < totalHeight) {
    const ideal = Math.min(y + sliceMaxCss, totalHeight)
    const next = alignSliceEnd(breakPoints, y, ideal, totalHeight)
    const end = next > y ? next : ideal
    ends.push(end)
    y = end
    if (end >= totalHeight) break
  }
  return ends
}

/** Repeat charge table headers before rows that start a new PDF page. */
function insertContinuationTableHeaders(
  bodyEl: HTMLElement,
  sliceEndCssPositions: number[]
): () => void {
  const bodyTop = bodyEl.getBoundingClientRect().top
  const inserted: HTMLElement[] = []

  for (const sliceEnd of sliceEndCssPositions.slice(0, -1)) {
    const rows = Array.from(
      bodyEl.querySelectorAll('.invoice-charge-table tbody tr.invoice-charge-row')
    )

    for (const tr of rows) {
      const top = Math.round(tr.getBoundingClientRect().top - bodyTop)
      if (Math.abs(top - sliceEnd) > SLICE_ALIGN_TOLERANCE_CSS) continue

      const table = tr.closest('table')
      const thead = table?.querySelector('thead')
      const firstRow = table?.querySelector('tbody tr.invoice-charge-row')
      if (!thead || !tr.parentElement || tr === firstRow) break

      const wrapper = document.createElement('div')
      wrapper.className = 'invoice-continuation-thead-wrap'
      wrapper.setAttribute('data-pdf-inserted', 'true')

      const miniTable = document.createElement('table')
      miniTable.className = table.className
      miniTable.appendChild(thead.cloneNode(true))
      wrapper.appendChild(miniTable)
      tr.parentElement.insertBefore(wrapper, tr)
      inserted.push(wrapper)
      break
    }
  }

  return () => {
    inserted.forEach((el) => el.remove())
  }
}

function addCapturedImageToPdf(pdf: jsPDF, img: HTMLImageElement, jpegDataUrl: string): void {
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = PAGE_MARGIN_MM
  const maxW = pageWidth - margin * 2
  const maxH = pageHeight - margin * 2

  const sliceHeightPx = sourceHeightForDisplay(img, maxW, maxH)
  let sourceY = 0
  let page = 0

  while (sourceY < img.height) {
    if (page > 0) pdf.addPage()

    const sourceH = Math.min(sliceHeightPx, img.height - sourceY)
    const sliceDataUrl = sliceImageToDataUrl(img, sourceY, sourceH)
    if (!sliceDataUrl) {
      pdf.addImage(
        jpegDataUrl,
        'JPEG',
        margin,
        margin,
        maxW,
        displayHeight(img, maxW),
        undefined,
        'SLOW'
      )
      return
    }

    const sliceDisplayH = (sourceH * maxW) / img.width
    pdf.addImage(sliceDataUrl, 'JPEG', margin, margin, maxW, sliceDisplayH, undefined, 'SLOW')
    sourceY += sourceH
    page += 1
  }
}

function addCapturedImageWithRepeatingHeader(
  pdf: jsPDF,
  header: CapturedElement,
  body: CapturedElement,
  breakPointsImg: number[],
  continuationHeader?: CapturedElement | null
): boolean {
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = PAGE_MARGIN_MM
  const maxW = pageWidth - margin * 2
  const maxH = pageHeight - margin * 2

  const headerDisplayH = displayHeight(header.img, maxW)
  const bodySliceMaxH = maxH - headerDisplayH - HEADER_BODY_GAP_MM

  if (bodySliceMaxH <= 12) {
    return false
  }

  const points = [...breakPointsImg, body.img.height].sort((a, b) => a - b)
  let sourceY = 0
  let page = 0

  while (sourceY < body.img.height) {
    if (page > 0) pdf.addPage()

    const activeHeader = page === 0 ? header : continuationHeader ?? header
    const activeHeaderH = displayHeight(activeHeader.img, maxW)
    const bodyY = margin + activeHeaderH + HEADER_BODY_GAP_MM
    const pageBodyMaxH = maxH - activeHeaderH - HEADER_BODY_GAP_MM

    const idealSlicePx = sourceHeightForDisplay(body.img, maxW, pageBodyMaxH)
    const idealEnd = Math.min(sourceY + idealSlicePx, body.img.height)
    const alignedEnd = alignSliceEnd(points, sourceY, idealEnd, body.img.height)
    const sourceH = Math.max(1, alignedEnd - sourceY)

    pdf.addImage(
      activeHeader.jpegDataUrl,
      'JPEG',
      margin,
      margin,
      maxW,
      activeHeaderH,
      undefined,
      'SLOW'
    )

    const sliceDataUrl = sliceImageToDataUrl(body.img, sourceY, sourceH)
    if (!sliceDataUrl) return false

    const sliceDisplayH = (sourceH * maxW) / body.img.width
    pdf.addImage(sliceDataUrl, 'JPEG', margin, bodyY, maxW, sliceDisplayH, undefined, 'SLOW')
    sourceY = alignedEnd
    page += 1
  }

  return true
}

function measureCaptureWidth(...elements: (HTMLElement | null | undefined)[]): number {
  const widths = elements
    .filter((el): el is HTMLElement => el != null)
    .map((el) => Math.round(el.getBoundingClientRect().width))
    .filter((w) => w > 0)
  return widths.length > 0 ? Math.max(...widths) : A4_WIDTH_PX
}

/** Trim empty white margin columns from a captured invoice screenshot. */
async function cropHorizontalWhitespace(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (!ctx || img.width === 0 || img.height === 0) return dataUrl

  ctx.drawImage(img, 0, 0)
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)

  const isContentPixel = (x: number, y: number) => {
    const i = (y * width + x) * 4
    const a = data[i + 3]
    if (a < 8) return false
    return data[i] < 248 || data[i + 1] < 248 || data[i + 2] < 248
  }

  let left = 0
  let right = width - 1

  while (left < width) {
    let columnHasContent = false
    for (let y = 0; y < height; y++) {
      if (isContentPixel(left, y)) {
        columnHasContent = true
        break
      }
    }
    if (columnHasContent) break
    left += 1
  }

  while (right >= left) {
    let columnHasContent = false
    for (let y = 0; y < height; y++) {
      if (isContentPixel(right, y)) {
        columnHasContent = true
        break
      }
    }
    if (columnHasContent) break
    right -= 1
  }

  const cropW = Math.max(1, right - left + 1)
  if (cropW >= width - 2) return dataUrl

  const cropped = document.createElement('canvas')
  cropped.width = cropW
  cropped.height = height
  const cropCtx = cropped.getContext('2d')
  if (!cropCtx) return dataUrl

  cropCtx.fillStyle = '#ffffff'
  cropCtx.fillRect(0, 0, cropW, height)
  cropCtx.drawImage(canvas, left, 0, cropW, height, 0, 0, cropW, height)
  return cropped.toDataURL('image/png')
}

async function captureElement(element: HTMLElement, captureWidth?: number): Promise<CapturedElement> {
  await waitForImages(element)

  const width =
    captureWidth ??
    (Math.round(element.getBoundingClientRect().width) || element.clientWidth || element.scrollWidth || A4_WIDTH_PX)

  const pngDataUrl = await domToPng(element, {
    scale: CAPTURE_SCALE,
    backgroundColor: '#ffffff',
    width,
    height: element.scrollHeight,
    timeout: 60_000,
  })

  const trimmedPng = await cropHorizontalWhitespace(pngDataUrl)
  const jpegDataUrl = await toCompressedJpegDataUrl(trimmedPng, JPEG_QUALITY, MAX_CAPTURE_WIDTH_PX)
  const img = await loadImage(jpegDataUrl)
  return { img, jpegDataUrl }
}

async function captureVisibleElement(
  element: HTMLElement,
  captureWidth?: number
): Promise<CapturedElement | null> {
  const prevDisplay = element.style.display
  const prevVisibility = element.style.visibility
  element.style.display = 'flex'
  element.style.visibility = 'visible'
  try {
    return await captureElement(element, captureWidth)
  } finally {
    element.style.display = prevDisplay
    element.style.visibility = prevVisibility
  }
}

export function invoicePdfFileName(invoiceNumber: string): string {
  const safe = invoiceNumber.replace(/[^\w-]+/g, '_')
  return `invoice-${safe}.pdf`
}

async function buildInvoicePdfFromElement(element: HTMLElement): Promise<jsPDF> {
  const sheet = element.querySelector('.invoice-a4-sheet') as HTMLElement | null
  const prevWidth = element.style.width
  const prevMaxWidth = element.style.maxWidth
  const prevBoxSizing = element.style.boxSizing
  const prevPadding = element.style.padding
  const prevMargin = element.style.margin
  const prevSheetWidth = sheet?.style.width ?? ''
  const prevSheetMaxWidth = sheet?.style.maxWidth ?? ''
  const prevSheetBoxSizing = sheet?.style.boxSizing ?? ''

  element.style.boxSizing = 'border-box'
  element.style.width = `${A4_WIDTH_PX}px`
  element.style.maxWidth = `${A4_WIDTH_PX}px`
  element.style.padding = '0'
  element.style.margin = '0'

  if (sheet) {
    sheet.style.boxSizing = 'border-box'
    sheet.style.width = `${A4_WIDTH_PX}px`
    sheet.style.maxWidth = `${A4_WIDTH_PX}px`
  }

  const restoreImages = await embedImagesAsDataUrls(element)

  try {
    await waitForImages(element)
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

    const headerEl = element.querySelector('.invoice-pdf-header') as HTMLElement | null
    const bodyEl = element.querySelector('.invoice-pdf-body') as HTMLElement | null
    const continuationHeaderEl = element.querySelector(
      '.invoice-pdf-continuation-header'
    ) as HTMLElement | null

    if (headerEl) {
      headerEl.style.width = '100%'
      headerEl.style.maxWidth = '100%'
      headerEl.style.boxSizing = 'border-box'
    }
    if (bodyEl) {
      bodyEl.style.width = '100%'
      bodyEl.style.maxWidth = '100%'
      bodyEl.style.boxSizing = 'border-box'
    }

    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

    const contentWidth = measureCaptureWidth(headerEl, bodyEl)

    const pdf = new jsPDF({
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait',
      compress: true,
    })

    if (headerEl && bodyEl) {
      const header = await captureElement(headerEl, contentWidth)

      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = PAGE_MARGIN_MM
      const maxW = pageWidth - margin * 2
      const maxH = pageHeight - margin * 2
      const headerDisplayH = displayHeight(header.img, maxW)
      const bodySliceMaxH = maxH - headerDisplayH - HEADER_BODY_GAP_MM
      const bodySliceMaxCss = (bodySliceMaxH * A4_WIDTH_PX) / maxW
      const sliceEndsCss = planSliceEndsCss(
        collectBodyBreakPointsCss(bodyEl),
        bodyCssHeight(bodyEl),
        bodySliceMaxCss
      )

      const removeContinuationHeaders = insertContinuationTableHeaders(bodyEl, sliceEndsCss)
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

      let continuationHeader: CapturedElement | null = null
      if (continuationHeaderEl) {
        continuationHeader = await captureVisibleElement(continuationHeaderEl, contentWidth)
      }

      const body = await captureElement(bodyEl, contentWidth)
      const cssHeight = bodyCssHeight(bodyEl)
      const cssToImg = cssHeight > 0 ? body.img.height / cssHeight : CAPTURE_SCALE
      const breakPointsImg = collectBodyBreakPointsCss(bodyEl).map((p) =>
        Math.round(p * cssToImg)
      )
      removeContinuationHeaders()

      const paginated = addCapturedImageWithRepeatingHeader(
        pdf,
        header,
        body,
        breakPointsImg,
        continuationHeader
      )
      if (!paginated) {
        const sheetEl = element.querySelector('.invoice-a4-sheet') as HTMLElement | null
        const captured = await captureElement(sheetEl ?? element, contentWidth)
        addCapturedImageToPdf(pdf, captured.img, captured.jpegDataUrl)
      }
    } else {
      const captured = await captureElement(element)
      addCapturedImageToPdf(pdf, captured.img, captured.jpegDataUrl)
    }

    return pdf
  } finally {
    restoreImages()
    element.style.width = prevWidth
    element.style.maxWidth = prevMaxWidth
    element.style.boxSizing = prevBoxSizing
    element.style.padding = prevPadding
    element.style.margin = prevMargin
    if (sheet) {
      sheet.style.width = prevSheetWidth
      sheet.style.maxWidth = prevSheetMaxWidth
      sheet.style.boxSizing = prevSheetBoxSizing
    }
  }
}

export async function downloadInvoicePdfFromElement(
  element: HTMLElement,
  fileName: string
): Promise<void> {
  const pdf = await buildInvoicePdfFromElement(element)
  pdf.save(fileName)
}

/** Opens the invoice PDF in a new browser tab (native PDF viewer + print). */
export async function openInvoicePdfInNewTab(
  element: HTMLElement,
  fileName: string
): Promise<boolean> {
  const pdf = await buildInvoicePdfFromElement(element)
  const blob = pdf.output('blob')
  const url = URL.createObjectURL(blob)
  const tab = window.open(url, '_blank', 'noopener,noreferrer')

  if (!tab) {
    URL.revokeObjectURL(url)
    return false
  }

  try {
    tab.document.title = fileName
  } catch {
    // Native PDF viewer tabs may not expose document.title
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000)
  return true
}
