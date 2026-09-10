import type { PrismaClient, RoleType } from '@prisma/client'
import {
  ADMIN_LOCKED_PERMISSION_KEYS,
  ALWAYS_GRANTED_PERMISSION_KEYS,
  APP_PERMISSION_CATALOG,
  applyPermissionOverrides,
  defaultPermissionKeysForRole,
  isKnownPermissionKey,
  type AppPageKey,
} from '@/lib/app-permissions'
import { APP_ROLES, type AppRole } from '@/lib/roles'

type PermissionDb = Pick<PrismaClient, 'rolePermission' | 'userPermission' | 'user'>

let seedPromise: Promise<void> | null = null

export async function ensureRolePermissionsSeeded(db: PermissionDb): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      try {
        const count = await db.rolePermission.count()
        if (count > 0) return

        const rows = APP_ROLES.flatMap((role) =>
          defaultPermissionKeysForRole(role).map((permissionKey) => ({
            role: role as RoleType,
            permissionKey,
          }))
        )
        if (rows.length === 0) return
        await db.rolePermission.createMany({ data: rows, skipDuplicates: true })
      } catch (error) {
        // Tables may be missing until the production SQL migration is applied.
        console.warn('Role permissions seed skipped:', error)
        seedPromise = null
      }
    })().catch((error) => {
      seedPromise = null
      throw error
    })
  }
  await seedPromise
}

export async function getRolePermissionKeys(
  db: PermissionDb,
  role: string
): Promise<string[]> {
  try {
    await ensureRolePermissionsSeeded(db)
    const rows = await db.rolePermission.findMany({
      where: { role: role as RoleType },
      select: { permissionKey: true },
    })
    if (rows.length === 0) {
      return defaultPermissionKeysForRole(role)
    }
    const keys = new Set(rows.map((r) => r.permissionKey))
    for (const key of ALWAYS_GRANTED_PERMISSION_KEYS) keys.add(key)
    if (role === 'ADMIN') {
      for (const key of ADMIN_LOCKED_PERMISSION_KEYS) keys.add(key)
    }
    return [...keys]
  } catch (error) {
    console.warn('getRolePermissionKeys fallback:', error)
    return defaultPermissionKeysForRole(role)
  }
}

export async function getEffectivePermissionKeys(
  db: PermissionDb,
  userId: string,
  role: string
): Promise<string[]> {
  try {
    const [roleKeys, overrides] = await Promise.all([
      getRolePermissionKeys(db, role),
      db.userPermission.findMany({
        where: { userId },
        select: { permissionKey: true, granted: true },
      }),
    ])

    const effective = applyPermissionOverrides(roleKeys, overrides)
    if (role === 'ADMIN') {
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
  user: { id: string; role: string },
  pageKey: AppPageKey | string
): Promise<boolean> {
  const keys = await getEffectivePermissionKeys(db, user.id, user.role)
  return keys.includes(`page.${pageKey}`)
}

export async function replaceRolePermissions(
  db: PermissionDb,
  role: AppRole,
  permissionKeys: string[]
): Promise<string[]> {
  const valid = [
    ...new Set(permissionKeys.filter((key) => isKnownPermissionKey(key))),
  ]

  for (const key of ALWAYS_GRANTED_PERMISSION_KEYS) {
    if (!valid.includes(key)) valid.push(key)
  }
  if (role === 'ADMIN') {
    for (const key of ADMIN_LOCKED_PERMISSION_KEYS) {
      if (!valid.includes(key)) valid.push(key)
    }
  }

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
  return valid.sort()
}

/**
 * Persist only diffs vs the role defaults so future role changes still apply
 * where the user was left on “inherit”.
 */
export async function replaceUserPermissionOverrides(
  db: PermissionDb,
  userId: string,
  role: string,
  desiredKeys: string[]
): Promise<{ grants: string[]; denials: string[]; effective: string[] }> {
  const roleKeys = new Set(await getRolePermissionKeys(db, role))
  const desired = new Set(
    desiredKeys.filter((key) => isKnownPermissionKey(key))
  )
  for (const key of ALWAYS_GRANTED_PERMISSION_KEYS) desired.add(key)
  if (role === 'ADMIN') {
    for (const key of ADMIN_LOCKED_PERMISSION_KEYS) desired.add(key)
  }

  const grants: string[] = []
  const denials: string[] = []
  for (const key of APP_PERMISSION_CATALOG.map((p) => p.key)) {
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
