import { NextRequest } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { requireRole } from '@/lib/auth'
import { successResponse, errorResponse } from '@/lib/api-utils'
import {
  ID_DOCUMENT_MAX_BYTES,
  idDocumentFileExtension,
  isAllowedIdDocumentFile,
} from '@/lib/id-document-upload'
import { RoleType } from '@prisma/client'

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType)
    if (authResult instanceof Response) return authResult

    const formData = await request.formData()
    const file = formData.get('file')

    if (!file || !(file instanceof File)) {
      return errorResponse('No file uploaded')
    }

    if (!isAllowedIdDocumentFile(file)) {
      return errorResponse('Only JPEG, PNG, WebP images, or PDF files are allowed')
    }

    if (file.size > ID_DOCUMENT_MAX_BYTES) {
      return errorResponse('File must be under 10MB')
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const ext = idDocumentFileExtension(file)
    const fileName = `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'id-docs')

    await mkdir(uploadDir, { recursive: true })
    await writeFile(path.join(uploadDir, fileName), buffer)

    const publicPath = `/uploads/id-docs/${fileName}`

    return successResponse({ path: publicPath, fileName }, 'Document uploaded', 201)
  } catch (error) {
    console.error('ID document upload error:', error)
    return errorResponse('Failed to upload document', 500)
  }
}
