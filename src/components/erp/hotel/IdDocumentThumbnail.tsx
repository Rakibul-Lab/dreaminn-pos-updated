'use client'

import { ExternalLink, FileText, X } from 'lucide-react'
import { isIdDocumentPdf, resolveIdDocumentHref } from '@/lib/id-document-upload'

type IdDocumentThumbnailProps = {
  previewUrl: string
  path: string
  index: number
  onRemove?: () => void
  className?: string
  imageClassName?: string
  showCaption?: boolean
}

export function IdDocumentThumbnail({
  previewUrl,
  path,
  index,
  onRemove,
  className = 'relative rounded border bg-card p-1',
  imageClassName = 'h-24 w-full rounded object-contain',
  showCaption = true,
}: IdDocumentThumbnailProps) {
  const src = previewUrl || path
  const isPdf = isIdDocumentPdf(path) || isIdDocumentPdf(previewUrl)
  const openUrl = resolveIdDocumentHref(path, previewUrl)

  return (
    <div className={className}>
      {onRemove ? (
        <button
          type="button"
          className="absolute -right-1 -top-1 z-20 rounded-full bg-red-600 p-0.5 text-white shadow"
          onClick={onRemove}
          aria-label="Remove document"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}

      <a
        href={openUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={isPdf ? 'Open PDF in new tab' : 'Open image in new tab'}
        className="group block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        {isPdf ? (
          <div className="relative flex h-24 w-full flex-col overflow-hidden rounded bg-muted/40">
            <div className="flex items-center justify-between gap-1 border-b bg-muted/60 px-1.5 py-0.5">
              <div className="flex min-w-0 items-center gap-1">
                <FileText className="h-3 w-3 shrink-0 text-red-600" />
                <span className="truncate text-[9px] font-medium text-foreground">PDF</span>
              </div>
              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-amber-700" />
            </div>
            <iframe
              src={`${src}#toolbar=0&navpanes=0`}
              title={`ID PDF ${index + 1}`}
              className="pointer-events-none min-h-0 flex-1 w-full bg-white"
            />
            <div
              className="absolute inset-0 top-5 cursor-pointer bg-transparent group-hover:bg-amber-500/5"
              aria-hidden
            />
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={`ID ${index + 1}`}
            className={`${imageClassName} cursor-pointer transition-opacity group-hover:opacity-90`}
          />
        )}
      </a>

      {showCaption ? (
        <p className="mt-1 text-center text-[10px] text-muted-foreground">
          {isPdf ? `PDF ${index + 1}` : `Image ${index + 1}`}
          <span className="block text-[9px] text-amber-700/80">Click to open</span>
        </p>
      ) : null}
    </div>
  )
}
