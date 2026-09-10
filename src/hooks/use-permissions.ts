'use client'

import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/lib/auth-store'
import {
  defaultPermissionKeysForRole,
  pageKeyFromPermission,
} from '@/lib/app-permissions'

type MyPermissionsData = {
  permissionKeys: string[]
  pageKeys: string[]
  role?: string
  accessRoleId?: string | null
}

export function usePermissions() {
  const { user } = useAuthStore()

  const query = useQuery({
    queryKey: ['my-permissions', user?.id],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: MyPermissionsData }>(
        '/permissions/me'
      )
      return res.data
    },
    enabled: Boolean(user?.id),
    staleTime: 30_000,
    retry: 1,
  })

  const keys = useMemo(() => {
    // Honor an empty matrix (new custom roles start with 0 permissions).
    if (query.data?.permissionKeys) {
      return new Set(query.data.permissionKeys)
    }
    return new Set(defaultPermissionKeysForRole(user?.role || ''))
  }, [query.data, user?.role])

  const pageKeys = useMemo(() => {
    if (query.data?.pageKeys) {
      return new Set(query.data.pageKeys)
    }
    return new Set(
      [...keys]
        .map((key) => pageKeyFromPermission(key))
        .filter((key): key is NonNullable<typeof key> => Boolean(key))
    )
  }, [query.data, keys])

  const can = useCallback((permissionKey: string) => keys.has(permissionKey), [keys])

  const canPage = useCallback(
    (pageKey: string) => pageKeys.has(pageKey) || keys.has(`page.${pageKey}`),
    [pageKeys, keys]
  )

  const canAny = useCallback(
    (...permissionKeys: string[]) => permissionKeys.some((key) => keys.has(key)),
    [keys]
  )

  return {
    keys,
    pageKeys,
    can,
    canPage,
    canAny,
    isLoading: query.isLoading,
    refresh: query.refetch,
  }
}
