import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { successResponse, errorResponse } from '@/lib/api-utils'
import { RoleType } from '@prisma/client'
import {
  APP_PERMISSION_CATALOG,
  groupPermissionsBySection,
  ADMIN_LOCKED_PERMISSION_KEYS,
} from '@/lib/app-permissions'
import { APP_ROLES, formatRoleLabel, type AppRole } from '@/lib/roles'
import {
  ensureRolePermissionsSeeded,
  getEffectivePermissionKeys,
  getRolePermissionKeys,
  replaceRolePermissions,
  replaceUserPermissionOverrides,
  clearUserPermissionOverrides,
} from '@/lib/permission-service'

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType)
    if (authResult instanceof Response) return authResult

    await ensureRolePermissionsSeeded(db)

    const { searchParams } = new URL(request.url)
    const scope = searchParams.get('scope') || 'catalog'
    const role = searchParams.get('role')
    const userId = searchParams.get('userId')

    if (scope === 'me') {
      // Allow any authenticated admin path — me is also exposed under /permissions/me
      const keys = await getEffectivePermissionKeys(db, authResult.id, authResult.role)
      return successResponse({ permissionKeys: keys })
    }

    if (scope === 'role' && role) {
      if (!(APP_ROLES as string[]).includes(role)) {
        return errorResponse('Invalid role', 400)
      }
      const permissionKeys = await getRolePermissionKeys(db, role)
      return successResponse({
        role,
        roleLabel: formatRoleLabel(role),
        permissionKeys,
        lockedKeys:
          role === 'ADMIN' ? [...ADMIN_LOCKED_PERMISSION_KEYS] : [],
      })
    }

    if (scope === 'user' && userId) {
      const target = await db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true,
          permissions: {
            select: { permissionKey: true, granted: true },
          },
        },
      })
      if (!target) return errorResponse('User not found', 404)

      const roleKeys = await getRolePermissionKeys(db, target.role)
      const effectiveKeys = await getEffectivePermissionKeys(
        db,
        target.id,
        target.role
      )

      return successResponse({
        user: {
          id: target.id,
          name: target.name,
          email: target.email,
          role: target.role,
          roleLabel: formatRoleLabel(target.role),
          active: target.active,
        },
        rolePermissionKeys: roleKeys,
        overrides: target.permissions,
        permissionKeys: effectiveKeys,
        lockedKeys:
          target.role === 'ADMIN' ? [...ADMIN_LOCKED_PERMISSION_KEYS] : [],
      })
    }

    const roleMatrix: Record<string, string[]> = {}
    for (const r of APP_ROLES) {
      roleMatrix[r] = await getRolePermissionKeys(db, r)
    }

    const users = await db.user.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        _count: { select: { permissions: true } },
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    })

    return successResponse({
      catalog: APP_PERMISSION_CATALOG,
      sections: groupPermissionsBySection(),
      roles: APP_ROLES.map((r) => ({
        role: r,
        label: formatRoleLabel(r),
        permissionKeys: roleMatrix[r],
      })),
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        roleLabel: formatRoleLabel(u.role),
        overrideCount: u._count.permissions,
      })),
    })
  } catch (error) {
    console.error('Permissions GET error:', error)
    return errorResponse('Failed to load permissions', 500)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType)
    if (authResult instanceof Response) return authResult

    await ensureRolePermissionsSeeded(db)
    const body = await request.json()
    const mode = String(body?.mode || '')

    if (mode === 'role') {
      const role = String(body?.role || '') as AppRole
      if (!(APP_ROLES as string[]).includes(role)) {
        return errorResponse('Invalid role', 400)
      }
      const permissionKeys = Array.isArray(body?.permissionKeys)
        ? body.permissionKeys.map(String)
        : []
      const saved = await replaceRolePermissions(db, role, permissionKeys)
      return successResponse(
        { role, permissionKeys: saved },
        `Permissions updated for ${formatRoleLabel(role)}`
      )
    }

    if (mode === 'user') {
      const userId = String(body?.userId || '')
      if (!userId) return errorResponse('userId is required')

      const target = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, name: true },
      })
      if (!target) return errorResponse('User not found', 404)

      if (body?.resetToRole === true) {
        await clearUserPermissionOverrides(db, userId)
        const permissionKeys = await getRolePermissionKeys(db, target.role)
        return successResponse(
          { userId, permissionKeys, overridesCleared: true },
          `Reset ${target.name} to ${formatRoleLabel(target.role)} defaults`
        )
      }

      const permissionKeys = Array.isArray(body?.permissionKeys)
        ? body.permissionKeys.map(String)
        : []
      const result = await replaceUserPermissionOverrides(
        db,
        userId,
        target.role,
        permissionKeys
      )
      return successResponse(
        { userId, ...result },
        `Custom permissions saved for ${target.name}`
      )
    }

    return errorResponse('mode must be "role" or "user"')
  } catch (error) {
    console.error('Permissions PUT error:', error)
    return errorResponse('Failed to save permissions', 500)
  }
}
