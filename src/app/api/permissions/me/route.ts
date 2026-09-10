import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { successResponse, errorResponse } from '@/lib/api-utils'
import { getEffectivePermissionKeys } from '@/lib/permission-service'
import { pageKeyFromPermission } from '@/lib/app-permissions'

/** Current user's effective page permissions (for sidebar filtering). */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request)
    if (authResult instanceof Response) return authResult

    const permissionKeys = await getEffectivePermissionKeys(
      db,
      authResult.id,
      authResult.role
    )
    const pageKeys = permissionKeys
      .map((key) => pageKeyFromPermission(key))
      .filter((key): key is NonNullable<typeof key> => Boolean(key))

    return successResponse({
      permissionKeys,
      pageKeys,
      role: authResult.role,
    })
  } catch (error) {
    console.error('Permissions me GET error:', error)
    return errorResponse('Failed to load your permissions', 500)
  }
}
