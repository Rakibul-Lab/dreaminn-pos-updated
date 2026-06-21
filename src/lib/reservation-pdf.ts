import { jsPDF } from 'jspdf'
import { domToPng } from 'modern-screenshot'
import { getLogoDataUrl } from './reservation-document-html'
import type { ReservationPdfData } from './reservation-pdf-data'

export type { ReservationPdfData } from './reservation-pdf-data'

/** A4 width at 96dpi — enough for sharp text without oversized captures */
const A4_WIDTH_PX = 794
const A4_HEIGHT_PX = 1123
/** Higher scale on text page keeps labels and terms sharp in the PDF */
const CAPTURE_SCALE_TEXT_PAGE = 2.25
const CAPTURE_SCALE_ATTACHMENT_PAGE = 1.75
const MAX_PAGE_IMAGE_WIDTH_TEXT = 2400
const MAX_PAGE_IMAGE_WIDTH_ATTACHMENT = 1588
const ID_IMAGE_MAX_EDGE = 1400
const ID_IMAGE_JPEG_QUALITY = 0.86
const JPEG_QUALITY_TEXT_PAGE = 0.96
const JPEG_QUALITY_ATTACHMENT_PAGE = 0.9

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = src
  })
}

/** Resize and re-encode as JPEG to shrink PNG captures before embedding in PDF */
async function toCompressedJpegDataUrl(
  dataUrl: string,
  quality: number,
  maxWidth = MAX_PAGE_IMAGE_WIDTH
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

async function compressImageSrc(
  src: string,
  maxEdge: number,
  quality: number
): Promise<string> {
  const img = await loadImage(src)
  let w = img.naturalWidth || img.width
  let h = img.naturalHeight || img.height
  const edge = Math.max(w, h)
  if (edge > maxEdge) {
    const scale = maxEdge / edge
    w = Math.round(w * scale)
    h = Math.round(h * scale)
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return src

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', quality)
}

function addJpegToPdfPage(
  pdf: jsPDF,
  jpegDataUrl: string,
  img: HTMLImageElement,
  isFirstPage: boolean
) {
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const maxW = pageWidth
  const maxH = pageHeight

  const scaledHeight = (img.height * maxW) / img.width

  if (scaledHeight <= maxH + 0.5) {
    if (!isFirstPage) pdf.addPage()
    pdf.addImage(jpegDataUrl, 'JPEG', 0, 0, maxW, scaledHeight, undefined, 'FAST')
    return
  }

  const pageCount = Math.ceil(scaledHeight / maxH)
  const sourceSliceHeight = img.height / pageCount

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    if (!isFirstPage || pageIndex > 0) pdf.addPage()

    const sourceY = Math.round(pageIndex * sourceSliceHeight)
    const sourceH =
      pageIndex === pageCount - 1
        ? img.height - sourceY
        : Math.round(sourceSliceHeight)

    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = sourceH
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      pdf.addImage(jpegDataUrl, 'JPEG', 0, 0, maxW, maxH, undefined, 'FAST')
      continue
    }

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, sourceY, img.width, sourceH, 0, 0, img.width, sourceH)

    const sliceJpeg = canvas.toDataURL('image/jpeg', JPEG_QUALITY_TEXT_PAGE)
    const sliceHeightMm = (sourceH * maxW) / img.width
    pdf.addImage(sliceJpeg, 'JPEG', 0, 0, maxW, sliceHeightMm, undefined, 'FAST')
  }
}

