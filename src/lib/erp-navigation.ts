import { CURRENT_PAGE_STORAGE_KEY } from '@/lib/session'

/** Open an ERP sidebar page on the main dashboard (full navigation). */
export function openErpPage(pageKey: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CURRENT_PAGE_STORAGE_KEY, pageKey)
  window.location.href = '/'
}
