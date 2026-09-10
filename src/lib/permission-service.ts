import type { PrismaClient, RoleType } from '@prisma/client'
import {
  ADMIN_LOCKED_PERMISSION_KEYS,
  ALWAYS_GRANTED_PERMISSION_KEYS,
  APP_PERMISSION_CATALOG,
  SYSTEM_ACCESS_ROLE_DEFS,
  applyPermissionOverrides,
  defaultPermissionKeysForRole,
  isKnownPermissionKey,
  slugifyRoleKey,
  type AppPageKey,
} from '@/lib/app-permissions'
import type { AppRole } from '@/lib/roles'

type PermissionDb = Pick<
  PrismaClient,
  'rolePermission' | 'userPermission' | 'user' | 'accessRole' | 'accessRolePermission'
>

let seedPromise: Promise<void> | null = null

function uniqueValidKeys(keys: string[], roleIsAdmin = false): string[] {
  const valid = [...new Set(keys.filter((key) => isKnownPermissionKey(key)))]
  for (const key of ALWAYS_GRANTED_PERMISSION_KEYS) {
    if (!valid.includes(key)) valid.push(key)
  }
  if (roleIsAdmin) {
    for (const key of ADMIN_LOCKED_PERMISSION_KEYS) {
      if (!valid.includes(key)) valid.push(key)
    }
  }
  return valid.sort()
}

export async function ensureAccessRolesSeeded(db: PermissionDb): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      try {
        for (const def of SYSTEM_ACCESS_ROLE_DEFS) {
          const existing = await db.accessRole.findUnique({ where: { key: def.key } })
          const permissionKeys = uniqueValidKeys(
            defaultPermissionKeysForRole(def.baseRole),
            def.baseRole === 'ADMIN'
          )

          if (!existing) {
            const created = await db.accessRole.create({
              data: {
                key: def.key,
                label: def.label,
                description: def.description,
                baseRole: def.baseRole as RoleType,
                isSystem: true,
                active: true,
                sortOrder: def.sortOrder,
              },
            })
            if (permissionKeys.length > 0) {
              await db.accessRolePermission.createMany({
                data: permissionKeys.map((permissionKey) => ({
                  accessRoleId: created.id,
                  permissionKey,
                })),
                skipDuplicates: true,
              })
            }
          }
        }

        // Backfill user.accessRoleId from RoleType when empty.
        const systemRoles = await db.accessRole.findMany({
          where: { isSystem: true },
          select: { id: true, baseRole: true },
        })
        for (const role of systemRoles) {
          await db.user.updateMany({
            where: { role: role.baseRole, accessRoleId: null },
            data: { accessRoleId: role.id },
          })
        }
      } catch (error) {
        console.warn('Access roles seed skipped:', error)
        seedPromise = null
      }
    })().catch((error) => {
      seedPromise = null
      throw error
    })
  }
  await seedPromise
  // Always merge newly added catalog keys onto system roles (safe after hot reload).
  await syncSystemRoleCatalogGaps(db)
}

async function syncSystemRoleCatalogGaps(db: PermissionDb): Promise<void> {
  try {
    for (const def of SYSTEM_ACCESS_ROLE_DEFS) {
      const existing = await db.accessRole.findUnique({ where: { key: def.key } })
      if (!existing) continue
      const permissionKeys = uniqueValidKeys(
        defaultPermissionKeysForRole(def.baseRole),
        def.baseRole === 'ADMIN'
      )
      const have = new Set(
        (
          await db.accessRolePermission.findMany({
            where: { accessRoleId: existing.id },
            select: { permissionKey: true },
          })
        ).map((r) => r.permissionKey)
      )
      const missing = permissionKeys.filter((key) => !have.has(key))
      if (missing.length > 0) {
        await db.accessRolePermission.createMany({
          data: missing.map((permissionKey) => ({
            accessRoleId: existing.id,
            permissionKey,
          })),
          skipDuplicates: true,
        })
      }
    }
  } catch (error) {
    console.warn('System role catalog sync skipped:', error)
  }
}

/** @deprecated alias */
export const ensureRolePermissionsSeeded = ensureAccessRolesSeeded

export async function listAccessRoles(db: PermissionDb) {
  await ensureAccessRolesSeeded(db)
  return db.accessRole.findMany({
    where: { active: true },
    include: {
      _count: { select: { permissions: true, users: true } },
    },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  })
}

export async function resolveAccessRoleForUser(
  db: PermissionDb,
  user: { id: string; role: string; accessRoleId?: string | null }
) {
  await ensureAccessRolesSeeded(db)
  if (user.accessRoleId) {
    const role = await db.accessRole.findUnique({ where: { id: user.accessRoleId } })
    if (role && role.active) return role
  }
  return db.accessRole.findFirst({
    where: { baseRole: user.role as RoleType, isSystem: true, active: true },
  })
}

