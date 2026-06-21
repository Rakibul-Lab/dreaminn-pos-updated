'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthHydration } from '@/hooks/use-auth-hydration'
import {
  useAuthStore,
  canAccessHotel,
  canAccessRestaurant,
  canAccessAdmin,
} from '@/lib/auth-store'

type LedgerAccessOptions = {
  /** Allow restaurant staff (CloudView page). */
  allowRestaurant?: boolean
}

export function useRequireLedgerAccess(options?: LedgerAccessOptions) {
  const hydrated = useAuthHydration()
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  const allowed =
    !!user &&
    (canAccessAdmin(user.role) ||
      canAccessHotel(user.role) ||
      (options?.allowRestaurant === true && canAccessRestaurant(user.role)))

  useEffect(() => {
    if (!hydrated) return
    if (!isAuthenticated || !user || !allowed) {
      router.replace('/')
    }
  }, [hydrated, isAuthenticated, user, allowed, router])

  return { hydrated, user, isAuthenticated, allowed }
}
