'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Shield,
  ShieldCheck,
  Users,
  RefreshCw,
  Save,
  RotateCcw,
  CheckSquare,
  Square,
  Lock,
} from 'lucide-react'
import { api } from '@/lib/api-client'
import { useAuthStore, canAccessAdmin } from '@/lib/auth-store'
import { useToast } from '@/hooks/use-toast'
import { formatRoleLabel, APP_ROLES, type AppRole } from '@/lib/roles'
import {
  ADMIN_LOCKED_PERMISSION_KEYS,
  ALWAYS_GRANTED_PERMISSION_KEYS,
  type AppPermissionDef,
} from '@/lib/app-permissions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type PermissionSection = {
  group: string
  permissions: AppPermissionDef[]
}

type CatalogResponse = {
  success: boolean
  data: {
    sections: PermissionSection[]
    roles: Array<{ role: AppRole; label: string; permissionKeys: string[] }>
    users: Array<{
      id: string
      name: string
      email: string
      role: AppRole
      roleLabel: string
      overrideCount: number
    }>
  }
}

type RoleDetailResponse = {
  success: boolean
  data: {
    role: AppRole
    permissionKeys: string[]
    lockedKeys: string[]
  }
}

type UserDetailResponse = {
  success: boolean
  data: {
    user: {
      id: string
      name: string
      email: string
      role: AppRole
      roleLabel: string
    }
    rolePermissionKeys: string[]
    permissionKeys: string[]
    lockedKeys: string[]
    overrides: Array<{ permissionKey: string; granted: boolean }>
  }
}

