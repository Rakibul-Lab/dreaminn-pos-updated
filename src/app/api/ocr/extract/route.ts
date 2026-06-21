import { NextRequest } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { requireRole } from '@/lib/auth'
import { successResponse, errorResponse } from '@/lib/api-utils'
import { runServerIdOcr } from '@/lib/id-ocr-server'
import type { IdDocumentType } from '@/lib/id-ocr'
import { RoleType } from '@prisma/client'

export const maxDuration = 120

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType, 'HOTEL_FD' as RoleType)
    if (authResult instanceof Response) return authResult

    const body = await request.json()
    const filePath = typeof body.path === 'string' ? body.path : ''
    const idType = (typeof body.idType === 'string' ? body.idType : 'national_id') as IdDocumentType

    if (!filePath.startsWith('/uploads/id-docs/')) {
      return errorResponse('Invalid document path')
    }

    const absPath = path.join(process.cwd(), 'public', filePath.replace(/^\//, ''))
    const buffer = await readFile(absPath)

    const fields = await runServerIdOcr(buffer, idType)

    if (!fields.name && !fields.idNumber) {
      console.warn(
        '[id-ocr/extract] No name/NID extracted. OCR length:',
        fields.rawText?.length ?? 0
      )
    }

    return successResponse({
      fields: {
        name: fields.name ?? null,
        idNumber: fields.idNumber ?? null,
        dateOfBirth: fields.dateOfBirth ?? null,
        address: fields.address ?? null,
        gender: fields.gender ?? null,
        fatherName: fields.fatherName ?? null,
        idType: fields.idType ?? idType,
      },
      confidence: {
        hasName: Boolean(fields.name),
        hasIdNumber: Boolean(fields.idNumber),
        hasDateOfBirth: Boolean(fields.dateOfBirth),
      },
    })
  } catch (error) {
    console.error('ID extract error:', error)
    return errorResponse('Failed to read ID from document', 500)
  }
}
