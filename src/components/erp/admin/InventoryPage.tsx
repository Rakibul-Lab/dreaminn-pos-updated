'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useAuthStore, canAccessInventory } from '@/lib/auth-store'
import { useToast } from '@/hooks/use-toast'
import {
  Package,
  Plus,
  Edit2,
  ArrowUpCircle,
  ArrowDownCircle,
  AlertTriangle,
  RefreshCw,
  Filter,
  FileDown,
  Loader2,
  FolderPlus,
  Tags,
  Boxes,
  Truck,
  History,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  buildInventoryExportQuery,
  downloadInventoryExcel,
  downloadInventoryPdf,
  type InventoryExportRecord,
} from '@/lib/inventory-export'
import { InventoryItemHistoryDialog } from '@/components/erp/admin/InventoryItemHistoryDialog'

interface InventoryItem {
  id: string
  name: string
  category: string | null
  categoryId?: string | null
  unit: string
  quantity: number
  minQuantity: number
  costPerUnit: number | null
  supplier: string | null
  createdAt: string
  updatedAt: string
}

type InventoryCategory = {
  id: string
  name: string
  description?: string | null
  active: boolean
  sortOrder: number
  _count?: { items: number }
}

const UNIT_OPTIONS = [
  { value: 'piece', label: 'Piece' },
  { value: 'kg', label: 'Kilogram (kg)' },
  { value: 'liter', label: 'Liter' },
  { value: 'pack', label: 'Pack' },
  { value: 'box', label: 'Box' },
] as const

const EMPTY_ITEM_FORM = {
  name: '',
  categoryId: '',
  unit: 'piece',
  quantity: '0',
  minQuantity: '0',
  costPerUnit: '',
  supplier: '',
}

