'use client'

import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Camera, FileUp, Loader2, ScanLine, Scan } from 'lucide-react'
import { GuestIdTypeField } from '@/components/erp/hotel/GuestIdTypeField'
import { mergeIdFields, hasMinimumScanData, type ExtractedIdFields, type IdDocumentType } from '@/lib/id-ocr'
import { tryDecodeNidBarcode } from '@/lib/id-barcode'
import {
  ID_DOCUMENT_ACCEPT,
  ID_DOCUMENT_MAX_BYTES,
  isAllowedIdDocumentFile,
  isIdDocumentPdf,
} from '@/lib/id-document-upload'
import { IdDocumentThumbnail } from '@/components/erp/hotel/IdDocumentThumbnail'
import { isBangladeshNationality } from '@/lib/id-type-label'

export interface IdDocumentItem {
  path: string
  previewUrl: string
}

export interface IdScanResult {
  name?: string
  idNumber?: string
  idType?: IdDocumentType
  idDocPaths: string[]
  documents: IdDocumentItem[]
}

interface IdDocumentScannerProps {
  nationality?: string
  idType: IdDocumentType
  onIdTypeChange: (type: IdDocumentType) => void
  documents: IdDocumentItem[]
  onDocumentsChange: (documents: IdDocumentItem[]) => void
  onScanComplete: (result: IdScanResult) => void
}

const MAX_FILES = 12

