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
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { api } from '@/lib/api-client'
import { useAuthStore, canAccessAdmin } from '@/lib/auth-store'
import { useToast } from '@/hooks/use-toast'
import { type AppRole } from '@/lib/roles'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

type PermissionSection = {
  group: string
  pages: Array<{ page: AppPermissionDef; actions: AppPermissionDef[] }>
}

type AccessRoleSummary = {
  id: string
  key: string
  label: string
  description: string | null
  baseRole: AppRole
  baseRoleLabel: string
  isSystem: boolean
  userCount: number
  permissionCount: number
}

type CatalogUser = {
  id: string
  name: string
  email: string
  role: AppRole
  roleLabel: string
  accessRoleId: string | null
  accessRoleLabel: string
  overrideCount: number
}

type CatalogResponse = {
  success: boolean
  data: {
    sections: PermissionSection[]
    baseRoles: Array<{ role: AppRole; label: string }>
    roles: AccessRoleSummary[]
    users: CatalogUser[]
  }
}

type AccessRoleDetailResponse = {
  success: boolean
  data: {
    role: AccessRoleSummary & { active: boolean; sortOrder: number }
    permissionKeys: string[]
    lockedKeys: string[]
  }
}

type UserDetailResponse = {
  success: boolean
  data: {
    user: CatalogUser & {
      active: boolean
      accessRole: { id: string; label: string; isSystem: boolean } | null
    }
    rolePermissionKeys: string[]
    permissionKeys: string[]
    lockedKeys: string[]
    overrides: Array<{ permissionKey: string; granted: boolean }>
  }
}

function sectionKeys(section: PermissionSection): string[] {
  return section.pages.flatMap(({ page, actions }) => [
    page.key,
    ...actions.map((a) => a.key),
  ])
}

