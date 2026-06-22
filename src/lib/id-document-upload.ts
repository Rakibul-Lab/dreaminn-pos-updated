export const ID_DOCUMENT_ACCEPT =
  'image/jpeg,image/jpg,image/png,image/webp,application/pdf,.pdf'

export const ID_DOCUMENT_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const

export const ID_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024

export function isIdDocumentPdf(source: string): boolean {
  return source.toLowerCase().split('?')[0]!.endsWith('.pdf')
}

export function isAllowedIdDocumentFile(file: File): boolean {
  const type = file.type.toLowerCase()
  if (ID_DOCUMENT_ALLOWED_MIME_TYPES.includes(type as (typeof ID_DOCUMENT_ALLOWED_MIME_TYPES)[number])) {
    return true
  }
  return file.name.toLowerCase().endsWith('.pdf')
}

export function idDocumentFileExtension(file: File): 'pdf' | 'png' | 'webp' | 'jpg' {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return 'pdf'
  }
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/webp') return 'webp'
  return 'jpg'
}

/** Best URL for opening a saved or in-memory ID document in a new tab. */
export function resolveIdDocumentHref(path: string, previewUrl?: string | null): string {
  if (path.startsWith('/')) return path
  if (previewUrl?.startsWith('/')) return previewUrl
  if (previewUrl?.startsWith('blob:')) return previewUrl
  if (path.startsWith('blob:')) return path
  return previewUrl || path || '#'
}