async function embedImagesAsDataUrls(root: HTMLElement): Promise<() => void> {
  const originals: { img: HTMLImageElement; src: string }[] = []
  const logoDataUrl = await getLogoDataUrl().catch(() => null)

  const images = Array.from(root.querySelectorAll('img'))

  for (const img of images) {
    originals.push({ img, src: img.src })

    if (logoDataUrl && (img.src.includes('brand-logo') || img.alt.includes('Dream Inn'))) {
      img.src = logoDataUrl
      continue
    }

    if (img.classList.contains('rd-id-attachment-img') && img.src) {
      try {
        img.src = await compressImageSrc(img.src, ID_IMAGE_MAX_EDGE, ID_IMAGE_JPEG_QUALITY)
      } catch {
        // keep original if compression fails
      }
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

function collectCaptureElements(root: HTMLElement): HTMLElement[] {
  const sheets = Array.from(root.querySelectorAll<HTMLElement>('.reservation-a4-sheet'))
  if (sheets.length > 0) return sheets
  return [root]
}

function isAttachmentSheet(element: HTMLElement): boolean {
  return element.classList.contains('reservation-a4-sheet--attachments')
}

function isEntryFillSheet(element: HTMLElement): boolean {
  return element.classList.contains('reservation-a4-sheet--entry')
}

async function captureElementJpeg(
  element: HTMLElement
): Promise<{ dataUrl: string; img: HTMLImageElement }> {
  const prevWidth = element.style.width
  const prevMaxWidth = element.style.maxWidth
  const prevMinHeight = element.style.minHeight
  const prevHeight = element.style.height
  const prevBoxSizing = element.style.boxSizing
  const isAttachment = isAttachmentSheet(element)

  element.style.boxSizing = 'border-box'
  element.style.width = `${A4_WIDTH_PX}px`
  element.style.maxWidth = `${A4_WIDTH_PX}px`

  const contentHeight = element.scrollHeight
  const entryFill = isEntryFillSheet(element)
  const captureHeight = isAttachment
    ? contentHeight
    : entryFill
      ? A4_HEIGHT_PX
      : Math.max(A4_HEIGHT_PX, contentHeight)

  if (!isAttachment) {
    element.style.minHeight = `${captureHeight}px`
    element.style.height = `${captureHeight}px`
  }

  element.classList.add('reservation-pdf-capture')

  const captureScale = isAttachment ? CAPTURE_SCALE_ATTACHMENT_PAGE : CAPTURE_SCALE_TEXT_PAGE
  const jpegQuality = isAttachment ? JPEG_QUALITY_ATTACHMENT_PAGE : JPEG_QUALITY_TEXT_PAGE
  const maxPageWidth = isAttachment ? MAX_PAGE_IMAGE_WIDTH_ATTACHMENT : MAX_PAGE_IMAGE_WIDTH_TEXT

  try {
    await waitForImages(element)
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

    const pngDataUrl = await domToPng(element, {
      scale: captureScale,
      backgroundColor: '#ffffff',
      width: A4_WIDTH_PX,
      height: captureHeight,
      timeout: 60_000,
    })

    const jpegDataUrl = await toCompressedJpegDataUrl(pngDataUrl, jpegQuality, maxPageWidth)
    const img = await loadImage(jpegDataUrl)
    return { dataUrl: jpegDataUrl, img }
  } finally {
    element.classList.remove('reservation-pdf-capture')
    element.style.width = prevWidth
    element.style.maxWidth = prevMaxWidth
    element.style.minHeight = prevMinHeight
    element.style.height = prevHeight
    element.style.boxSizing = prevBoxSizing
  }
}

export async function buildReservationPdfFromElement(element: HTMLElement): Promise<jsPDF> {
  const restoreImages = await embedImagesAsDataUrls(element)
  const pages = collectCaptureElements(element)

  try {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })

    for (let i = 0; i < pages.length; i++) {
      const { dataUrl, img } = await captureElementJpeg(pages[i]!)
      addJpegToPdfPage(pdf, dataUrl, img, i === 0)
    }

    return pdf
  } finally {
    restoreImages()
  }
}

export async function downloadReservationPdfFromElement(
  element: HTMLElement,
  fileName: string
): Promise<void> {
  const pdf = await buildReservationPdfFromElement(element)
  pdf.save(fileName)
}

/** Opens the document PDF in a new browser tab (native PDF viewer + print). */
export async function openReservationPdfInNewTab(
  element: HTMLElement,
  fileName: string
): Promise<boolean> {
  const pdf = await buildReservationPdfFromElement(element)
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

export async function downloadReservationPdf(
  _data: ReservationPdfData,
  fileName: string
): Promise<void> {
  const el =
    document.getElementById('reservation-document-root') ||
    document.getElementById('reservation-document-article')
  if (!el) throw new Error('Reservation document not visible')
  await downloadReservationPdfFromElement(el, fileName)
}