function PermissionMatrix({
  sections,
  selected,
  lockedKeys,
  roleDefaults,
  onToggle,
  onToggleKeys,
}: {
  sections: PermissionSection[]
  selected: Set<string>
  lockedKeys: string[]
  roleDefaults?: Set<string>
  onToggle: (key: string, next: boolean) => void
  onToggleKeys: (keys: string[], next: boolean) => void
}) {
  const locked = useMemo(() => new Set(lockedKeys), [lockedKeys])
  const [expandedPages, setExpandedPages] = useState<Set<string>>(() => new Set())

  const inheritBadge = (key: string, checked: boolean) => {
    if (roleDefaults == null) return null
    if (roleDefaults.has(key) === checked) return null
    return roleDefaults.has(key) ? 'denied' : 'granted'
  }

  const setPageExpanded = (pageKey: string, next: boolean) => {
    setExpandedPages((prev) => {
      const copy = new Set(prev)
      if (next) copy.add(pageKey)
      else copy.delete(pageKey)
      return copy
    })
  }

  const togglePageExpanded = (pageKey: string) => {
    setExpandedPages((prev) => {
      const copy = new Set(prev)
      if (copy.has(pageKey)) copy.delete(pageKey)
      else copy.add(pageKey)
      return copy
    })
  }

  const handleActionToggle = (pageKey: string, actionKey: string, next: boolean) => {
    if (next && !selected.has(pageKey)) {
      onToggleKeys([pageKey, actionKey], true)
      return
    }
    onToggle(actionKey, next)
  }

  return (
    <div className="space-y-4">
      {sections.map((section) => {
        const keys = sectionKeys(section)
        const enabledCount = keys.filter((k) => selected.has(k)).length
        const allOn = enabledCount === keys.length
        const expandableKeys = section.pages
          .filter(({ actions }) => actions.length > 0)
          .map(({ page }) => page.key)
        const allExpanded =
          expandableKeys.length > 0 &&
          expandableKeys.every((key) => expandedPages.has(key))

        return (
          <Card key={section.group} className="border-border/70 shadow-none">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 px-4 py-3">
              <div>
                <CardTitle className="text-sm font-semibold tracking-wide">
                  {section.group}
                </CardTitle>
                <CardDescription className="text-xs">
                  {enabledCount} of {keys.length} permissions enabled
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {expandableKeys.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => {
                      setExpandedPages((prev) => {
                        const copy = new Set(prev)
                        if (allExpanded) {
                          for (const key of expandableKeys) copy.delete(key)
                        } else {
                          for (const key of expandableKeys) copy.add(key)
                        }
                        return copy
                      })
                    }}
                  >
                    {allExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    {allExpanded ? 'Collapse all' : 'Expand all'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => onToggleKeys(keys, !allOn)}
                >
                  {allOn ? (
                    <CheckSquare className="h-3.5 w-3.5" />
                  ) : (
                    <Square className="h-3.5 w-3.5" />
                  )}
                  {allOn ? 'Clear section' : 'Select all'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4 pt-0">
              {section.pages.map(({ page, actions }) => {
                const pageOn = selected.has(page.key)
                const actionKeys = actions.map((a) => a.key)
                const enabledActions = actionKeys.filter((k) => selected.has(k)).length
                const allActionsOn =
                  actionKeys.length > 0 && enabledActions === actionKeys.length
                const expanded = expandedPages.has(page.key)
                const hasDetails = actions.length > 0

                return (
                  <div
                    key={page.key}
                    className={cn(
                      'rounded-lg border transition-colors',
                      pageOn ? 'border-emerald-200/80 bg-emerald-50/30' : 'border-border/80'
                    )}
                  >
                    <div className="flex items-start gap-2 px-3 py-2.5">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                        <Checkbox
                          checked={pageOn}
                          disabled={locked.has(page.key) && pageOn}
                          onCheckedChange={(value) => {
                            const next = value === true
                            if (!next && actionKeys.length > 0) {
                              onToggleKeys([page.key, ...actionKeys], false)
                            } else {
                              onToggle(page.key, next)
                              if (next && hasDetails) setPageExpanded(page.key, true)
                            }
                          }}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium leading-tight">
                            {page.label}
                            {locked.has(page.key) && (
                              <Lock className="h-3 w-3 text-muted-foreground" />
                            )}
                            {hasDetails && (
                              <Badge
                                variant="outline"
                                className="h-5 border-border/80 text-[10px] font-normal text-muted-foreground"
                              >
                                {enabledActions}/{actions.length} details
                              </Badge>
                            )}
                          </span>
                          {page.description ? (
                            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                              {page.description}
                            </span>
                          ) : null}
                          {inheritBadge(page.key, pageOn) === 'granted' && (
                            <Badge
                              variant="outline"
                              className="mt-1 h-5 border-sky-200 bg-sky-50 text-[10px] text-sky-700"
                            >
                              Extra grant
                            </Badge>
                          )}
                          {inheritBadge(page.key, pageOn) === 'denied' && (
                            <Badge
                              variant="outline"
                              className="mt-1 h-5 border-amber-200 bg-amber-50 text-[10px] text-amber-700"
                            >
                              Role default removed
                            </Badge>
                          )}
                        </span>
                      </label>
                      {hasDetails && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0 gap-1 px-2.5 text-xs"
                          onClick={() => togglePageExpanded(page.key)}
                          aria-expanded={expanded}
                        >
                          {expanded ? (
                            <>
                              <ChevronUp className="h-3.5 w-3.5" />
                              Reduce
                            </>
                          ) : (
                            <>
                              <ChevronDown className="h-3.5 w-3.5" />
                              Expand
                            </>
                          )}
                        </Button>
                      )}
                    </div>

                    {hasDetails && expanded && (
                      <div className="border-t border-border/60 px-3 pb-3 pt-2">
                        <div className="mb-2 flex items-center justify-between pl-6">
                          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Detailed access
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              if (allActionsOn) {
                                onToggleKeys(actionKeys, false)
                              } else {
                                onToggleKeys([page.key, ...actionKeys], true)
                              }
                            }}
                          >
                            {allActionsOn ? 'Clear details' : 'Select all details'}
                          </Button>
                        </div>
                        <div className="space-y-1.5 pl-6">
                          {actions.map((action) => {
                            const checked = selected.has(action.key)
                            const isLocked = locked.has(action.key)
                            return (
                              <label
                                key={action.key}
                                className={cn(
                                  'flex items-start gap-2.5 rounded-md border px-2.5 py-2',
                                  checked
                                    ? 'border-emerald-200/70 bg-background'
                                    : 'border-transparent bg-background/60'
                                )}
                              >
                                <Checkbox
                                  checked={checked}
                                  disabled={isLocked && checked}
                                  onCheckedChange={(value) =>
                                    handleActionToggle(
                                      page.key,
                                      action.key,
                                      value === true
                                    )
                                  }
                                  className="mt-0.5"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center gap-1.5 text-sm leading-tight">
                                    {action.label}
                                    {isLocked && (
                                      <Lock className="h-3 w-3 text-muted-foreground" />
                                    )}
                                  </span>
                                  {action.description ? (
                                    <span className="mt-0.5 block text-xs text-muted-foreground">
                                      {action.description}
                                    </span>
                                  ) : null}
                                  {inheritBadge(action.key, checked) === 'granted' && (
                                    <Badge
                                      variant="outline"
                                      className="mt-1 h-5 border-sky-200 bg-sky-50 text-[10px] text-sky-700"
                                    >
                                      Extra grant
                                    </Badge>
                                  )}
                                  {inheritBadge(action.key, checked) === 'denied' && (
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
                      </div>
                    )}
                  </div>
                )
              })}
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
  const [selectedAccessRoleId, setSelectedAccessRoleId] = useState<string | null>(null)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [draftKeys, setDraftKeys] = useState<Set<string>>(new Set())
  const [draftAccessRoleId, setDraftAccessRoleId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  const [addRoleOpen, setAddRoleOpen] = useState(false)
  const [addRoleForm, setAddRoleForm] = useState({
    label: '',
    description: '',
    baseRole: 'HOTEL_STAFF' as AppRole,
  })
  const [deleteOpen, setDeleteOpen] = useState(false)

  const catalogQuery = useQuery({
    queryKey: ['permissions-catalog'],
    queryFn: async () => {
      const res = await api.get<CatalogResponse>('/permissions')
      return res.data
    },
    enabled: canAccessAdmin(user?.role),
  })

  const accessRoleQuery = useQuery({
    queryKey: ['permissions-access-role', selectedAccessRoleId],
    queryFn: async () => {
      const res = await api.get<AccessRoleDetailResponse>(
        `/permissions?scope=access-role&accessRoleId=${selectedAccessRoleId}`
      )
      return res.data
    },
    enabled:
      canAccessAdmin(user?.role) && tab === 'role' && !!selectedAccessRoleId,
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

  const roles = catalogQuery.data?.roles ?? []
  const selectedRoleMeta = roles.find((r) => r.id === selectedAccessRoleId)

  useEffect(() => {
    if (!selectedAccessRoleId && roles.length > 0) {
      setSelectedAccessRoleId(roles[0].id)
    }
  }, [roles, selectedAccessRoleId])

  useEffect(() => {
    if (!selectedUserId && catalogQuery.data?.users?.[0]) {
      setSelectedUserId(catalogQuery.data.users[0].id)
    }
  }, [catalogQuery.data, selectedUserId])

  useEffect(() => {
    if (tab === 'role' && accessRoleQuery.data) {
      setDraftKeys(new Set(accessRoleQuery.data.permissionKeys))
      setDirty(false)
    }
  }, [tab, accessRoleQuery.data])

  useEffect(() => {
    if (tab === 'user' && userQuery.data) {
      setDraftKeys(new Set(userQuery.data.permissionKeys))
      setDraftAccessRoleId(userQuery.data.user.accessRoleId)
      setDirty(false)
    }
  }, [tab, userQuery.data])

  const lockedKeys = useMemo(() => {
    const base = new Set<string>(ALWAYS_GRANTED_PERMISSION_KEYS)
    if (tab === 'role') {
      for (const key of accessRoleQuery.data?.lockedKeys ?? []) base.add(key)
      if (
        selectedRoleMeta?.isSystem &&
        selectedRoleMeta.baseRole === 'ADMIN'
      ) {
        for (const key of ADMIN_LOCKED_PERMISSION_KEYS) base.add(key)
      }
      return [...base]
    }
    for (const key of userQuery.data?.lockedKeys ?? []) base.add(key)
    if (userQuery.data?.user.role === 'ADMIN') {
      for (const key of ADMIN_LOCKED_PERMISSION_KEYS) base.add(key)
    }
    return [...base]
  }, [tab, accessRoleQuery.data?.lockedKeys, selectedRoleMeta, userQuery.data])

  const roleDefaults = useMemo(() => {
    if (tab !== 'user' || !userQuery.data) return undefined
    return new Set(userQuery.data.rolePermissionKeys)
  }, [tab, userQuery.data])

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['permissions-catalog'] })
    queryClient.invalidateQueries({ queryKey: ['permissions-access-role'] })
    queryClient.invalidateQueries({ queryKey: ['permissions-user'] })
    queryClient.invalidateQueries({ queryKey: ['my-permissions'] })
  }

  const createRoleMutation = useMutation({
    mutationFn: async () =>
      api.post<{ success: boolean; data: { id: string; label: string }; message?: string }>(
        '/permissions',
        {
          label: addRoleForm.label.trim(),
          description: addRoleForm.description.trim() || null,
          baseRole: 'HOTEL_STAFF',
          permissionKeys: [],
        }
      ),
    onSuccess: (res) => {
      toast({
        title: 'Role created',
        description: res.message || `“${addRoleForm.label.trim()}” is ready to configure.`,
      })
      setAddRoleOpen(false)
      setAddRoleForm({ label: '', description: '', baseRole: 'HOTEL_STAFF' })
      if (res.data?.id) setSelectedAccessRoleId(res.data.id)
      invalidateAll()
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: ['access-roles-for-users'] })
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not create role',
        description: error.message,
        variant: 'destructive',
      })
    },
  })

  const deleteRoleMutation = useMutation({
    mutationFn: async () =>
      api.delete<{ success: boolean; message?: string }>(
        `/permissions?accessRoleId=${selectedAccessRoleId}`
      ),
    onSuccess: (res) => {
      toast({
        title: 'Role deleted',
        description: res.message || 'Custom access role removed.',
      })
      setDeleteOpen(false)
      setSelectedAccessRoleId(null)
      invalidateAll()
    },
    onError: (error: Error) => {
      toast({
        title: 'Delete failed',
        description: error.message,
        variant: 'destructive',
      })
    },
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (tab === 'role') {
        return api.put<{ success: boolean; message?: string }>('/permissions', {
          mode: 'access-role',
          accessRoleId: selectedAccessRoleId,
          permissionKeys: [...draftKeys],
        })
      }
      return api.put<{ success: boolean; message?: string }>('/permissions', {
        mode: 'user',
        userId: selectedUserId,
        accessRoleId: draftAccessRoleId,
        permissionKeys: [...draftKeys],
      })
    },
    onSuccess: (res) => {
      toast({
        title: 'Permissions saved',
        description: res.message || 'Access rules updated.',
      })
      setDirty(false)
      invalidateAll()
    },
    onError: (error: Error) => {
      toast({
        title: 'Save failed',
        description: error.message || 'Could not save permissions',
        variant: 'destructive',
      })
    },
  })

  const handleDraftAccessRoleChange = async (accessRoleId: string) => {
    setDraftAccessRoleId(accessRoleId)
    setDirty(true)
    try {
      const res = await api.get<AccessRoleDetailResponse>(
        `/permissions?scope=access-role&accessRoleId=${accessRoleId}`
      )
      if (res.data?.permissionKeys) {
        setDraftKeys(new Set(res.data.permissionKeys))
      }
    } catch {
      // Keep current permission draft if role defaults cannot be loaded.
    }
  }

  const resetUserMutation = useMutation({
    mutationFn: async () =>
      api.put<{ success: boolean; message?: string }>('/permissions', {
        mode: 'user',
        userId: selectedUserId,
        resetToRole: true,
      }),
    onSuccess: (res) => {
      toast({
        title: 'Reset to role',
        description: res.message || 'User overrides cleared.',
      })
      invalidateAll()
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
      if (next) {
        copy.add(key)
      } else {
        copy.delete(key)
        if (key.startsWith('page.')) {
          for (const section of catalogQuery.data?.sections ?? []) {
            for (const { page, actions } of section.pages) {
              if (page.key === key) {
                for (const action of actions) copy.delete(action.key)
              }
            }
          }
        }
      }
      return copy
    })
    setDirty(true)
  }

  const toggleKeys = (keys: string[], next: boolean) => {
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
    (tab === 'role' ? accessRoleQuery.isLoading : userQuery.isLoading)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            Roles & Permissions
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Configure access roles and fine-tune page and action permissions per
            role or individual user.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === 'role' && (
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              onClick={() => setAddRoleOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Add role
            </Button>
          )}
          {tab === 'role' && selectedRoleMeta && !selectedRoleMeta.isSystem && (
            <Button
              type="button"
              variant="outline"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
              disabled={deleteRoleMutation.isPending}
            >
              <Trash2 className="h-4 w-4" />
              Delete role
            </Button>
          )}
          {tab === 'user' && selectedUserId && (
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              disabled={
                resetUserMutation.isPending ||
                !userQuery.data?.overrides?.length
              }
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
              if (tab === 'role') accessRoleQuery.refetch()
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
        className="flex min-h-0 flex-1 flex-col gap-2"
      >
        <TabsList className="shrink-0">
          <TabsTrigger value="role" className="gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            By role
          </TabsTrigger>
          <TabsTrigger value="user" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            By user
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="role"
          className="mt-0 min-h-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-stretch">
            <aside className="w-full shrink-0 lg:w-[260px] lg:overflow-y-auto">
              <Card className="gap-1.5 py-2 shadow-none">
                <CardHeader className="gap-0.5 px-3 py-1.5">
                  <CardTitle className="text-sm">Access roles</CardTitle>
                  <CardDescription className="text-xs">
                    System and custom role templates
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-0.5 px-2 pb-2 pt-0">
                  {catalogQuery.isLoading ? (
                    <div className="space-y-2 px-1">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : (
                    roles.map((role) => {
                      const active = selectedAccessRoleId === role.id
                      return (
                        <button
                          key={role.id}
                          type="button"
                          onClick={() => {
                            setSelectedAccessRoleId(role.id)
                            setDirty(false)
                          }}
                          className={cn(
                            'w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                            active
                              ? 'bg-emerald-600 text-white'
                              : 'text-foreground hover:bg-muted'
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{role.label}</span>
                            {role.isSystem ? (
                              <Badge
                                variant="outline"
                                className={cn(
                                  'h-5 border-current/20 text-[10px]',
                                  active && 'border-white/30 text-emerald-50'
                                )}
                              >
                                System
                              </Badge>
                            ) : null}
                          </div>
                          <div
                            className={cn(
                              'text-[11px] leading-snug',
                              active ? 'text-emerald-50' : 'text-muted-foreground'
                            )}
                          >
                            {role.userCount} user{role.userCount === 1 ? '' : 's'}
                            {' · '}
                            {role.permissionCount} permissions
                          </div>
                        </button>
                      )
                    })
                  )}
                </CardContent>
              </Card>
            </aside>

            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
              {selectedRoleMeta ? (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{selectedRoleMeta.label}</Badge>
                  {selectedRoleMeta.isSystem && (
                    <Badge variant="secondary" className="font-normal">
                      System
                    </Badge>
                  )}
                  {dirty && (
                    <span className="text-xs text-amber-700">Unsaved changes</span>
                  )}
                </div>
              ) : null}

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
                  onToggleKeys={toggleKeys}
                />
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent
          value="user"
          className="mt-0 min-h-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-stretch">
            <aside className="w-full shrink-0 lg:w-[280px] lg:overflow-y-auto">
              <Card className="gap-1.5 py-2 shadow-none">
                <CardHeader className="gap-0.5 px-3 py-1.5">
                  <CardTitle className="text-sm">Active users</CardTitle>
                  <CardDescription className="text-xs">
                    Override permissions for a specific person.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-0.5 px-2 pb-2 pt-0">
                  {catalogQuery.isLoading ? (
                    <div className="space-y-2 px-1">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : (
                    (catalogQuery.data?.users ?? []).map((row) => {
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
                            'w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                            active
                              ? 'bg-emerald-600 text-white'
                              : 'text-foreground hover:bg-muted'
                          )}
                        >
                          <div className="font-medium truncate">{row.name}</div>
                          <div
                            className={cn(
                              'truncate text-[11px] leading-snug',
                              active ? 'text-emerald-50' : 'text-muted-foreground'
                            )}
                          >
                            {row.accessRoleLabel}
                            {row.overrideCount > 0
                              ? ` · ${row.overrideCount} custom`
                              : ''}
                          </div>
                        </button>
                      )
                    })
                  )}
                </CardContent>
              </Card>
            </aside>

            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
              {userQuery.data ? (
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 shrink-0 font-medium">
                    {userQuery.data.user.name}
                  </div>
                  <div className="min-w-0 truncate text-sm text-muted-foreground sm:max-w-xs sm:flex-1">
                    {userQuery.data.user.email}
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2 sm:ml-auto">
                    {userQuery.data.overrides.length > 0 && (
                      <Badge className="border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-50">
                        {userQuery.data.overrides.length} overrides
                      </Badge>
                    )}
                    {dirty && (
                      <span className="text-xs text-amber-700">Unsaved changes</span>
                    )}
                    <Label htmlFor="user-access-role" className="shrink-0 text-xs">
                      Access role
                    </Label>
                    <Select
                      value={draftAccessRoleId ?? undefined}
                      disabled={saveMutation.isPending || loading}
                      onValueChange={(value) => {
                        void handleDraftAccessRoleChange(value)
                      }}
                    >
                      <SelectTrigger id="user-access-role" className="h-9 w-full sm:w-48">
                        <SelectValue placeholder="Select access role" />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map((role) => (
                          <SelectItem key={role.id} value={role.id}>
                            {role.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : (
                <div className="mb-3 text-sm text-muted-foreground">
                  Select a user to edit permissions.
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
                  onToggleKeys={toggleKeys}
                />
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={addRoleOpen} onOpenChange={setAddRoleOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add access role</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            New roles start with{' '}
            <span className="font-medium text-foreground">0 permissions</span>.
            After creation, grant pages/actions and assign the role to users.
          </p>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="role-label">Role name *</Label>
              <Input
                id="role-label"
                value={addRoleForm.label}
                onChange={(e) =>
                  setAddRoleForm((f) => ({ ...f, label: e.target.value }))
                }
                placeholder="e.g. Night auditor"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-description">Description</Label>
              <Textarea
                id="role-description"
                rows={3}
                value={addRoleForm.description}
                onChange={(e) =>
                  setAddRoleForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Optional notes about this role"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddRoleOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!addRoleForm.label.trim() || createRoleMutation.isPending}
              onClick={() => createRoleMutation.mutate()}
            >
              {createRoleMutation.isPending ? 'Creating…' : 'Create role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete custom role?</AlertDialogTitle>
            <AlertDialogDescription>
              “{selectedRoleMeta?.label}” will be permanently removed. Users assigned
              to this role must be reassigned first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteRoleMutation.mutate()}
            >
              Delete role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
