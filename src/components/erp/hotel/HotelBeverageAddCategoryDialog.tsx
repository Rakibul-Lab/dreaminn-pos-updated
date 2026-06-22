'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type HotelBeverageAddCategoryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function HotelBeverageAddCategoryDialog({
  open,
  onOpenChange,
}: HotelBeverageAddCategoryDialogProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')

  useEffect(() => {
    if (!open) setName('')
  }, [open])

  const createMutation = useMutation({
    mutationFn: (body: { name: string }) =>
      api.post<{ success: boolean; data?: { id: string; name: string }; error?: string }>(
        '/hotel-beverage-sales/categories',
        body
      ),
    onSuccess: (res) => {
      if (!res?.success) {
        toast.error(res?.error || 'Failed to add category')
        return
      }
      queryClient.invalidateQueries({ queryKey: ['hotel-beverage-menu'] })
      queryClient.invalidateQueries({ queryKey: ['hotel-beverage-categories'] })
      toast.success('Beverage category added')
      onOpenChange(false)
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to add category'),
  })

  const handleSubmit = () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error('Category name is required')
      return
    }
    createMutation.mutate({ name: trimmedName })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add beverage category</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1">
          Categories created here are for hotel beverage sales only and do not appear on the
          CloudView restaurant menu.
        </p>
        <div className="space-y-2 py-1">
          <Label>Name *</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Soft Drinks"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-emerald-600 hover:bg-emerald-700"
            disabled={createMutation.isPending}
            onClick={handleSubmit}
          >
            {createMutation.isPending ? 'Saving…' : 'Add category'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
