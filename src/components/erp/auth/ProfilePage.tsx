'use client'

import { useRef, useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  User,
  Mail,
  Phone,
  Shield,
  Calendar,
  Camera,
  Loader2,
  Hotel,
  UtensilsCrossed,
  LayoutDashboard,
} from 'lucide-react'
import { api } from '@/lib/api-client'
import { useAuthStore, formatRoleLabel } from '@/lib/auth-store'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

interface ProfileData {
  id: string
  email: string
  name: string
  role: string
  phone: string | null
  avatar: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

const roleBadgeColors: Record<string, string> = {
  ADMIN: 'bg-red-50 text-red-700 border-red-200',
  HOTEL_STAFF: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  HOTEL_FD: 'bg-teal-50 text-teal-700 border-teal-200',
  RESTAURANT_STAFF: 'bg-amber-50 text-amber-700 border-amber-200',
}

function RoleIcon({ role }: { role: string }) {
  if (role === 'ADMIN') return <LayoutDashboard className="h-3.5 w-3.5" />
  if (role === 'HOTEL_STAFF' || role === 'HOTEL_FD') return <Hotel className="h-3.5 w-3.5" />
  if (role === 'RESTAURANT_STAFF') return <UtensilsCrossed className="h-3.5 w-3.5" />
  return <Shield className="h-3.5 w-3.5" />
}

export function ProfilePage() {
  const { user, updateUser } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const [avatarInputKey, setAvatarInputKey] = useState(0)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [avatar, setAvatar] = useState<string | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['my-profile'],
    queryFn: () => api.get<{ success: boolean; data: ProfileData }>('/auth/me'),
    enabled: !!user,
  })

  const profile = data?.data
  const isAdmin = user?.role === 'ADMIN' || profile?.role === 'ADMIN'

  useEffect(() => {
    if (!profile) return
    setName(profile.name)
    setPhone(profile.phone || '')
    setAvatar(profile.avatar)
  }, [profile])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (newPassword && newPassword !== confirmPassword) {
        throw new Error('New passwords do not match')
      }
      const body: Record<string, unknown> = {
        name: name.trim(),
        phone: phone.trim() || null,
        avatar,
      }
      if (isAdmin && newPassword.trim()) {
        body.currentPassword = currentPassword
        body.newPassword = newPassword
      }
      const res = await api.patch<{ success: boolean; data: ProfileData; message?: string; error?: string }>(
        '/auth/me',
        body
      )
      if (!res.success) {
        throw new Error(res.error || 'Failed to update profile')
      }
      return res
    },
    onSuccess: (res) => {
      const updated = res.data
      updateUser({
        name: updated.name,
        avatar: updated.avatar,
        phone: updated.phone,
      })
      queryClient.invalidateQueries({ queryKey: ['my-profile'] })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast({
        title: 'Profile saved',
        description: res.message || 'Your profile has been updated.',
      })
    },
    onError: (err: Error) => {
      toast({
        title: 'Could not save profile',
        description: err.message || 'Please try again.',
        variant: 'destructive',
      })
    },
  })

  const handleChooseAvatar = (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file', description: 'Please select an image file', variant: 'destructive' })
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: 'Image too large', description: 'Please choose an image under 2MB', variant: 'destructive' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => setAvatar(String(reader.result || '') || null)
    reader.onerror = () =>
      toast({ title: 'Error', description: 'Failed to read image', variant: 'destructive' })
    reader.readAsDataURL(file)
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }

  if (!profile) {
    return (
      <Card className="mx-auto max-w-md border-destructive/30">
        <CardContent className="p-6 text-center text-muted-foreground">
          Could not load your profile. Please refresh the page.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <User className="h-6 w-6 text-amber-600" />
          My Profile
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {isAdmin
            ? 'View and update your account details and password'
            : 'View and update your account details'}
        </p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Account overview</CardTitle>
          <CardDescription>Your role and sign-in email are managed by an administrator.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
            <div className="relative shrink-0">
              <div className="h-24 w-24 rounded-full border-2 border-border bg-muted overflow-hidden flex items-center justify-center text-2xl font-bold text-muted-foreground">
                {avatar ? (
                  <img src={avatar} alt={name} className="h-full w-full object-cover" />
                ) : (
                  <span>{name.charAt(0).toUpperCase()}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                className="absolute bottom-0 right-0 rounded-full bg-amber-600 p-2 text-white shadow-md hover:bg-amber-700"
                title="Change photo"
              >
                <Camera className="h-4 w-4" />
              </button>
              <input
                key={avatarInputKey}
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  handleChooseAvatar(e.target.files?.[0] ?? null)
                  setAvatarInputKey((k) => k + 1)
                }}
              />
            </div>
            <div className="flex-1 text-center sm:text-left space-y-2 min-w-0">
              <p className="text-xl font-semibold text-foreground truncate">{profile.name}</p>
              <Badge
                variant="outline"
                className={`inline-flex items-center gap-1 ${roleBadgeColors[profile.role] || ''}`}
              >
                <RoleIcon role={profile.role} />
                {formatRoleLabel(profile.role)}
              </Badge>
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  {profile.email}
                </span>
                {profile.phone && (
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    {profile.phone}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground flex items-center justify-center sm:justify-start gap-1">
                <Calendar className="h-3 w-3" />
                Member since {format(new Date(profile.createdAt), 'MMM d, yyyy')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Edit profile</CardTitle>
          <CardDescription>Update your display name, phone, and profile photo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-name">Full name</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" value={profile.email} disabled className="bg-muted" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-phone">Phone</Label>
            <Input
              id="profile-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Optional"
            />
          </div>
          {avatar && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAvatar(null)}
            >
              Remove photo
            </Button>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Change password</CardTitle>
            <CardDescription>Leave blank to keep your current password.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />

      <div className="flex justify-end gap-2 pb-4">
        <Button
          className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700 text-white min-w-[120px]"
          disabled={saveMutation.isPending || !name.trim()}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving…
            </>
          ) : (
            'Save changes'
          )}
        </Button>
      </div>
    </div>
  )
}
