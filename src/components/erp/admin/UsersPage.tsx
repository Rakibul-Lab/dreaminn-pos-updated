'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useAuthStore, canAccessAdmin } from '@/lib/auth-store'
import { useToast } from '@/hooks/use-toast'
import { format } from 'date-fns'
import {
  Users, Plus, Edit2, Power, RefreshCw, Shield, ShieldCheck, ShieldAlert, SprayCan
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { EmailInput } from '@/components/ui/email-input'
import { Label } from '@/components/ui/label'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { formatRoleLabel } from '@/lib/roles'

interface UserData {
  id: string
  email: string
  name: string
  role: string
  phone: string | null
  avatar: string | null
  active: boolean
  createdAt: string
}

const roleIcons: Record<string, React.ReactNode> = {
  ADMIN: <ShieldAlert className="h-4 w-4 text-red-500" />,
  HOTEL_STAFF: <ShieldCheck className="h-4 w-4 text-emerald-500" />,
  HOTEL_FD: <ShieldCheck className="h-4 w-4 text-teal-500" />,
  HOUSEKEEPER: <SprayCan className="h-4 w-4 text-violet-500" />,
  RESTAURANT_STAFF: <Shield className="h-4 w-4 text-amber-500" />,
}

const roleColors: Record<string, string> = {
  ADMIN: 'bg-red-50 text-red-700 border-red-200',
  HOTEL_STAFF: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  HOTEL_FD: 'bg-teal-50 text-teal-700 border-teal-200',
  HOUSEKEEPER: 'bg-violet-50 text-violet-700 border-violet-200',
  RESTAURANT_STAFF: 'bg-amber-50 text-amber-700 border-amber-200',
}

export default function UsersPage() {
  const { user, updateUser } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [showDialog, setShowDialog] = useState(false)
  const [editingUser, setEditingUser] = useState<UserData | null>(null)
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'HOTEL_STAFF',
    phone: '',
    avatar: null as string | null,
  })
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const [avatarInputKey, setAvatarInputKey] = useState(0)
  const [emailBlocking, setEmailBlocking] = useState(false)

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: UserData[]; meta?: { total: number } }>('/users?limit=50')
      return res
    },
    enabled: !!user && canAccessAdmin(user?.role),
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      return api.post('/users', form)
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast({ title: 'User Created', description: res.message || 'User created successfully' })
      closeDialog()
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to create user', variant: 'destructive' })
    },
  })

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return api.put('/users', data)
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast({ title: 'User Updated', description: res.message || 'User updated successfully' })

      if (user && res?.data?.id === user.id) {
        updateUser({
          name: res.data.name,
          email: res.data.email,
          role: res.data.role,
          avatar: res.data.avatar ?? null,
          phone: res.data.phone ?? null,
        })
      }

      closeDialog()
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to update user', variant: 'destructive' })
    },
  })

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      return api.put('/users', { id, active })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast({ title: 'Status Updated', description: 'User status has been toggled' })
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to update status', variant: 'destructive' })
    },
  })

  const closeDialog = () => {
    setShowDialog(false)
    setEditingUser(null)
    setForm({ name: '', email: '', password: '', role: 'HOTEL_STAFF', phone: '', avatar: null })
    setAvatarInputKey((k) => k + 1)
  }

  const openEditDialog = (u: UserData) => {
    setEditingUser(u)
    setForm({
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      phone: u.phone || '',
      avatar: u.avatar || null,
    })
    setAvatarInputKey((k) => k + 1)
    setShowDialog(true)
  }

  const openAddDialog = () => {
    setEditingUser(null)
    setForm({ name: '', email: '', password: '', role: 'HOTEL_STAFF', phone: '', avatar: null })
    setAvatarInputKey((k) => k + 1)
    setShowDialog(true)
  }

  const handleChooseAvatar = async (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file', description: 'Please select an image file', variant: 'destructive' })
      return
    }
    const maxBytes = 2 * 1024 * 1024
    if (file.size > maxBytes) {
      toast({ title: 'Image too large', description: 'Please choose an image under 2MB', variant: 'destructive' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      setForm((f) => ({ ...f, avatar: result || null }))
    }
    reader.onerror = () => toast({ title: 'Error', description: 'Failed to read image', variant: 'destructive' })
    reader.readAsDataURL(file)
  }

  const handleSubmit = () => {
    if (emailBlocking) {
      toast({ title: 'Invalid email', description: 'Enter a valid email address', variant: 'destructive' })
      return
    }
    if (editingUser) {
      const data: Record<string, unknown> = {
        id: editingUser.id,
        name: form.name,
        email: form.email,
        role: form.role,
        phone: form.phone || null,
        avatar: form.avatar,
      }
      if (form.password) data.password = form.password
      updateMutation.mutate(data)
    } else {
      createMutation.mutate()
    }
  }

  if (!user || !canAccessAdmin(user.role)) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="p-6 text-center">
          <p className="text-amber-700 font-medium">Access Denied</p>
          <p className="text-amber-600 text-sm mt-1">Only administrators can manage users.</p>
        </CardContent>
      </Card>
    )
  }

  const users = usersData?.data || []

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="h-6 w-6 text-amber-600" />
            User Management
          </h2>
          <p className="text-muted-foreground text-sm mt-1">Manage system users and roles</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['users'] })}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={openAddDialog} className="bg-amber-600 hover:bg-amber-700 text-white">
            <Plus className="h-4 w-4 mr-2" /> Add User
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No users found</TableCell>
                  </TableRow>
                ) : (
                  users.map((u) => (
                    <TableRow key={u.id} className="hover:bg-muted">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full border bg-muted overflow-hidden flex items-center justify-center text-xs font-semibold text-muted-foreground">
                            {u.avatar ? (
                              <Image src={u.avatar} alt={u.name} width={32} height={32} className="h-full w-full object-cover" unoptimized />
                            ) : (
                              <span>{u.name?.charAt(0) || 'U'}</span>
                            )}
                          </div>
                          <span>{u.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`${roleColors[u.role] || ''} flex items-center gap-1 w-fit`}>
                          {roleIcons[u.role]}
                          {formatRoleLabel(u.role)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{u.phone || '-'}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={u.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}
                        >
                          {u.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(u.createdAt), 'MMM dd, yyyy')}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditDialog(u)} title="Edit">
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => toggleActiveMutation.mutate({ id: u.id, active: !u.active })}
                            title={u.active ? 'Deactivate' : 'Activate'}
                          >
                            <Power className={`h-4 w-4 ${u.active ? 'text-red-500' : 'text-emerald-500'}`} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add/Edit User Dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUser ? 'Edit User' : 'Add New User'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Profile Image</Label>
              <div className="flex items-center gap-3">
                <div className="h-14 w-14 rounded-full border bg-muted overflow-hidden flex items-center justify-center text-sm font-semibold text-muted-foreground">
                  {form.avatar ? (
                    <Image src={form.avatar} alt="Avatar preview" width={56} height={56} className="h-full w-full object-cover" unoptimized />
                  ) : (
                    <span>{form.name?.charAt(0) || 'U'}</span>
                  )}
                </div>
                <div className="flex-1">
                  <Input
                    key={avatarInputKey}
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleChooseAvatar(e.target.files?.[0] || null)}
                  />
                  <div className="mt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setForm((f) => ({ ...f, avatar: null }))
                        if (avatarInputRef.current) avatarInputRef.current.value = ''
                        setAvatarInputKey((k) => k + 1)
                      }}
                    >
                      Remove Image
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                placeholder="Full name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <EmailInput
                placeholder="Email address"
                value={form.email}
                onChange={(email) => setForm((f) => ({ ...f, email }))}
                onValidationChange={(result) => {
                  setEmailBlocking(result.isBlocking)
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>{editingUser ? 'New Password (leave blank to keep current)' : 'Password'}</Label>
              <Input
                type="password"
                placeholder={editingUser ? 'Leave blank to keep current' : 'Password'}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                  <SelectItem value="HOTEL_STAFF">Hotel Manager</SelectItem>
                  <SelectItem value="HOTEL_FD">Hotel F.D.</SelectItem>
                  <SelectItem value="HOUSEKEEPER">Housekeeper</SelectItem>
                  <SelectItem value="RESTAURANT_STAFF">Restaurant Staff</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Phone (optional)</Label>
              <Input
                placeholder="Phone number"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-3">
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={!form.name || !form.email || emailBlocking || (!editingUser && !form.password) || createMutation.isPending || updateMutation.isPending}
              onClick={handleSubmit}
            >
              {createMutation.isPending || updateMutation.isPending ? 'Saving...' : editingUser ? 'Update User' : 'Create User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
