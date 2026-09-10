import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { successResponse, errorResponse, logActivity } from '@/lib/api-utils'
import { RoleType } from '@prisma/client'
import {
  APP_PERMISSION_CATALOG,
  groupPermissionsBySection,
  ADMIN_LOCKED_PERMISSION_KEYS,
  SYSTEM_ACCESS_ROLE_DEFS,
} from '@/lib/app-permissions'
import { APP_ROLES, formatRoleLabel, type AppRole } from '@/lib/roles'
import {
  ensureAccessRolesSeeded,
  getEffectivePermissionKeys,
  getAccessRolePermissionKeys,
  listAccessRoles,
  replaceAccessRolePermissions,
  replaceUserPermissionOverrides,
  clearUserPermissionOverrides,
  createCustomAccessRole,
  updateCustomAccessRole,
  deleteCustomAccessRole,
  resolveAccessRoleForUser,
} from '@/lib/permission-service'

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType)
    if (authResult instanceof Response) return authResult

    await ensureAccessRolesSeeded(db)

    const { searchParams } = new URL(request.url)
    const scope = searchParams.get('scope') || 'catalog'
    const accessRoleId = searchParams.get('accessRoleId')
    const userId = searchParams.get('userId')

    if (scope === 'access-role' && accessRoleId) {
      const role = await db.accessRole.findUnique({ where: { id: accessRoleId } })
      if (!role) return errorResponse('Role not found', 404)
      const permissionKeys = await getAccessRolePermissionKeys(
        db,
        role.id,
        role.baseRole
      )
      return successResponse({
        role,
        permissionKeys,
        lockedKeys:
          role.baseRole === 'ADMIN' && role.isSystem
            ? [...ADMIN_LOCKED_PERMISSION_KEYS]
            : [],
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
          accessRoleId: true,
          accessRole: {
            select: {
              id: true,
              key: true,
              label: true,
              baseRole: true,
              isSystem: true,
            },
          },
          permissions: {
            select: { permissionKey: true, granted: true },
          },
        },
      })
      if (!target) return errorResponse('User not found', 404)

      const accessRole = await resolveAccessRoleForUser(db, target)
      const roleKeys = accessRole
        ? await getAccessRolePermissionKeys(db, accessRole.id, accessRole.baseRole)
        : []
      const effectiveKeys = await getEffectivePermissionKeys(
        db,
        target.id,
        target.role,
        target.accessRoleId
      )

      return successResponse({
        user: {
          id: target.id,
          name: target.name,
          email: target.email,
          role: target.role,
          roleLabel: formatRoleLabel(target.role),
          active: target.active,
          accessRoleId: target.accessRoleId,
          accessRole: target.accessRole,
        },
        rolePermissionKeys: roleKeys,
        overrides: target.permissions,
        permissionKeys: effectiveKeys,
        lockedKeys:
          target.role === 'ADMIN' ? [...ADMIN_LOCKED_PERMISSION_KEYS] : [],
      })
    }

    const roles = await listAccessRoles(db)
    const rolesWithKeys = await Promise.all(
      roles.map(async (role) => ({
        id: role.id,
        key: role.key,
        label: role.label,
        description: role.description,
        baseRole: role.baseRole,
        baseRoleLabel: formatRoleLabel(role.baseRole),
        isSystem: role.isSystem,
        active: role.active,
        sortOrder: role.sortOrder,
        userCount: role._count.users,
        permissionCount: role._count.permissions,
        permissionKeys: await getAccessRolePermissionKeys(
          db,
          role.id,
          role.baseRole
        ),
      }))
    )

    const users = await db.user.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        accessRoleId: true,
        accessRole: { select: { id: true, label: true, isSystem: true } },
        _count: { select: { permissions: true } },
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    })

    return successResponse({
      catalog: APP_PERMISSION_CATALOG,
      sections: groupPermissionsBySection(),
      baseRoles: APP_ROLES.map((r) => ({
        role: r,
        label: formatRoleLabel(r),
      })),
      systemRoleDefs: SYSTEM_ACCESS_ROLE_DEFS,
      roles: rolesWithKeys,
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        roleLabel: formatRoleLabel(u.role),
        accessRoleId: u.accessRoleId,
        accessRoleLabel: u.accessRole?.label ?? formatRoleLabel(u.role),
        overrideCount: u._count.permissions,
      })),
    })
  } catch (error) {
    console.error('Permissions GET error:', error)
    return errorResponse('Failed to load permissions', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType)
    if (authResult instanceof Response) return authResult

    const body = await request.json()
    const label = String(body?.label || '').trim()
    if (!label) return errorResponse('Role name is required')

    const baseRole = String(body?.baseRole || 'HOTEL_STAFF') as AppRole
    if (!(APP_ROLES as string[]).includes(baseRole)) {
      return errorResponse('Invalid base role')
    }

    const created = await createCustomAccessRole(db, {
      label,
      description: body?.description ?? null,
      baseRole,
      // Custom roles start empty unless the client sends an explicit list.
      permissionKeys: Array.isArray(body?.permissionKeys)
        ? body.permissionKeys.map(String)
        : [],
    })

    await logActivity(
      authResult.id,
      'CREATE',
      'access-role',
      JSON.stringify({ accessRoleId: created.id, label: created.label })
    )

    return successResponse(created, `Role “${created.label}” created`)
  } catch (error) {
    console.error('Permissions POST error:', error)
    const message = error instanceof Error ? error.message : 'Failed to create role'
    return errorResponse(message, 400)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType)
    if (authResult instanceof Response) return authResult

    await ensureAccessRolesSeeded(db)
    const body = await request.json()
    const mode = String(body?.mode || '')

    if (mode === 'access-role') {
      const accessRoleId = String(body?.accessRoleId || '')
      if (!accessRoleId) return errorResponse('accessRoleId is required')

      const role = await db.accessRole.findUnique({ where: { id: accessRoleId } })
      if (!role) return errorResponse('Role not found', 404)

      if (
        body?.label !== undefined ||
        body?.description !== undefined ||
        body?.baseRole
      ) {
        if (!role.isSystem) {
          await updateCustomAccessRole(db, accessRoleId, {
            label: body?.label,
            description: body?.description,
            baseRole: body?.baseRole,
          })
        } else if (body?.label !== undefined || body?.description !== undefined) {
          await db.accessRole.update({
            where: { id: accessRoleId },
            data: {
              label: body?.label !== undefined ? String(body.label).trim() : undefined,
              description:
                body?.description !== undefined
                  ? String(body.description || '').trim() || null
                  : undefined,
            },
          })
        }
      }

      if (Array.isArray(body?.permissionKeys)) {
        const saved = await replaceAccessRolePermissions(
          db,
          accessRoleId,
          body.permissionKeys.map(String),
          { isAdminRole: role.baseRole === 'ADMIN' && role.isSystem }
        )
        await logActivity(
          authResult.id,
          'UPDATE',
          'access-role-permissions',
          JSON.stringify({ accessRoleId, count: saved.length })
        )
        return successResponse(
          { accessRoleId, permissionKeys: saved },
          `Permissions updated for ${role.label}`
        )
      }

      const updated = await db.accessRole.findUnique({ where: { id: accessRoleId } })
      return successResponse(updated, 'Role updated')
    }

    if (mode === 'user') {
      const userId = String(body?.userId || '')
      if (!userId) return errorResponse('userId is required')

      const target = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, name: true, accessRoleId: true },
      })
      if (!target) return errorResponse('User not found', 404)

      if (body?.accessRoleId) {
        const accessRole = await db.accessRole.findUnique({
          where: { id: String(body.accessRoleId) },
        })
        if (!accessRole || !accessRole.active) {
          return errorResponse('Access role not found', 404)
        }
        await db.user.update({
          where: { id: userId },
          data: {
            accessRoleId: accessRole.id,
            role: accessRole.baseRole,
          },
        })
      }

      if (body?.resetToRole === true) {
        await clearUserPermissionOverrides(db, userId)
        const refreshed = await db.user.findUnique({
          where: { id: userId },
          select: { accessRoleId: true, role: true },
        })
        const permissionKeys = await getEffectivePermissionKeys(
          db,
          userId,
          refreshed?.role || target.role,
          refreshed?.accessRoleId
        )
        return successResponse(
          { userId, permissionKeys, overridesCleared: true },
          `Reset ${target.name} to role defaults`
        )
      }

      if (Array.isArray(body?.permissionKeys)) {
        const refreshed = await db.user.findUnique({
          where: { id: userId },
          select: { accessRoleId: true, role: true },
        })
        const result = await replaceUserPermissionOverrides(
          db,
          userId,
          refreshed?.role || target.role,
          body.permissionKeys.map(String),
          refreshed?.accessRoleId
        )
        return successResponse(
          { userId, ...result },
          `Custom permissions saved for ${target.name}`
        )
      }

      return successResponse({ userId }, 'User role updated')
    }

    return errorResponse('mode must be "access-role" or "user"')
  } catch (error) {
    console.error('Permissions PUT error:', error)
    const message =
      error instanceof Error ? error.message : 'Failed to save permissions'
    return errorResponse(message, 400)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireRole(request, 'ADMIN' as RoleType)
    if (authResult instanceof Response) return authResult

    const { searchParams } = new URL(request.url)
    const accessRoleId = searchParams.get('accessRoleId')
    if (!accessRoleId) return errorResponse('accessRoleId is required')

    await deleteCustomAccessRole(db, accessRoleId)
    await logActivity(
      authResult.id,
      'DELETE',
      'access-role',
      JSON.stringify({ accessRoleId })
    )
    return successResponse(null, 'Custom role deleted')
  } catch (error) {
    console.error('Permissions DELETE error:', error)
    const message = error instanceof Error ? error.message : 'Failed to delete role'
    return errorResponse(message, 400)
  }
}