export default function InventoryPage() {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [showLowStock, setShowLowStock] = useState(false)
  const [page, setPage] = useState(1)
  const [showItemDialog, setShowItemDialog] = useState(false)
  const [showCategoryDialog, setShowCategoryDialog] = useState(false)
  const [showTransactionDialog, setShowTransactionDialog] = useState(false)
  const [historyItemId, setHistoryItemId] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string>('')
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)

  const [itemForm, setItemForm] = useState(EMPTY_ITEM_FORM)
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' })
  const [transactionForm, setTransactionForm] = useState({
    type: 'in',
    quantity: '',
    notes: '',
  })

  const { data: inventoryData, isLoading } = useQuery({
    queryKey: ['inventory', categoryFilter, showLowStock, page],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', '20')
      if (categoryFilter !== 'all') params.set('category', categoryFilter)
      if (showLowStock) params.set('lowStock', 'true')
      return api.get<{
        success: boolean
        data: InventoryItem[]
        meta?: { total: number; totalPages: number }
      }>(`/inventory?${params.toString()}`)
    },
    enabled: !!user && canAccessInventory(user?.role),
  })

  const { data: categoriesRes, isLoading: categoriesLoading } = useQuery({
    queryKey: ['inventory-categories'],
    queryFn: () =>
      api.get<{ success: boolean; data: InventoryCategory[] }>('/inventory/categories'),
    enabled: !!user && canAccessInventory(user?.role),
  })

  const categories = categoriesRes?.data ?? []

  const itemMutation = useMutation({
    mutationFn: async () => {
      const selectedCategory = categories.find((category) => category.id === itemForm.categoryId)
      const payload = {
        name: itemForm.name.trim(),
        categoryId: itemForm.categoryId || null,
        category: selectedCategory?.name ?? null,
        unit: itemForm.unit,
        quantity: parseFloat(itemForm.quantity) || 0,
        minQuantity: parseFloat(itemForm.minQuantity) || 0,
        costPerUnit: itemForm.costPerUnit ? parseFloat(itemForm.costPerUnit) : null,
        supplier: itemForm.supplier.trim() || null,
      }
      if (editingItem) {
        return api.put('/inventory', { id: editingItem.id, ...payload })
      }
      return api.post('/inventory', payload)
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-categories'] })
      toast({
        title: editingItem ? 'Item Updated' : 'Item Created',
        description: res.message || 'Success',
      })
      closeItemDialog()
    },
    onError: (err: Error) => {
      toast({
        title: 'Error',
        description: err.message || 'Failed to save item',
        variant: 'destructive',
      })
    },
  })

  const categoryMutation = useMutation({
    mutationFn: async () =>
      api.post<{ success: boolean; data: InventoryCategory; message?: string; error?: string }>(
        '/inventory/categories',
        {
          name: categoryForm.name.trim(),
          description: categoryForm.description.trim() || null,
        }
      ),
    onSuccess: (res) => {
      if (!res.success) {
        toast({
          title: 'Error',
          description: res.error || 'Failed to create category',
          variant: 'destructive',
        })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['inventory-categories'] })
      toast({ title: 'Category Created', description: res.message || 'Category added' })
      if (res.data?.id) {
        setItemForm((form) => ({ ...form, categoryId: res.data.id }))
      }
      setCategoryForm({ name: '', description: '' })
      setShowCategoryDialog(false)
    },
    onError: (err: Error) => {
      toast({
        title: 'Error',
        description: err.message || 'Failed to create category',
        variant: 'destructive',
      })
    },
  })

  const transactionMutation = useMutation({
    mutationFn: async () =>
      api.post('/inventory', {
        action: 'transaction',
        itemId: selectedItemId,
        type: transactionForm.type,
        quantity: parseFloat(transactionForm.quantity),
        notes: transactionForm.notes || null,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-history'] })
      toast({ title: 'Transaction Complete', description: res.message || 'Stock updated' })
      setShowTransactionDialog(false)
      setTransactionForm({ type: 'in', quantity: '', notes: '' })
      setSelectedItemId('')
    },
    onError: (err: Error) => {
      toast({
        title: 'Error',
        description: err.message || 'Failed to process transaction',
        variant: 'destructive',
      })
    },
  })

  const closeItemDialog = () => {
    setShowItemDialog(false)
    setEditingItem(null)
    setItemForm(EMPTY_ITEM_FORM)
  }

  const openAddItemDialog = () => {
    setEditingItem(null)
    setItemForm(EMPTY_ITEM_FORM)
    setShowItemDialog(true)
  }

  const openEditDialog = (item: InventoryItem) => {
    const matchedCategory =
      categories.find((category) => category.id === item.categoryId) ||
      categories.find((category) => category.name === item.category)

    setEditingItem(item)
    setItemForm({
      name: item.name,
      categoryId: matchedCategory?.id || '',
      unit: item.unit,
      quantity: String(item.quantity),
      minQuantity: String(item.minQuantity),
      costPerUnit: item.costPerUnit ? String(item.costPerUnit) : '',
      supplier: item.supplier || '',
    })
    setShowItemDialog(true)
  }

  const openTransactionDialog = (itemId: string, type: string) => {
    setSelectedItemId(itemId)
    setTransactionForm({ type, quantity: '', notes: '' })
    setShowTransactionDialog(true)
  }

  const selectedCategoryName = useMemo(
    () => categories.find((category) => category.id === itemForm.categoryId)?.name ?? null,
    [categories, itemForm.categoryId]
  )

  if (!user || !canAccessInventory(user.role)) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="p-6 text-center">
          <p className="font-medium text-amber-700">Access Denied</p>
          <p className="mt-1 text-sm text-amber-600">
            You do not have permission to manage inventory.
          </p>
        </CardContent>
      </Card>
    )
  }

  const items = inventoryData?.data || []
  const totalPages = inventoryData?.meta?.totalPages || 1
  const lowStockItems = items.filter((item) => item.quantity <= item.minQuantity)

  const buildExportMeta = () => ({
    exportedAt: new Date(),
    generatedBy: user ? { name: user.name, email: user.email, role: user.role } : undefined,
    category: categoryFilter,
    lowStockOnly: showLowStock,
  })

  const fetchExportRows = async (): Promise<InventoryExportRecord[]> => {
    const path = buildInventoryExportQuery({
      category: categoryFilter,
      lowStock: showLowStock,
    })
    const res = await api.get<{ success: boolean; data: InventoryExportRecord[] }>(path)
    return res.data ?? []
  }

  const handleExportExcel = async () => {
    setExporting('excel')
    try {
      const rows = await fetchExportRows()
      if (!rows.length) {
        toast({
          title: 'No items to export',
          description: 'Adjust filters to include inventory items.',
          variant: 'destructive',
        })
        return
      }
      await downloadInventoryExcel(rows, buildExportMeta())
      toast({ title: 'Export complete', description: `Exported ${rows.length} item(s) to Excel` })
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Could not export inventory',
        variant: 'destructive',
      })
    } finally {
      setExporting(null)
    }
  }

  const handleExportPdf = async () => {
    setExporting('pdf')
    try {
      const rows = await fetchExportRows()
      if (!rows.length) {
        toast({
          title: 'No items to export',
          description: 'Adjust filters to include inventory items.',
          variant: 'destructive',
        })
        return
      }
      await downloadInventoryPdf(rows, buildExportMeta())
      toast({ title: 'Export complete', description: `Exported ${rows.length} item(s) to PDF` })
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Could not export inventory',
        variant: 'destructive',
      })
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Package className="h-6 w-6 text-amber-600" />
            Inventory
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage stock items, categories, and supplies
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExportExcel()}
            disabled={!!exporting || isLoading}
          >
            {exporting === 'excel' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="mr-2 h-4 w-4" />
            )}
            Export Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExportPdf()}
            disabled={!!exporting || isLoading}
          >
            {exporting === 'pdf' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="mr-2 h-4 w-4" />
            )}
            Export PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ['inventory'] })
              queryClient.invalidateQueries({ queryKey: ['inventory-categories'] })
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCategoryForm({ name: '', description: '' })
              setShowCategoryDialog(true)
            }}
          >
            <FolderPlus className="mr-2 h-4 w-4" /> Add Category
          </Button>
          <Button
            onClick={openAddItemDialog}
            className="bg-amber-600 text-white hover:bg-amber-700"
          >
            <Plus className="mr-2 h-4 w-4" /> Add Item
          </Button>
        </div>
      </div>

      {lowStockItems.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-red-700">
              <AlertTriangle className="h-4 w-4" />
              Low Stock Alerts ({lowStockItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {lowStockItems.map((item) => (
                <Badge
                  key={item.id}
                  variant="outline"
                  className="border-red-300 bg-card text-red-700"
                >
                  {item.name}: {item.quantity} {item.unit} (min: {item.minQuantity})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Select
              value={categoryFilter}
              onValueChange={(value) => {
                setCategoryFilter(value)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full sm:w-56">
                <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.name}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={showLowStock ? 'default' : 'outline'}
              className={showLowStock ? 'bg-red-600 text-white hover:bg-red-700' : ''}
              onClick={() => {
                setShowLowStock(!showLowStock)
                setPage(1)
              }}
            >
              <AlertTriangle className="mr-2 h-4 w-4" />
              {showLowStock ? 'Showing Low Stock' : 'Low Stock Only'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Min Qty</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Cost/Unit</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      No items found
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => {
                    const isLow = item.quantity <= item.minQuantity
                    return (
                      <TableRow
                        key={item.id}
                        className={cn('hover:bg-muted', isLow && 'bg-red-50/50')}
                      >
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {item.category || 'Uncategorized'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{item.unit}</TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-semibold',
                            isLow ? 'text-red-600' : 'text-foreground'
                          )}
                        >
                          {item.quantity}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {item.minQuantity}
                        </TableCell>
                        <TableCell>
                          {isLow ? (
                            <Badge
                              variant="outline"
                              className="border-red-200 bg-red-50 text-red-700"
                            >
                              <AlertTriangle className="mr-1 h-3 w-3" /> Low Stock
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-emerald-200 bg-emerald-50 text-emerald-700"
                            >
                              In Stock
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {item.costPerUnit ? `৳${item.costPerUnit}` : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setHistoryItemId(item.id)}
                              title="Product history"
                            >
                              <History className="h-4 w-4 text-sky-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(item)}
                              title="Edit"
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openTransactionDialog(item.id, 'in')}
                              title="Stock In"
                            >
                              <ArrowUpCircle className="h-4 w-4 text-emerald-500" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openTransactionDialog(item.id, 'out')}
                              title="Stock Out"
                            >
                              <ArrowDownCircle className="h-4 w-4 text-amber-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Previous
          </Button>
          <span className="flex items-center px-3 text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            Next
          </Button>
        </div>
      )}

      {/* Premium Add / Edit Item Dialog */}
      <Dialog
        open={showItemDialog}
        onOpenChange={(open) => {
          if (!open) closeItemDialog()
        }}
      >
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
          <div className="relative overflow-hidden border-b bg-gradient-to-br from-amber-50 via-orange-50/80 to-stone-50 px-6 pb-5 pt-6">
            <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-amber-200/40 blur-2xl" />
            <div className="pointer-events-none absolute bottom-0 left-10 h-20 w-20 rounded-full bg-orange-200/30 blur-xl" />
            <DialogHeader className="relative space-y-2 text-left">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-200/80 bg-white/80 shadow-sm backdrop-blur">
                  <Boxes className="h-5 w-5 text-amber-700" />
                </div>
                <div>
                  <DialogTitle className="text-xl text-stone-900">
                    {editingItem ? 'Edit inventory item' : 'Add inventory item'}
                  </DialogTitle>
                  <DialogDescription className="text-stone-600">
                    {editingItem
                      ? 'Update product details, category, and stock thresholds.'
                      : 'Create a stock item with a managed category and pricing.'}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          <div className="space-y-5 px-6 py-5">
            <div className="space-y-2">
              <Label htmlFor="inventory-item-name" className="text-stone-700">
                Product name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="inventory-item-name"
                placeholder="e.g. Premium Bath Towel"
                value={itemForm.name}
                onChange={(e) => setItemForm((form) => ({ ...form, name: e.target.value }))}
                className="h-11 border-stone-200 bg-white shadow-sm focus-visible:ring-amber-500/30"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-stone-700">Category</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                  onClick={() => {
                    setCategoryForm({ name: '', description: '' })
                    setShowCategoryDialog(true)
                  }}
                >
                  <FolderPlus className="mr-1 h-3.5 w-3.5" />
                  New category
                </Button>
              </div>
              <Select
                value={itemForm.categoryId || undefined}
                onValueChange={(value) =>
                  setItemForm((form) => ({ ...form, categoryId: value === '__none' ? '' : value }))
                }
              >
                <SelectTrigger className="h-11 border-stone-200 bg-white shadow-sm">
                  <div className="flex items-center gap-2">
                    <Tags className="h-4 w-4 text-muted-foreground" />
                    <SelectValue
                      placeholder={
                        categoriesLoading ? 'Loading categories…' : 'Select a category'
                      }
                    />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Uncategorized</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCategoryName ? (
                <p className="text-xs text-muted-foreground">
                  Selected: <span className="font-medium text-foreground">{selectedCategoryName}</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Create categories first, then assign them to products.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-stone-700">Unit</Label>
                <Select
                  value={itemForm.unit}
                  onValueChange={(value) => setItemForm((form) => ({ ...form, unit: value }))}
                >
                  <SelectTrigger className="h-11 border-stone-200 bg-white shadow-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNIT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="inventory-cost" className="text-stone-700">
                  Cost per unit (৳)
                </Label>
                <Input
                  id="inventory-cost"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  value={itemForm.costPerUnit}
                  onChange={(e) =>
                    setItemForm((form) => ({ ...form, costPerUnit: e.target.value }))
                  }
                  className="h-11 border-stone-200 bg-white shadow-sm focus-visible:ring-amber-500/30"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 rounded-xl border border-stone-200 bg-stone-50/70 p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="inventory-qty" className="text-stone-700">
                  Opening quantity
                </Label>
                <Input
                  id="inventory-qty"
                  type="number"
                  min={0}
                  step="0.01"
                  value={itemForm.quantity}
                  onChange={(e) => setItemForm((form) => ({ ...form, quantity: e.target.value }))}
                  className="h-11 border-stone-200 bg-white shadow-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inventory-min-qty" className="text-stone-700">
                  Minimum quantity
                </Label>
                <Input
                  id="inventory-min-qty"
                  type="number"
                  min={0}
                  step="0.01"
                  value={itemForm.minQuantity}
                  onChange={(e) =>
                    setItemForm((form) => ({ ...form, minQuantity: e.target.value }))
                  }
                  className="h-11 border-stone-200 bg-white shadow-sm"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="inventory-supplier" className="text-stone-700">
                Supplier
              </Label>
              <div className="relative">
                <Truck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="inventory-supplier"
                  placeholder="Optional supplier name"
                  value={itemForm.supplier}
                  onChange={(e) => setItemForm((form) => ({ ...form, supplier: e.target.value }))}
                  className="h-11 border-stone-200 bg-white pl-9 shadow-sm focus-visible:ring-amber-500/30"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 border-t bg-stone-50/80 px-6 py-4 sm:gap-0">
            <Button type="button" variant="outline" onClick={closeItemDialog}>
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-amber-600 text-white hover:bg-amber-700"
              disabled={!itemForm.name.trim() || itemMutation.isPending}
              onClick={() => itemMutation.mutate()}
            >
              {itemMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : editingItem ? (
                'Update item'
              ) : (
                'Add item'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Category Dialog */}
      <Dialog open={showCategoryDialog} onOpenChange={setShowCategoryDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="h-5 w-5 text-amber-600" />
              Add inventory category
            </DialogTitle>
            <DialogDescription>
              Categories appear in the product form dropdown and inventory filters.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label htmlFor="inventory-category-name">
                Category name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="inventory-category-name"
                value={categoryForm.name}
                onChange={(e) =>
                  setCategoryForm((form) => ({ ...form, name: e.target.value }))
                }
                placeholder="e.g. Housekeeping, Dairy, Beverages"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inventory-category-description">Description (optional)</Label>
              <Textarea
                id="inventory-category-description"
                value={categoryForm.description}
                onChange={(e) =>
                  setCategoryForm((form) => ({ ...form, description: e.target.value }))
                }
                placeholder="Short note about this category"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowCategoryDialog(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-amber-600 text-white hover:bg-amber-700"
              disabled={!categoryForm.name.trim() || categoryMutation.isPending}
              onClick={() => categoryMutation.mutate()}
            >
              {categoryMutation.isPending ? 'Saving…' : 'Add category'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InventoryItemHistoryDialog
        itemId={historyItemId}
        open={!!historyItemId}
        onOpenChange={(open) => {
          if (!open) setHistoryItemId(null)
        }}
      />

      <Dialog open={showTransactionDialog} onOpenChange={setShowTransactionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {transactionForm.type === 'in'
                ? 'Stock In'
                : transactionForm.type === 'out'
                  ? 'Stock Out'
                  : 'Record Waste'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Transaction Type</Label>
              <Select
                value={transactionForm.type}
                onValueChange={(value) =>
                  setTransactionForm((form) => ({ ...form, type: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">Stock In (Add)</SelectItem>
                  <SelectItem value="out">Stock Out (Use)</SelectItem>
                  <SelectItem value="waste">Waste</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Quantity</Label>
              <Input
                type="number"
                placeholder="Enter quantity"
                value={transactionForm.quantity}
                onChange={(e) =>
                  setTransactionForm((form) => ({ ...form, quantity: e.target.value }))
                }
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="Transaction notes"
                value={transactionForm.notes}
                onChange={(e) =>
                  setTransactionForm((form) => ({ ...form, notes: e.target.value }))
                }
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTransactionDialog(false)}>
              Cancel
            </Button>
            <Button
              className={
                transactionForm.type === 'in'
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-amber-600 text-white hover:bg-amber-700'
              }
              disabled={
                !transactionForm.quantity ||
                parseFloat(transactionForm.quantity) <= 0 ||
                transactionMutation.isPending
              }
              onClick={() => transactionMutation.mutate()}
            >
              {transactionMutation.isPending ? 'Processing...' : 'Confirm Transaction'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
