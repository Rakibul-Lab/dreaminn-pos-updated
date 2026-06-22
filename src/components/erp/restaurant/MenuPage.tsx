'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/lib/auth-store'
import { toast } from 'sonner'
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  ChefHat,
  Leaf,
  Clock,
  ToggleLeft,
  ToggleRight,
  Package,
  X,
  ImageIcon,
  Sparkles,
  FileDown,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import {
  buildMenuItemsExportQuery,
  downloadMenuExcel,
  downloadMenuPdf,
  type MenuItemExportRecord,
} from '@/lib/menu-export'

function buildFoodPlaceholderSrc(itemId: string, itemName: string, width: number, height: number) {
  const params = new URLSearchParams({
    seed: itemId,
    name: itemName,
    w: String(width),
    h: String(height),
  })
  return `/api/placeholder/food?${params.toString()}`
}

function normalizeMenuImageSrc(image: string | null | undefined) {
  const raw = image?.trim()
  if (!raw) return null
  if (
    raw.startsWith('data:image/') ||
    raw.startsWith('http://') ||
    raw.startsWith('https://') ||
    raw.startsWith('/')
  ) {
    return raw
  }
  // Support values like "uploads/item.jpg" or "./uploads/item.jpg".
  return `/${raw.replace(/^\.?\//, '')}`
}

function MenuItemImage({
  item,
  width,
  height,
  className,
}: {
  item: Pick<MenuItem, 'id' | 'name' | 'image'>
  width: number
  height: number
  className: string
}) {
  const fallbackSrc = buildFoodPlaceholderSrc(item.id, item.name, width, height)
  const preferredSrc = normalizeMenuImageSrc(item.image) || fallbackSrc
  const [src, setSrc] = useState(preferredSrc)

  useEffect(() => {
    setSrc(preferredSrc)
  }, [preferredSrc])

  return (
    <Image
      src={src}
      alt={item.name}
      width={width}
      height={height}
      className={className}
      unoptimized
      onError={() => {
        if (src !== fallbackSrc) setSrc(fallbackSrc)
      }}
    />
  )
}

// Types
interface MenuCategory {
  id: string
  name: string
  description: string | null
  active: boolean
  sortOrder: number
  itemCount: number
}

interface MenuItem {
  id: string
  categoryId: string
  name: string
  description: string | null
  price: number
  image: string | null
  available: boolean
  isVeg: boolean
  preparationTime: number | null
  category: { id: string; name: string }
}

interface CategoryFormData {
  name: string
  description: string
  active: boolean
  sortOrder: number
}

interface ItemFormData {
  categoryId: string
  name: string
  description: string
  price: number
  image: string | null
  isVeg: boolean
  available: boolean
  preparationTime: number | null
}

const defaultItemForm: ItemFormData = {
  categoryId: '',
  name: '',
  description: '',
  price: 0,
  image: null,
  isVeg: true,
  available: true,
  preparationTime: null,
}

const defaultCategoryForm: CategoryFormData = {
  name: '',
  description: '',
  active: true,
  sortOrder: 0,
}