export function IdDocumentScanner({
  nationality = 'Bangladesh',
  idType,
  onIdTypeChange,
  documents,
  onDocumentsChange,
  onScanComplete,
}: IdDocumentScannerProps) {
  const scannerInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [scanEnabled, setScanEnabled] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanMessage, setScanMessage] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null)

  const emitResult = useCallback(
    (parsed: ExtractedIdFields, paths: string[], docs: IdDocumentItem[]) => {
      onScanComplete({
        name: parsed.name,
        idNumber: parsed.idNumber,
        idType: parsed.idType || idType,
        idDocPaths: paths,
        documents: docs,
      })
    },
    [idType, onScanComplete]
  )

  const prepareUploadFile = async (file: File): Promise<File> => {
    if (isIdDocumentPdf(file.name) || file.type === 'application/pdf') return file
    if (file.size <= 2 * 1024 * 1024) return file

    const url = URL.createObjectURL(file)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = reject
        el.src = url
      })

      const maxEdge = 2000
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return file
      ctx.drawImage(img, 0, 0, w, h)

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.88)
      )
      if (!blob) return file
      return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
    } catch {
      return file
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const uploadOnly = async (file: File): Promise<{ path: string; previewUrl: string }> => {
    const { getAuthHeaders } = await import('@/lib/api-client')
    const headers = getAuthHeaders(false)
    const uploadFile = await prepareUploadFile(file)
    const form = new FormData()
    form.append('file', uploadFile)

    const res = await fetch('/api/upload/id-document', {
      method: 'POST',
      headers,
      body: form,
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.error || 'Upload failed')
    const path = json.data.path as string
    return { path, previewUrl: URL.createObjectURL(file) }
  }

  const ocrUpload = async (
    file: File,
    barcodeHint: Partial<ExtractedIdFields> | null
  ): Promise<{ path: string; previewUrl: string; fields: ExtractedIdFields }> => {
    const { getAuthHeaders } = await import('@/lib/api-client')
    const headers = getAuthHeaders(false)
    const uploadFile = await prepareUploadFile(file)
    const form = new FormData()
    form.append('file', uploadFile)
    form.append('idType', idType)

    const res = await fetch('/api/ocr/id-document', {
      method: 'POST',
      headers,
      body: form,
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.error || 'OCR failed')

    const fields = json.data.fields as {
      name: string | null
      idNumber: string | null
      idType?: IdDocumentType
    }

    const serverParsed: ExtractedIdFields = {
      name: fields.name ?? undefined,
      idNumber: fields.idNumber ?? undefined,
      idType: fields.idType ?? idType,
      rawText: '',
    }

    return {
      path: json.data.path as string,
      previewUrl: URL.createObjectURL(file),
      fields: mergeIdFields(barcodeHint, serverParsed),
    }
  }

  const processFiles = useCallback(
    async (files: File[]) => {
      const valid = files.filter(isAllowedIdDocumentFile)
      if (valid.length === 0) {
        toast.error('Please choose image or PDF files (JPEG, PNG, WebP, or PDF)')
        return
      }

      const remaining = MAX_FILES - documents.length
      if (remaining <= 0) {
        toast.error(`Maximum ${MAX_FILES} ID documents allowed`)
        return
      }

      const batch = valid.slice(0, remaining)
      if (batch.some((f) => f.size > ID_DOCUMENT_MAX_BYTES)) {
        toast.error('Each file must be under 10MB')
        return
      }

      setScanning(true)
      let merged: ExtractedIdFields = { rawText: '', idType }
      const newDocs: IdDocumentItem[] = [...documents]

      try {
        for (let i = 0; i < batch.length; i++) {
          const file = batch[i]!
          const isPdf = isIdDocumentPdf(file.name) || file.type === 'application/pdf'

          if (!scanEnabled || isPdf) {
            setScanMessage(`Uploading ${i + 1} of ${batch.length}…`)
            const uploaded = await uploadOnly(file)
            newDocs.push(uploaded)
            continue
          }

          setScanMessage(`Processing ${i + 1} of ${batch.length}…`)

          let barcodeHint: Partial<ExtractedIdFields> | null = null
          if (idType === 'national_id' && isBangladeshNationality(nationality)) {
            barcodeHint = await tryDecodeNidBarcode(file)
          }

          const useOcr = !hasMinimumScanData(merged)
          if (useOcr) {
            setScanMessage(`Reading name & ID (${i + 1}/${batch.length})…`)
            const result = await ocrUpload(file, barcodeHint)
            merged = mergeIdFields(merged, result.fields)
            newDocs.push({ path: result.path, previewUrl: result.previewUrl })
          } else {
            setScanMessage(`Saving image ${i + 1} of ${batch.length}…`)
            const uploaded = await uploadOnly(file)
            newDocs.push(uploaded)
          }
        }

        onDocumentsChange(newDocs)
        emitResult(merged, newDocs.map((d) => d.path), newDocs)

        if (!scanEnabled) {
          toast.success(`${batch.length} file(s) attached`, {
            description: 'Scan is off — files saved only. Enter name and ID manually below.',
          })
        } else {
          const parts: string[] = []
          if (merged.name) parts.push('Name')
          if (merged.idNumber) parts.push('ID number')

          if (hasMinimumScanData(merged)) {
            toast.success(`${newDocs.length} image(s) saved`, {
              description: `Filled: ${parts.join(', ')}. Attached to reservation page 2.`,
            })
          } else if (parts.length > 0) {
            toast.warning('Partial read — verify name & ID below', {
              description: `${newDocs.length} image(s) saved for the reservation file.`,
            })
          } else {
            toast.success(`${newDocs.length} image(s) attached`, {
              description: 'Enter name and ID manually if needed. Images appear on reservation page 2.',
            })
          }
        }
      } catch (err) {
        console.error(err)
        toast.error(err instanceof Error ? err.message : 'Failed to process documents')
      } finally {
        setScanning(false)
        setScanMessage('')
      }
    },
    [documents, idType, scanEnabled, emitResult, onDocumentsChange]
  )

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return
    await processFiles(Array.from(fileList))
  }

  const removeDocument = (index: number) => {
    const next = documents.filter((_, i) => i !== index)
    onDocumentsChange(next)
    if (next.length > 0) {
      onScanComplete({
        idDocPaths: next.map((d) => d.path),
        documents: next,
        idType,
      })
    }
  }

  const openCamera = async () => {
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      setStream(media)
      setCameraOpen(true)
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = media
          void videoRef.current.play()
        }
      }, 100)
    } catch {
      toast.error('Camera not available', {
        description: 'Use Scan/Upload or Choose file to add ID images.',
      })
    }
  }

  const closeCamera = () => {
    stream?.getTracks().forEach((t) => t.stop())
    setStream(null)
    setCameraOpen(false)
  }

  const captureFromCamera = async () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    closeCamera()

    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const file = new File([blob], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' })
        void processFiles([file])
      },
      'image/jpeg',
      0.95
    )
  }

  return (
    <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/40 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
          <ScanLine className="h-4 w-4" />
          ID documents
        </div>
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-card px-2 py-1">
          <Label htmlFor="id-scan-toggle" className="text-xs font-medium text-foreground cursor-pointer">
            Scan
          </Label>
          <Switch
            id="id-scan-toggle"
            checked={scanEnabled}
            onCheckedChange={setScanEnabled}
            disabled={scanning}
            aria-label="Toggle ID scan"
          />
          <span className="text-xs font-medium text-amber-800 min-w-[22px]">
            {scanEnabled ? 'On' : 'Off'}
          </span>
        </div>
      </div>

      <GuestIdTypeField
        nationality={nationality}
        idType={idType}
        onIdTypeChange={onIdTypeChange}
      />

      <input
        ref={scannerInputRef}
        type="file"
        accept={ID_DOCUMENT_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files)
          e.target.value = ''
        }}
      />

      <input
        id="id-camera-capture"
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files)
          e.target.value = ''
        }}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="bg-amber-600 hover:bg-amber-700 text-white"
          disabled={scanning || documents.length >= MAX_FILES}
          onClick={() => scannerInputRef.current?.click()}
        >
          {scanning ? (
            <>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              {scanMessage || 'Processing…'}
            </>
          ) : (
            <>
              <Scan className="h-4 w-4 mr-1" />
              {scanEnabled ? 'Scan / Upload' : 'Upload'}
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="bg-card"
          disabled={scanning || documents.length >= MAX_FILES}
          onClick={() => void openCamera()}
        >
          <Camera className="h-4 w-4 mr-1" />
          Camera
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="bg-card"
          disabled={scanning || documents.length >= MAX_FILES}
          onClick={() => scannerInputRef.current?.click()}
        >
          <FileUp className="h-4 w-4 mr-1" />
          Choose files
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {scanEnabled ? (
          <>
            <strong>Scan on:</strong> reads <strong>name</strong> and <strong>ID number</strong> from
            images (OCR). PDF files are saved without OCR. All documents are stored on{' '}
            <strong>page 2</strong> of the confirmation.
          </>
        ) : (
          <>
            <strong>Scan off:</strong> only saves uploaded images/PDFs — enter name and ID manually below.
            Documents appear on <strong>page 2</strong> of the confirmation.
          </>
        )}
      </p>

      {documents.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {documents.map((doc, index) => (
            <IdDocumentThumbnail
              key={doc.path}
              previewUrl={doc.previewUrl}
              path={doc.path}
              index={index}
              onRemove={() => removeDocument(index)}
            />
          ))}
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />

      <Dialog open={cameraOpen} onOpenChange={(open) => !open && closeCamera()}>
        <DialogContent className="max-w-lg p-0 overflow-hidden">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Capture ID document</DialogTitle>
          </DialogHeader>
          <div className="p-4 space-y-3">
            <video
              ref={videoRef}
              className="w-full rounded-lg bg-black aspect-video object-cover"
              muted
              playsInline
            />
            <Button
              className="w-full bg-amber-600 hover:bg-amber-700"
              disabled={scanning}
              onClick={() => void captureFromCamera()}
            >
              Capture &amp; add
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