function PermissionMatrix({
  sections,
  selected,
  lockedKeys,
  roleDefaults,
  onToggle,
  onToggleGroup,
}: {
  sections: PermissionSection[]
  selected: Set<string>
  lockedKeys: string[]
  roleDefaults?: Set<string>
  onToggle: (key: string, next: boolean) => void
  onToggleGroup: (keys: string[], next: boolean) => void
}) {
  const locked = new Set(lockedKeys)

  return (
    <div className="space-y-4">
      {sections.map((section) => {
        const keys = section.permissions.map((p) => p.key)
        const enabledCount = keys.filter((k) => selected.has(k)).length
        const allOn = enabledCount === keys.length
        const someOn = enabledCount > 0 && !allOn

        return (
          <Card key={section.group} className="border-border/70 shadow-none">
            <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-sm font-semibold tracking-wide">
                  {section.group}
                </CardTitle>
                <CardDescription className="text-xs">
                  {enabledCount} of {keys.length} pages enabled
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => onToggleGroup(keys, !allOn)}
              >
                {allOn ? (
                  <CheckSquare className="h-3.5 w-3.5" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                {allOn ? 'Clear section' : someOn ? 'Select all' : 'Select all'}
              </Button>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {section.permissions.map((perm) => {
                  const checked = selected.has(perm.key)
                  const isLocked = locked.has(perm.key)
                  const inherited =
                    roleDefaults != null
                      ? roleDefaults.has(perm.key) === checked
                        ? null
                        : roleDefaults.has(perm.key)
                          ? 'denied'
                          : 'granted'
                      : null

                  return (
                    <label
                      key={perm.key}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                        checked
                          ? 'border-emerald-200 bg-emerald-50/60'
                          : 'border-border/80 bg-background',
                        isLocked && 'opacity-90'
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={isLocked}
                        onCheckedChange={(value) =>
                          onToggle(perm.key, value === true)
                        }
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm font-medium leading-tight">
                          {perm.label}
                          {isLocked && (
                            <Lock className="h-3 w-3 text-muted-foreground" />
                          )}
                        </span>
                        {perm.description ? (
                          <span className="mt-0.5 block text-xs text-muted-foreground leading-snug">
                            {perm.description}
                          </span>
                        ) : null}
                        {inherited === 'granted' && (
                          <Badge
                            variant="outline"
                            className="mt-1 h-5 border-sky-200 bg-sky-50 text-[10px] text-sky-700"
                          >
                            Extra grant
                          </Badge>
                        )}
                        {inherited === 'denied' && (
                          <Badge
                            variant="outline"
                            className="mt-1 h-5 border-amber-200 bg-amber-50 text-[10px] text-amber-700"
                          >
                            Role default removed
                          </Badge>
                        )}
                      </span>
                    </label>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

export default function RolesPermissionsPage() {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'role' | 'user'>('role')
  const [selectedRole, setSelectedRole] = useState<AppRole>('HOTEL_STAFF')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [draftKeys, setDraftKeys] = useState<Set<string>>(new Set())
  const [dirty, setDirty] = useState(false)

  const catalogQuery = useQuery({
    queryKey: ['permissions-catalog'],
    queryFn: async () => {
      const res = await api.get<CatalogResponse>('/permissions')
      return res.data
    },
    enabled: canAccessAdmin(user?.role),
  })

  const roleQuery = useQuery({
    queryKey: ['permissions-role', selectedRole],
    queryFn: async () => {
      const res = await api.get<RoleDetailResponse>(
        `/permissions?scope=role&role=${selectedRole}`
      )
      return res.data
    },
    enabled: canAccessAdmin(user?.role) && tab === 'role',
  })

  const userQuery = useQuery({
    queryKey: ['permissions-user', selectedUserId],
    queryFn: async () => {
      const res = await api.get<UserDetailResponse>(
        `/permissions?scope=user&userId=${selectedUserId}`
      )
      return res.data
    },
    enabled: canAccessAdmin(user?.role) && tab === 'user' && !!selectedUserId,
  })

  useEffect(() => {
    if (tab === 'role' && roleQuery.data) {
      setDraftKeys(new Set(roleQuery.data.permissionKeys))
      setDirty(false)
    }
  }, [tab, roleQuery.data])

  useEffect(() => {
    if (tab === 'user' && userQuery.data) {
      setDraftKeys(new Set(userQuery.data.permissionKeys))
      setDirty(false)
    }
  }, [tab, userQuery.data])

  useEffect(() => {
    if (!selectedUserId && catalogQuery.data?.users?.[0]) {
      setSelectedUserId(catalogQuery.data.users[0].id)
    }
  }, [catalogQuery.data, selectedUserId])

  const lockedKeys = useMemo(() => {
    if (tab === 'role') {
      return selectedRole === 'ADMIN'
        ? [...ADMIN_LOCKED_PERMISSION_KEYS]
        : [...ALWAYS_GRANTED_PERMISSION_KEYS]
    }
    if (userQuery.data?.user.role === 'ADMIN') {
      return [...ADMIN_LOCKED_PERMISSION_KEYS]
    }
    return [...ALWAYS_GRANTED_PERMISSION_KEYS]
  }, [tab, selectedRole, userQuery.data?.user.role])

  const roleDefaults = useMemo(() => {
    if (tab !== 'user' || !userQuery.data) return undefined
    return new Set(userQuery.data.rolePermissionKeys)
  }, [tab, userQuery.data])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (tab === 'role') {
        return api.put('/permissions', {
          mode: 'role',
          role: selectedRole,
          permissionKeys: [...draftKeys],
        })
      }
      return api.put('/permissions', {
        mode: 'user',
        userId: selectedUserId,
        permissionKeys: [...draftKeys],
      })
    },
    onSuccess: (res: { message?: string }) => {
      toast({
        title: 'Permissions saved',
        description: res.message || 'Access rules updated.',
      })
      setDirty(false)
      queryClient.invalidateQueries({ queryKey: ['permissions-catalog'] })
      queryClient.invalidateQueries({ queryKey: ['permissions-role'] })
      queryClient.invalidateQueries({ queryKey: ['permissions-user'] })
      queryClient.invalidateQueries({ queryKey: ['my-permissions'] })
    },
    onError: (error: Error) => {
      toast({
        title: 'Save failed',
        description: error.message || 'Could not save permissions',
        variant: 'destructive',
      })
    },
  })

  const resetUserMutation = useMutation({
    mutationFn: async () =>
      api.put('/permissions', {
        mode: 'user',
        userId: selectedUserId,
        resetToRole: true,
      }),
    onSuccess: (res: { message?: string }) => {
      toast({
        title: 'Reset to role',
        description: res.message || 'User overrides cleared.',
      })
      queryClient.invalidateQueries({ queryKey: ['permissions-catalog'] })
      queryClient.invalidateQueries({ queryKey: ['permissions-user'] })
      queryClient.invalidateQueries({ queryKey: ['my-permissions'] })
    },
    onError: (error: Error) => {
      toast({
        title: 'Reset failed',
        description: error.message,
        variant: 'destructive',
      })
    },
  })

  const toggleKey = (key: string, next: boolean) => {
    if (lockedKeys.includes(key) && !next) return
    setDraftKeys((prev) => {
      const copy = new Set(prev)
      if (next) copy.add(key)
      else copy.delete(key)
      return copy
    })
    setDirty(true)
  }

  const toggleGroup = (keys: string[], next: boolean) => {
    setDraftKeys((prev) => {
      const copy = new Set(prev)
      for (const key of keys) {
        if (!next && lockedKeys.includes(key)) continue
        if (next) copy.add(key)
        else copy.delete(key)
      }
      return copy
    })
    setDirty(true)
  }

  if (!canAccessAdmin(user?.role)) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Admin access required to manage roles and permissions.
      </div>
    )
  }

  const sections = catalogQuery.data?.sections ?? []
  const loading =
    catalogQuery.isLoading ||
    (tab === 'role' ? roleQuery.isLoading : userQuery.isLoading)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            Roles & Permissions
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Choose which menu sections and pages each role can open. Optionally
            customize access for an individual user without changing their role.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === 'user' && selectedUserId && (
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              disabled={resetUserMutation.isPending || !userQuery.data?.overrides?.length}
              onClick={() => resetUserMutation.mutate()}
            >
              <RotateCcw className="h-4 w-4" />
              Reset to role
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              catalogQuery.refetch()
              if (tab === 'role') roleQuery.refetch()
              else userQuery.refetch()
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button
            type="button"
            className="gap-1.5"
            disabled={!dirty || saveMutation.isPending || loading}
            onClick={() => saveMutation.mutate()}
          >
            <Save className="h-4 w-4" />
            {saveMutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as 'role' | 'user')
          setDirty(false)
        }}
      >
        <TabsList>
          <TabsTrigger value="role" className="gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            By role
          </TabsTrigger>
          <TabsTrigger value="user" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            By user
          </TabsTrigger>
        </TabsList>

        <TabsContent value="role" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
            <Card className="h-fit shadow-none">
              <CardHeader className="py-3 px-3">
                <CardTitle className="text-sm">Roles</CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-3 pt-0 space-y-1">
                {APP_ROLES.map((role) => {
                  const meta = catalogQuery.data?.roles.find((r) => r.role === role)
                  const active = selectedRole === role
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => {
                        setSelectedRole(role)
                        setDirty(false)
                      }}
                      className={cn(
                        'w-full rounded-md px-3 py-2 text-left text-sm transition-colors',
                        active
                          ? 'bg-emerald-600 text-white'
                          : 'hover:bg-muted text-foreground'
                      )}
                    >
                      <div className="font-medium">{formatRoleLabel(role)}</div>
                      <div
                        className={cn(
                          'text-[11px]',
                          active ? 'text-emerald-50' : 'text-muted-foreground'
                        )}
                      >
                        {meta?.permissionKeys.length ?? '—'} pages
                      </div>
                    </button>
                  )
                })}
              </CardContent>
            </Card>

            <div>
              <div className="mb-3 flex items-center gap-2">
                <Badge variant="outline">{formatRoleLabel(selectedRole)}</Badge>
                {dirty && (
                  <span className="text-xs text-amber-700">Unsaved changes</span>
                )}
              </div>
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-28 w-full" />
                  <Skeleton className="h-28 w-full" />
                </div>
              ) : (
                <PermissionMatrix
                  sections={sections}
                  selected={draftKeys}
                  lockedKeys={lockedKeys}
                  onToggle={toggleKey}
                  onToggleGroup={toggleGroup}
                />
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="user" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <Card className="shadow-none">
              <CardHeader className="py-3 px-3">
                <CardTitle className="text-sm">Active users</CardTitle>
                <CardDescription className="text-xs">
                  Custom ticks override the role matrix for that person only.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-2 pb-3 pt-0">
                <ScrollArea className="h-[min(70vh,640px)] pr-2">
                  <div className="space-y-1">
                    {(catalogQuery.data?.users ?? []).map((row) => {
                      const active = selectedUserId === row.id
                      return (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => {
                            setSelectedUserId(row.id)
                            setDirty(false)
                          }}
                          className={cn(
                            'w-full rounded-md px-3 py-2 text-left text-sm transition-colors',
                            active
                              ? 'bg-emerald-600 text-white'
                              : 'hover:bg-muted text-foreground'
                          )}
                        >
                          <div className="font-medium truncate">{row.name}</div>
                          <div
                            className={cn(
                              'truncate text-[11px]',
                              active ? 'text-emerald-50' : 'text-muted-foreground'
                            )}
                          >
                            {row.roleLabel}
                            {row.overrideCount > 0
                              ? ` · ${row.overrideCount} custom`
                              : ''}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <div>
              {userQuery.data ? (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div>
                    <div className="font-medium">{userQuery.data.user.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {userQuery.data.user.email}
                    </div>
                  </div>
                  <Badge variant="outline">{userQuery.data.user.roleLabel}</Badge>
                  {userQuery.data.overrides.length > 0 && (
                    <Badge className="bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-50">
                      {userQuery.data.overrides.length} overrides
                    </Badge>
                  )}
                  {dirty && (
                    <span className="text-xs text-amber-700">Unsaved changes</span>
                  )}
                </div>
              ) : (
                <div className="mb-3 text-sm text-muted-foreground">
                  Select a user to edit page access.
                </div>
              )}

              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-28 w-full" />
                  <Skeleton className="h-28 w-full" />
                </div>
              ) : (
                <PermissionMatrix
                  sections={sections}
                  selected={draftKeys}
                  lockedKeys={lockedKeys}
                  roleDefaults={roleDefaults}
                  onToggle={toggleKey}
                  onToggleGroup={toggleGroup}
                />
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