export default function MenuPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'ADMIN'
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [sortBy, setSortBy] = useState<string>('name')
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)

  const handleChooseImage = async (file: File | null) => {
    if (!file) return

    const maxBytes = 2 * 1024 * 1024
    if (file.size > maxBytes) {
      toast.error('Image too large', { description: 'Please choose an image under 2MB.' })
      return
    }

    if (!file.type.startsWith('image/')) {
      toast.error('Invalid file', { description: 'Please choose an image file.' })
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      setItemForm((s) => ({ ...s, image: result || null }))
    }
    reader.onerror = () => toast.error('Failed to read image file')
    reader.readAsDataURL(file)
  }

  // Category dialog state
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<MenuCategory | null>(null)
  const [categoryForm, setCategoryForm] = useState<CategoryFormData>(defaultCategoryForm)
  const [deleteCategoryDialog, setDeleteCategoryDialog] = useState<MenuCategory | null>(null)

  // Item dialog state
  const [itemDialogOpen, setItemDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
  const [itemForm, setItemForm] = useState<ItemFormData>(defaultItemForm)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const [imageInputKey, setImageInputKey] = useState(0)

  // Fetch categories
  const { data: categoriesData, isLoading: categoriesLoading } = useQuery({
    queryKey: ['menu-categories'],
    queryFn: () => api.get<{ success: boolean; data: MenuCategory[] }>('/menu-categories?excludeHotelBeverage=true'),
  })
  const categories = categoriesData?.data || []

  // Fetch menu items
  const { data: menuItemsData, isLoading: itemsLoading } = useQuery({
    queryKey: ['menu-items-admin', filterCategory],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '200' })
      if (filterCategory !== 'all') params.set('categoryId', filterCategory)
      return api.get<{ success: boolean; data: MenuItem[] }>(
        `/menu-items?${params.toString()}`
      )
    },
  })
  const menuItems = menuItemsData?.data || []

  // Filter and sort
  const filteredItems = menuItems
    .filter((item) => {
      if (!searchQuery) return true
      const q = searchQuery.toLowerCase()
      return (
        item.name.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'price') return a.price - b.price
      return 0
    })

  const categoryLabel =
    filterCategory === 'all'
      ? 'All categories'
      : categories.find((c) => c.id === filterCategory)?.name ?? filterCategory

  const buildExportMeta = () => ({
    exportedAt: new Date(),
    generatedBy: user ? { name: user.name, email: user.email, role: user.role } : undefined,
    category: filterCategory,
    categoryLabel,
    search: searchQuery.trim() || undefined,
    sort: sortBy,
  })

  const fetchExportRows = async (): Promise<MenuItemExportRecord[]> => {
    const path = buildMenuItemsExportQuery({
      categoryId: filterCategory,
      search: searchQuery.trim() || undefined,
    })
    const res = await api.get<{ success: boolean; data: MenuItemExportRecord[] }>(path)
    const rows = res.data ?? []
    if (!searchQuery.trim()) return rows
    const q = searchQuery.toLowerCase()
    return rows.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q)
    )
  }

  const handleExportExcel = async () => {
    setExporting('excel')
    const toastId = toast.loading('Preparing Excel export…')
    try {
      const rows = await fetchExportRows()
      if (!rows.length) {
        toast.error('No menu items to export', { id: toastId, description: 'Adjust filters or search to include items.' })
        return
      }
      await downloadMenuExcel(rows, buildExportMeta())
      toast.success(`Exported ${rows.length} item(s) to Excel`, { id: toastId })
    } catch (err) {
      toast.error('Export failed', {
        id: toastId,
        description: err instanceof Error ? err.message : 'Could not export menu',
      })
    } finally {
      setExporting(null)
    }
  }

  const handleExportPdf = async () => {
    setExporting('pdf')
    const toastId = toast.loading('Preparing PDF export…')
    try {
      const rows = await fetchExportRows()
      if (!rows.length) {
        toast.error('No menu items to export', { id: toastId, description: 'Adjust filters or search to include items.' })
        return
      }
      await downloadMenuPdf(rows, buildExportMeta())
      toast.success(`Exported ${rows.length} item(s) to PDF`, { id: toastId })
    } catch (err) {
      toast.error('Export failed', {
        id: toastId,
        description: err instanceof Error ? err.message : 'Could not export menu',
      })
    } finally {
      setExporting(null)
    }
  }

  // Category mutations
  const createCategoryMutation = useMutation({
    mutationFn: (data: CategoryFormData) => api.post('/menu-categories', data),
    onSuccess: (res: any) => {
      toast.success('Category created')
      queryClient.invalidateQueries({ queryKey: ['menu-categories'] })
      setCategoryDialogOpen(false)
      setCategoryForm(defaultCategoryForm)
      const createdId = res?.data?.id as string | undefined
      if (createdId && itemDialogOpen) {
        setItemForm((s) => ({ ...s, categoryId: createdId }))
      }
    },
    onError: (error: Error) => toast.error('Failed to create category', { description: error.message }),
  })

  const updateCategoryMutation = useMutation({
    mutationFn: (data: CategoryFormData & { id: string }) => api.put('/menu-categories', data),
    onSuccess: () => {
      toast.success('Category updated')
      queryClient.invalidateQueries({ queryKey: ['menu-categories'] })
      setCategoryDialogOpen(false)
      setEditingCategory(null)
      setCategoryForm(defaultCategoryForm)
    },
    onError: (error: Error) => toast.error('Failed to update category', { description: error.message }),
  })

  // Item mutations
  const createItemMutation = useMutation({
    mutationFn: (data: ItemFormData) =>
      api.post('/menu-items', {
        ...data,
        image: data.image && data.image.trim() ? data.image : null,
      }),
    onSuccess: () => {
      toast.success('Menu item created')
      queryClient.invalidateQueries({ queryKey: ['menu-items-admin'] })
      setItemDialogOpen(false)
      setItemForm(defaultItemForm)
    },
    onError: (error: Error) => toast.error('Failed to create item', { description: error.message }),
  })

  const updateItemMutation = useMutation({
    mutationFn: (data: ItemFormData & { id: string }) =>
      api.put(`/menu-items/${data.id}`, {
        ...data,
        image: data.image && data.image.trim() ? data.image : null,
      }),
    onSuccess: () => {
      toast.success('Menu item updated')
      queryClient.invalidateQueries({ queryKey: ['menu-items-admin'] })
      setItemDialogOpen(false)
      setEditingItem(null)
      setItemForm(defaultItemForm)
    },
    onError: (error: Error) => toast.error('Failed to update item', { description: error.message }),
  })

  const toggleAvailabilityMutation = useMutation({
    mutationFn: ({ id, available }: { id: string; available: boolean }) =>
      api.put(`/menu-items/${id}`, { available }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-items-admin'] })
    },
    onError: (error: Error) => toast.error('Failed to toggle availability', { description: error.message }),
  })

  const deleteItemMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/menu-items/${id}`),
    onSuccess: (_, id) => {
      toast.success('Menu item deleted')
      queryClient.invalidateQueries({ queryKey: ['menu-items-admin'] })
    },
    onError: (error: Error) => toast.error('Failed to delete item', { description: error.message }),
  })

  // Handlers
  const handleEditCategory = (cat: MenuCategory) => {
    if (!isAdmin) {
      toast.error('Only superadmin can edit categories')
      return
    }
    setEditingCategory(cat)
    setCategoryForm({
      name: cat.name,
      description: cat.description || '',
      active: cat.active,
      sortOrder: cat.sortOrder,
    })
    setCategoryDialogOpen(true)
  }

  const handleSaveCategory = () => {
    if (!isAdmin) {
      toast.error('Only superadmin can manage categories')
      return
    }
    if (!categoryForm.name.trim()) {
      toast.error('Category name is required')
      return
    }
    if (editingCategory) {
      updateCategoryMutation.mutate({ ...categoryForm, id: editingCategory.id })
    } else {
      createCategoryMutation.mutate(categoryForm)
    }
  }

  const handleEditItem = (item: MenuItem) => {
    if (!isAdmin) {
      toast.error('Only superadmin can edit menu items')
      return
    }
    setEditingItem(item)
    setItemForm({
      categoryId: item.categoryId,
      name: item.name,
      description: item.description || '',
      price: item.price,
      image: item.image || null,
      isVeg: item.isVeg,
      available: item.available,
      preparationTime: item.preparationTime,
    })
    setImageInputKey((k) => k + 1)
    setItemDialogOpen(true)
  }

  const handleSaveItem = () => {
    if (!isAdmin) {
      toast.error('Only superadmin can add new items')
      return
    }
    if (!itemForm.name.trim()) {
      toast.error('Item name is required')
      return
    }
    if (!itemForm.categoryId) {
      toast.error('Please select a category')
      return
    }
    if (itemForm.price <= 0) {
      toast.error('Price must be greater than 0')
      return
    }
    if (editingItem) {
      updateItemMutation.mutate({ ...itemForm, id: editingItem.id })
    } else {
      createItemMutation.mutate(itemForm)
    }
  }

  return (
    <div className="h-full flex flex-col bg-muted">
      {/* Header */}
      <div className="bg-slate-900 text-white px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500 flex items-center justify-center">
              <ChefHat className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Menu Management</h1>
              <p className="text-xs text-slate-300">CloudView Restaurant</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border border-slate-500 bg-slate-800/80 text-white hover:bg-slate-700 hover:text-white hover:border-slate-400"
              onClick={() => void handleExportExcel()}
              disabled={!!exporting || itemsLoading}
            >
              {exporting === 'excel' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileDown className="w-4 h-4" />
              )}
              Export Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border border-slate-500 bg-slate-800/80 text-white hover:bg-slate-700 hover:text-white hover:border-slate-400"
              onClick={() => void handleExportPdf()}
              disabled={!!exporting || itemsLoading}
            >
              {exporting === 'pdf' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileDown className="w-4 h-4" />
              )}
              Export PDF
            </Button>
            {isAdmin ? (
              <>
                <Button
                  onClick={() => {
                    setEditingCategory(null)
                    setCategoryForm(defaultCategoryForm)
                    setCategoryDialogOpen(true)
                  }}
                  variant="outline"
                  className="border-slate-600 bg-card text-foreground hover:bg-muted"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Category
                </Button>
                <Button
                  onClick={() => {
                    setEditingItem(null)
                    setItemForm(defaultItemForm)
                    setImageInputKey((k) => k + 1)
                    setItemDialogOpen(true)
                  }}
                  className="bg-amber-600 hover:bg-amber-700"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Menu Item
                </Button>
              </>
            ) : (
              <Badge variant="outline" className="border-slate-600 text-slate-300">
                Read-only (Superadmin only)
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Categories Section */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Package className="w-4 h-4 text-amber-600" />
                  Categories ({categories.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {categoriesLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : categories.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No categories yet
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {categories.map((cat) => (
                      <div
                        key={cat.id}
                        className={`flex items-center justify-between p-2 rounded-lg text-sm cursor-pointer transition-colors ${
                          filterCategory === cat.id
                            ? 'bg-amber-100 text-amber-800'
                            : 'hover:bg-muted'
                        }`}
                        onClick={() =>
                          setFilterCategory(filterCategory === cat.id ? 'all' : cat.id)
                        }
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-2 h-2 rounded-full ${cat.active ? 'bg-green-500' : 'bg-slate-300'}`} />
                          <span className="truncate">{cat.name}</span>
                          <Badge variant="secondary" className="text-[10px] h-4 shrink-0">
                            {cat.itemCount}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            className={`p-1 ${isAdmin ? 'text-muted-foreground hover:text-amber-600' : 'text-slate-200/40 cursor-not-allowed'}`}
                            onClick={() => isAdmin && handleEditCategory(cat)}
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Items Section */}
          <div className="lg:col-span-3">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-bold">
                    Menu Items ({filteredItems.length})
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search items..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 h-8 w-48 text-xs"
                      />
                    </div>
                    <Select value={sortBy} onValueChange={setSortBy}>
                      <SelectTrigger className="h-8 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="name">Sort: Name</SelectItem>
                        <SelectItem value="price">Sort: Price</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {itemsLoading ? (
                  <div className="p-4 space-y-2">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[64px]">Image</TableHead>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Prep Time</TableHead>
                        <TableHead>Available</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredItems.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                            No menu items found
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredItems.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell>
                              <div className="h-10 w-14 overflow-hidden rounded-md border bg-muted">
                                <MenuItemImage
                                  item={item}
                                  width={220}
                                  height={140}
                                  className="h-10 w-14 object-cover"
                                />
                              </div>
                            </TableCell>
                            <TableCell>
                              <span
                                className={`w-3 h-3 rounded-full block ${
                                  item.isVeg ? 'bg-green-500' : 'bg-red-500'
                                }`}
                                title={item.isVeg ? 'Vegetarian' : 'Non-Vegetarian'}
                              />
                            </TableCell>
                            <TableCell>
                              <div>
                                <span className="font-medium text-sm">{item.name}</span>
                                {item.description && (
                                  <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                                    {item.description}
                                  </p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {item.category.name}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-semibold text-amber-700">
                              ৳{item.price.toFixed(0)}
                            </TableCell>
                            <TableCell>
                              {item.preparationTime ? (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {item.preparationTime}m
                                </span>
                              ) : (
                                <span className="text-xs text-slate-300">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={item.available}
                                disabled={!isAdmin}
                                onCheckedChange={(checked) => {
                                  if (!isAdmin) return
                                  toggleAvailabilityMutation.mutate({
                                    id: item.id,
                                    available: checked,
                                  })
                                }}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  disabled={!isAdmin}
                                  onClick={() => isAdmin && handleEditItem(item)}
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-red-400 hover:text-red-600"
                                  disabled={!isAdmin}
                                  onClick={() => isAdmin && deleteItemMutation.mutate(item.id)}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Category Dialog */}
      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="max-w-[calc(100%-1rem)] sm:max-w-xl p-0 max-h-[92vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-4 py-4 text-white sm:px-6 sm:py-5">
              <DialogTitle className="flex items-center gap-2 text-xl">
                <Sparkles className="h-5 w-5 text-amber-400" />
                {editingCategory ? 'Edit Category' : 'Add Category'}
              </DialogTitle>
              <p className="mt-1 text-sm text-slate-200">
                Organize items with clean names, descriptions and ordering.
              </p>
              <DialogDescription className="sr-only">
                {editingCategory
                  ? 'Edit an existing category details including name, description, status, and sort order.'
                  : 'Create a new category with name, description, status, and sort order.'}
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="space-y-5 px-4 pb-4 sm:px-6 sm:pb-6 overflow-y-auto">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label className="text-xs">Name *</Label>
                <Input
                  value={categoryForm.name}
                  onChange={(e) =>
                    setCategoryForm({ ...categoryForm, name: e.target.value })
                  }
                  placeholder="Category name"
                  className="mt-1 h-10"
                />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Description</Label>
                <Textarea
                  value={categoryForm.description}
                  onChange={(e) =>
                    setCategoryForm({ ...categoryForm, description: e.target.value })
                  }
                  placeholder="Optional description"
                  className="mt-1 h-24 resize-none"
                />
              </div>
              <div className="rounded-lg border p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">Status</div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={categoryForm.active}
                    onCheckedChange={(checked) =>
                      setCategoryForm({ ...categoryForm, active: checked })
                    }
                  />
                  <Label className="text-xs">{categoryForm.active ? 'Active' : 'Inactive'}</Label>
                </div>
              </div>
              <div>
                <Label className="text-xs">Sort Order</Label>
                <Input
                  type="number"
                  value={categoryForm.sortOrder}
                  onChange={(e) =>
                    setCategoryForm({
                      ...categoryForm,
                      sortOrder: Number(e.target.value),
                    })
                  }
                  className="mt-1 h-10"
                />
              </div>
            </div>
            {!categoryForm.name.trim() ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Category name is required.
              </div>
            ) : null}
          </div>
          <DialogFooter className="border-t bg-card px-4 py-3 sm:px-6">
            <Button
              variant="outline"
              onClick={() => setCategoryDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveCategory}
              disabled={createCategoryMutation.isPending || updateCategoryMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {editingCategory ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Menu Item Dialog */}
      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent className="max-w-[calc(100%-1rem)] sm:max-w-2xl p-0 max-h-[92vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-4 py-4 text-white sm:px-6 sm:py-5">
              <DialogTitle className="flex items-center gap-2 text-xl">
                <Sparkles className="h-5 w-5 text-amber-400" />
                {editingItem ? 'Edit Menu Item' : 'Add Menu Item'}
              </DialogTitle>
              <p className="mt-1 text-sm text-slate-200">
                Use a clean image, category and pricing to keep your menu professional.
              </p>
              <DialogDescription className="sr-only">
                {editingItem
                  ? 'Edit a menu item including image, category, pricing, description, and availability settings.'
                  : 'Create a menu item with image, category, pricing, description, and availability settings.'}
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="space-y-5 px-4 pb-4 sm:space-y-6 sm:px-6 sm:pb-6 overflow-y-auto">
            <div className="rounded-xl border bg-muted p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <ImageIcon className="h-4 w-4 text-amber-600" />
                Item Image
              </div>
              <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <div className="h-20 w-28 overflow-hidden rounded-lg border bg-card shadow-sm">
                  {itemForm.image?.trim() ? (
                    <Image
                      src={itemForm.image}
                      alt="Preview"
                      width={220}
                      height={140}
                      className="h-20 w-28 object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-20 w-28 items-center justify-center bg-muted text-muted-foreground">
                      <div className="text-center">
                        <ImageIcon className="mx-auto h-5 w-5" />
                        <p className="mt-1 text-[10px]">No image</p>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <Label className="text-xs">Choose Image (max 2MB)</Label>
                  <Input
                    key={imageInputKey}
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="mt-1 h-10"
                    onChange={(e) => handleChooseImage(e.target.files?.[0] || null)}
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setItemForm((s) => ({ ...s, image: null }))
                        if (imageInputRef.current) imageInputRef.current.value = ''
                        setImageInputKey((k) => k + 1)
                      }}
                    >
                      Remove Image
                    </Button>
                    <p className="text-[11px] text-muted-foreground">
                      If removed, dummy image will be used in POS.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label className="text-xs">Name *</Label>
                <Input
                  value={itemForm.name}
                  onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                  placeholder="Item name"
                  className="mt-1 h-10"
                />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Category *</Label>
                  {isAdmin && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs text-foreground"
                      onClick={() => {
                        setEditingCategory(null)
                        setCategoryForm(defaultCategoryForm)
                        setCategoryDialogOpen(true)
                      }}
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Add Category
                    </Button>
                  )}
                </div>
                <Select
                  value={itemForm.categoryId}
                  onValueChange={(val) => setItemForm({ ...itemForm, categoryId: val })}
                >
                  <SelectTrigger className="mt-1 h-10">
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
              <div>
                <Label className="text-xs">Price *</Label>
                <Input
                  type="number"
                  min={0}
                  value={itemForm.price || ''}
                  onChange={(e) =>
                    setItemForm({ ...itemForm, price: Number(e.target.value) || 0 })
                  }
                  placeholder="0"
                  className="mt-1 h-10"
                />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Description</Label>
                <Textarea
                  value={itemForm.description}
                  onChange={(e) =>
                    setItemForm({ ...itemForm, description: e.target.value })
                  }
                  placeholder="Optional description"
                  className="mt-1 h-20 resize-none"
                />
              </div>
              <div>
                <Label className="text-xs">Preparation Time (minutes)</Label>
                <Input
                  type="number"
                  min={0}
                  value={itemForm.preparationTime ?? ''}
                  onChange={(e) =>
                    setItemForm({
                      ...itemForm,
                      preparationTime: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  placeholder="Optional"
                  className="mt-1 h-10"
                />
              </div>
              <div className="flex items-end gap-4 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={itemForm.isVeg}
                    onCheckedChange={(checked) =>
                      setItemForm({ ...itemForm, isVeg: checked })
                    }
                  />
                  <Label className="text-xs flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${itemForm.isVeg ? 'bg-green-500' : 'bg-red-500'}`} />
                    {itemForm.isVeg ? 'Veg' : 'Non-Veg'}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={itemForm.available}
                    onCheckedChange={(checked) =>
                      setItemForm({ ...itemForm, available: checked })
                    }
                  />
                  <Label className="text-xs">Available</Label>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="border-t bg-card px-4 py-3 sm:px-6">
            <Button variant="outline" onClick={() => setItemDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveItem}
              disabled={createItemMutation.isPending || updateItemMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {editingItem ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