export async function getAccessRolePermissionKeys(
  db: PermissionDb,
  accessRoleId: string,
  baseRole?: string
): Promise<string[]> {
  await ensureAccessRolesSeeded(db)
  const rows = await db.accessRolePermission.findMany({
    where: { accessRoleId },
    select: { permissionKey: true },
  })
  // Empty is intentional for new custom roles (0 permissions). Do not fall back
  // to base-role defaults — that would silently grant full menu access.
  const keys = new Set(rows.map((r) => r.permissionKey))
  for (const key of ALWAYS_GRANTED_PERMISSION_KEYS) keys.add(key)
  if (baseRole === 'ADMIN') {
    for (const key of ADMIN_LOCKED_PERMISSION_KEYS) keys.add(key)
  }
  return [...keys]
}

export async function getRolePermissionKeys(
  db: PermissionDb,
  role: string
): Promise<string[]> {
  try {
    await ensureAccessRolesSeeded(db)
    const accessRole = await db.accessRole.findFirst({
      where: { baseRole: role as RoleType, isSystem: true, active: true },
    })
    if (accessRole) {
      return getAccessRolePermissionKeys(db, accessRole.id, role)
    }
    return defaultPermissionKeysForRole(role)
  } catch (error) {
    console.warn('getRolePermissionKeys fallback:', error)
    return defaultPermissionKeysForRole(role)
  }
}

export async function getEffectivePermissionKeys(
  db: PermissionDb,
  userId: string,
  role: string,
  accessRoleId?: string | null
): Promise<string[]> {
  try {
    const userRole = await resolveAccessRoleForUser(db, {
      id: userId,
      role,
      accessRoleId,
    })
    const roleKeys = userRole
      ? await getAccessRolePermissionKeys(db, userRole.id, userRole.baseRole)
      : await getRolePermissionKeys(db, role)

    const overrides = await db.userPermission.findMany({
      where: { userId },
      select: { permissionKey: true, granted: true },
    })

    const effective = applyPermissionOverrides(roleKeys, overrides)
    if (role === 'ADMIN' || userRole?.baseRole === 'ADMIN') {
      for (const key of ADMIN_LOCKED_PERMISSION_KEYS) effective.add(key)
    }
    return [...effective]
  } catch (error) {
    console.warn('getEffectivePermissionKeys fallback:', error)
    return defaultPermissionKeysForRole(role)
  }
}

export async function userHasPagePermission(
  db: PermissionDb,
  user: { id: string; role: string; accessRoleId?: string | null },
  pageKey: AppPageKey | string
): Promise<boolean> {
  const keys = await getEffectivePermissionKeys(
    db,
    user.id,
    user.role,
    user.accessRoleId
  )
  return keys.includes(`page.${pageKey}`)
}

export async function userHasPermission(
  db: PermissionDb,
  user: { id: string; role: string; accessRoleId?: string | null },
  permissionKey: string
): Promise<boolean> {
  const keys = await getEffectivePermissionKeys(
    db,
    user.id,
    user.role,
    user.accessRoleId
  )
  return keys.includes(permissionKey)
}

export async function replaceAccessRolePermissions(
  db: PermissionDb,
  accessRoleId: string,
  permissionKeys: string[],
  options?: { isAdminRole?: boolean }
): Promise<string[]> {
  const valid = uniqueValidKeys(permissionKeys, options?.isAdminRole === true)
  await db.accessRolePermission.deleteMany({ where: { accessRoleId } })
  if (valid.length > 0) {
    await db.accessRolePermission.createMany({
      data: valid.map((permissionKey) => ({ accessRoleId, permissionKey })),
      skipDuplicates: true,
    })
  }
  return valid
}

/** Legacy RoleType matrix writer — also updates matching system AccessRole. */
export async function replaceRolePermissions(
  db: PermissionDb,
  role: AppRole,
  permissionKeys: string[]
): Promise<string[]> {
  await ensureAccessRolesSeeded(db)
  const accessRole = await db.accessRole.findFirst({
    where: { baseRole: role as RoleType, isSystem: true },
  })
  if (accessRole) {
    return replaceAccessRolePermissions(db, accessRole.id, permissionKeys, {
      isAdminRole: role === 'ADMIN',
    })
  }
  const valid = uniqueValidKeys(permissionKeys, role === 'ADMIN')
  await db.rolePermission.deleteMany({ where: { role: role as RoleType } })
  if (valid.length > 0) {
    await db.rolePermission.createMany({
      data: valid.map((permissionKey) => ({
        role: role as RoleType,
        permissionKey,
      })),
      skipDuplicates: true,
    })
  }
  return valid
}

