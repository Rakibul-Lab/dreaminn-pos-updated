import { NextRequest } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { requireRole } from '@/lib/auth'
import { successResponse, errorResponse } from '@/lib/api-utils'
import { runServerIdOcr } from '@/lib/id-ocr-server'
import type { IdDocumentType } from '@/lib/id-ocr'
import {
  ID_DOCUMENT_MAX_BYTES,
  idDocumentFileExtension,
  isAllowedIdDocumentFile,
  isIdDocumentPdf,
} from '@/lib/id-document-upload'
import { RoleType } from '@prisma/client'

export const maxDuration = 120

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType)
    if (authResult instanceof Response) return authResult

    const formData = await request.formData()
    const file = formData.get('file')
    const idTypeRaw = formData.get('idType')

    if (!file || !(file instanceof File)) {
      return errorResponse('No file uploaded')
    }

    if (!isAllowedIdDocumentFile(file)) {
      return errorResponse('Only JPEG, PNG, WebP images, or PDF files are allowed')
    }

    if (file.size > ID_DOCUMENT_MAX_BYTES) {
      return errorResponse('File must be under 10MB')
    }

    const idType = (
      typeof idTypeRaw === 'string' ? idTypeRaw : 'national_id'
    ) as IdDocumentType

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const ext = idDocumentFileExtension(file)
    const fileName = `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'id-docs')
    const filePath = path.join(uploadDir, fileName)

    const isPdf = isIdDocumentPdf(file.name) || file.type === 'application/pdf'

    const [fields] = await Promise.all([
      isPdf
        ? Promise.resolve({
            name: undefined,
            idNumber: undefined,
            idType,
            rawText: '',
          })
        : runServerIdOcr(buffer, idType),
      mkdir(uploadDir, { recursive: true }).then(() => writeFile(filePath, buffer)),
    ])

    const publicPath = `/uploads/id-docs/${fileName}`

    return successResponse(
      {
        path: publicPath,
        fileName,
        fields: {
          name: fields.name ?? null,
          idNumber: fields.idNumber ?? null,
          idType: fields.idType ?? idType,
        },
        confidence: {
          hasName: Boolean(fields.name),
          hasIdNumber: Boolean(fields.idNumber),
        },
        isPdf,
      },
      isPdf ? 'PDF document saved' : 'Document processed',
      201
    )
  } catch (error) {
    console.error('ID OCR error:', error)
    const message =
      error instanceof Error && error.message.includes('OCR_SPACE_API_KEY')
        ? 'OCR service is not configured. Set OCR_SPACE_API_KEY in .env'
        : error instanceof Error && error.message.includes('OCR.space')
          ? error.message
          : 'Failed to read ID document. Try a clearer scan.'
    return errorResponse(message, 500)
  }
}
