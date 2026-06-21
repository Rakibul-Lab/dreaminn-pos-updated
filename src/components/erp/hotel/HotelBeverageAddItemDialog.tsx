'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type BeverageCategory = {
  id: string
  name: string
}

type HotelBeverageAddItemDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: BeverageCategory[]
}

export function HotelBeverageAddItemDialog({
  open,
  onOpenChange,
  categories,
}: HotelBeverageAddItemDialogProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [price, setPrice] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (!open) return
    setName('')
    setPrice('')
    setDescription('')
    setCategoryId(categories[0]?.id ?? '')
  }, [open, categories])

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ success: boolean; data?: { id: string }; error?: string; message?: string }>(
        '/hotel-beverage-sales/menu-items',
        body
      ),
    onSuccess: (res) => {
      if (!res?.success) {
        toast.error(res?.error || res?.message || 'Failed to add beverage')
        return
      }
      queryClient.invalidateQueries({ queryKey: ['hotel-beverage-menu'] })
      toast.success('Beverage added')
      onOpenChange(false)
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to add beverage'),
  })

  const handleSubmit = () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error('Beverage name is required')
      return
    }
    if (!categoryId) {
      toast.error('Select a beverage category')
      return
    }
    const parsedPrice = parseFloat(price)
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      toast.error('Enter a valid price')
      return
    }
    createMutation.mutate({
      categoryId,
      name: trimmedName,
      description: description.trim() || undefined,
      price: parsedPrice,
      available: true,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add beverage</DialogTitle>
        </DialogHeader>
        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No beverage categories found. Add a menu category whose name includes
            &quot;Beverage&quot; in Menu Management first.
          </p>
        ) : (
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Coca-Cola"
              />
            </div>
            <div className="space-y-2">
              <Label>Category *</Label>
              <Select value={categoryId || undefined} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Price (BDT) *</Label>
              <Input
                type="number"
                min={0}
                step="1"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Optional"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-emerald-600 hover:bg-emerald-700"
            disabled={createMutation.isPending || categories.length === 0}
            onClick={handleSubmit}
          >
            {createMutation.isPending ? 'Saving…' : 'Add beverage'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