export async function createCustomAccessRole(
  db: PermissionDb,
  input: {
    label: string
    description?: string | null
    baseRole: AppRole
    permissionKeys?: string[]
  }
) {
  await ensureAccessRolesSeeded(db)
  const base = input.baseRole
  let key = slugifyRoleKey(input.label)
  const clash = await db.accessRole.findUnique({ where: { key } })
  if (clash) key = `${key}_${Date.now().toString(36)}`

  // New custom roles always start with zero permissions unless keys are provided.
  const seedKeys = Array.isArray(input.permissionKeys) ? input.permissionKeys : []

  const created = await db.accessRole.create({
    data: {
      key,
      label: input.label.trim(),
      description: input.description?.trim() || null,
      baseRole: base as RoleType,
      isSystem: false,
      active: true,
      sortOrder: 200,
    },
  })

  await replaceAccessRolePermissions(db, created.id, seedKeys, {
    isAdminRole: base === 'ADMIN',
  })

  return created
}

export async function updateCustomAccessRole(
  db: PermissionDb,
  accessRoleId: string,
  input: {
    label?: string
    description?: string | null
    baseRole?: AppRole
    active?: boolean
  }
) {
  const existing = await db.accessRole.findUnique({ where: { id: accessRoleId } })
  if (!existing) throw new Error('Role not found')
  if (existing.isSystem && input.baseRole && input.baseRole !== existing.baseRole) {
    throw new Error('System role base type cannot be changed')
  }

  return db.accessRole.update({
    where: { id: accessRoleId },
    data: {
      label: input.label?.trim() || existing.label,
      description:
        input.description !== undefined
          ? input.description?.trim() || null
          : existing.description,
      baseRole: (input.baseRole as RoleType | undefined) || existing.baseRole,
      active: input.active ?? existing.active,
    },
  })
}

export async function deleteCustomAccessRole(db: PermissionDb, accessRoleId: string) {
  const existing = await db.accessRole.findUnique({
    where: { id: accessRoleId },
    include: { _count: { select: { users: true } } },
  })
  if (!existing) throw new Error('Role not found')
  if (existing.isSystem) throw new Error('System roles cannot be deleted')
  if (existing._count.users > 0) {
    throw new Error('Reassign users before deleting this role')
  }
  await db.accessRole.delete({ where: { id: accessRoleId } })
}

export async function replaceUserPermissionOverrides(
  db: PermissionDb,
  userId: string,
  role: string,
  desiredKeys: string[],
  accessRoleId?: string | null
): Promise<{ grants: string[]; denials: string[]; effective: string[] }> {
  const accessRole = await resolveAccessRoleForUser(db, {
    id: userId,
    role,
    accessRoleId,
  })
  const roleKeys = new Set(
    accessRole
      ? await getAccessRolePermissionKeys(db, accessRole.id, accessRole.baseRole)
      : await getRolePermissionKeys(db, role)
  )
  const desired = new Set(
    desiredKeys.filter((key) => isKnownPermissionKey(key))
  )
  for (const key of ALWAYS_GRANTED_PERMISSION_KEYS) desired.add(key)
  if (role === 'ADMIN' || accessRole?.baseRole === 'ADMIN') {
    for (const key of ADMIN_LOCKED_PERMISSION_KEYS) desired.add(key)
  }

  const grants: string[] = []
  const denials: string[] = []
  for (const def of APP_PERMISSION_CATALOG) {
    const key = def.key
    const inRole = roleKeys.has(key)
    const inDesired = desired.has(key)
    if (inDesired && !inRole) grants.push(key)
    if (!inDesired && inRole) denials.push(key)
  }

  await db.userPermission.deleteMany({ where: { userId } })
  const rows = [
    ...grants.map((permissionKey) => ({ userId, permissionKey, granted: true })),
    ...denials.map((permissionKey) => ({
      userId,
      permissionKey,
      granted: false,
    })),
  ]
  if (rows.length > 0) {
    await db.userPermission.createMany({ data: rows })
  }

  const effective = applyPermissionOverrides(roleKeys, [
    ...grants.map((permissionKey) => ({ permissionKey, granted: true })),
    ...denials.map((permissionKey) => ({ permissionKey, granted: false })),
  ])
  return {
    grants,
    denials,
    effective: [...effective].sort(),
  }
}

export async function clearUserPermissionOverrides(
  db: PermissionDb,
  userId: string
): Promise<void> {
  await db.userPermission.deleteMany({ where: { userId } })
}
