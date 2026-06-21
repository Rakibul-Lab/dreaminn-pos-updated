'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useAuthStore, canAccessInventory } from '@/lib/auth-store'
import { useToast } from '@/hooks/use-toast'
import {
  Package, Plus, Edit2, ArrowUpCircle, ArrowDownCircle, AlertTriangle,
  RefreshCw, Filter, FileDown, Loader2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import {
  buildInventoryExportQuery,
  downloadInventoryExcel,
  downloadInventoryPdf,
  type InventoryExportRecord,
} from '@/lib/inventory-export'

interface InventoryItem {
  id: string
  name: string
  category: string | null
  unit: string
  quantity: number
  minQuantity: number
  costPerUnit: number | null
  supplier: string | null
  createdAt: string
  updatedAt: string
}

export default function InventoryPage() {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [showLowStock, setShowLowStock] = useState(false)
  const [page, setPage] = useState(1)
  const [showItemDialog, setShowItemDialog] = useState(false)
  const [showTransactionDialog, setShowTransactionDialog] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string>('')
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)

  const [itemForm, setItemForm] = useState({
    name: '',
    category: '',
    unit: 'piece',
    quantity: '0',
    minQuantity: '0',
    costPerUnit: '',
    supplier: '',
  })

  const [transactionForm, setTransactionForm] = useState({
    type: 'in',
    quantity: '',
    notes: '',
  })

  // Fetch inventory items
  const { data: inventoryData, isLoading } = useQuery({
    queryKey: ['inventory', categoryFilter, showLowStock, page],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', '20')
      if (categoryFilter !== 'all') params.set('category', categoryFilter)
      if (showLowStock) params.set('lowStock', 'true')
      const res = await api.get<{ success: boolean; data: InventoryItem[]; meta?: { total: number; totalPages: number } }>(`/inventory?${params.toString()}`)
      return res
    },
    enabled: !!user && canAccessInventory(user?.role),
  })

  // Create/Update item mutation
  const itemMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...itemForm,
        quantity: parseFloat(itemForm.quantity) || 0,
        minQuantity: parseFloat(itemForm.minQuantity) || 0,
        costPerUnit: itemForm.costPerUnit ? parseFloat(itemForm.costPerUnit) : null,
      }
      if (editingItem) {
        return api.put('/inventory', { id: editingItem.id, ...payload })
      }
      return api.post('/inventory', payload)
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      toast({ title: editingItem ? 'Item Updated' : 'Item Created', description: res.message || 'Success' })
      closeItemDialog()
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to save item', variant: 'destructive' })
    },
  })

  // Transaction mutation
  const transactionMutation = useMutation({
    mutationFn: async () => {
      return api.post('/inventory', {
        action: 'transaction',
        itemId: selectedItemId,
        type: transactionForm.type,
        quantity: parseFloat(transactionForm.quantity),
        notes: transactionForm.notes || null,
      })
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      toast({ title: 'Transaction Complete', description: res.message || 'Stock updated' })
      setShowTransactionDialog(false)
      setTransactionForm({ type: 'in', quantity: '', notes: '' })
      setSelectedItemId('')
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to process transaction', variant: 'destructive' })
    },
  })

  const closeItemDialog = () => {
    setShowItemDialog(false)
    setEditingItem(null)
    setItemForm({ name: '', category: '', unit: 'piece', quantity: '0', minQuantity: '0', costPerUnit: '', supplier: '' })
  }

  const openEditDialog = (item: InventoryItem) => {
    setEditingItem(item)
    setItemForm({
      name: item.name,
      category: item.category || '',
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

  if (!user || !canAccessInventory(user.role)) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="p-6 text-center">
          <p className="text-amber-700 font-medium">Access Denied</p>
          <p className="text-amber-600 text-sm mt-1">You do not have permission to manage inventory.</p>
        </CardContent>
      </Card>
    )
  }

  const items = inventoryData?.data || []
  const totalPages = inventoryData?.meta?.totalPages || 1
  const lowStockItems = items.filter((item) => item.quantity <= item.minQuantity)

  // Extract unique categories
  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))] as string[]

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
        toast({ title: 'No items to export', description: 'Adjust filters to include inventory items.', variant: 'destructive' })
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
        toast({ title: 'No items to export', description: 'Adjust filters to include inventory items.', variant: 'destructive' })
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Package className="h-6 w-6 text-amber-600" />
            Inventory
          </h2>
          <p className="text-muted-foreground text-sm mt-1">Manage stock items and supplies</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExportExcel()}
            disabled={!!exporting || isLoading}
          >
            {exporting === 'excel' ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4 mr-2" />
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
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4 mr-2" />
            )}
            Export PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['inventory'] })}
          >
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
          <Button onClick={() => { setEditingItem(null); setItemForm({ name: '', category: '', unit: 'piece', quantity: '0', minQuantity: '0', costPerUnit: '', supplier: '' }); setShowItemDialog(true) }} className="bg-amber-600 hover:bg-amber-700 text-white">
            <Plus className="h-4 w-4 mr-2" /> Add Item
          </Button>
        </div>
      </div>

      {/* Low Stock Alerts */}
      {lowStockItems.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-red-700 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Low Stock Alerts ({lowStockItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {lowStockItems.map((item) => (
                <Badge key={item.id} variant="outline" className="bg-card text-red-700 border-red-300">
                  {item.name}: {item.quantity} {item.unit} (min: {item.minQuantity})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPage(1) }}>
              <SelectTrigger className="w-full sm:w-48">
                <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={showLowStock ? 'default' : 'outline'}
              className={showLowStock ? 'bg-red-600 hover:bg-red-700 text-white' : ''}
              onClick={() => { setShowLowStock(!showLowStock); setPage(1) }}
            >
              <AlertTriangle className="h-4 w-4 mr-2" />
              {showLowStock ? 'Showing Low Stock' : 'Low Stock Only'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Items Table */}
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
                        <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No items found</TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => {
                    const isLow = item.quantity <= item.minQuantity
                    return (
                      <TableRow key={item.id} className={`hover:bg-muted ${isLow ? 'bg-red-50/50' : ''}`}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{item.category || 'Uncategorized'}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{item.unit}</TableCell>
                        <TableCell className={`text-right font-semibold ${isLow ? 'text-red-600' : 'text-foreground'}`}>
                          {item.quantity}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{item.minQuantity}</TableCell>
                        <TableCell>
                          {isLow ? (
                            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                              <AlertTriangle className="h-3 w-3 mr-1" /> Low Stock
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                              In Stock
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {item.costPerUnit ? `৳${item.costPerUnit}` : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEditDialog(item)} title="Edit">
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => openTransactionDialog(item.id, 'in')} title="Stock In">
                              <ArrowUpCircle className="h-4 w-4 text-emerald-500" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => openTransactionDialog(item.id, 'out')} title="Stock Out">
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
          <span className="flex items-center px-3 text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
        </div>
      )}

      {/* Add/Edit Item Dialog */}
      <Dialog open={showItemDialog} onOpenChange={(open) => { if (!open) closeItemDialog() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Edit Item' : 'Add New Item'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input placeholder="Item name" value={itemForm.name} onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label>Category</Label>
              <Input placeholder="Category (e.g., Meat, Dairy, Housekeeping)" value={itemForm.category} onChange={(e) => setItemForm((f) => ({ ...f, category: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Unit</Label>
                <Select value={itemForm.unit} onValueChange={(v) => setItemForm((f) => ({ ...f, unit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="piece">Piece</SelectItem>
                    <SelectItem value="kg">Kilogram (kg)</SelectItem>
                    <SelectItem value="liter">Liter</SelectItem>
                    <SelectItem value="pack">Pack</SelectItem>
                    <SelectItem value="box">Box</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Cost Per Unit (৳)</Label>
                <Input type="number" placeholder="0" value={itemForm.costPerUnit} onChange={(e) => setItemForm((f) => ({ ...f, costPerUnit: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Quantity</Label>
                <Input type="number" placeholder="0" value={itemForm.quantity} onChange={(e) => setItemForm((f) => ({ ...f, quantity: e.target.value }))} />
              </div>
              <div>
                <Label>Min Quantity</Label>
                <Input type="number" placeholder="0" value={itemForm.minQuantity} onChange={(e) => setItemForm((f) => ({ ...f, minQuantity: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Supplier (optional)</Label>
              <Input placeholder="Supplier name" value={itemForm.supplier} onChange={(e) => setItemForm((f) => ({ ...f, supplier: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeItemDialog}>Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={!itemForm.name || itemMutation.isPending}
              onClick={() => itemMutation.mutate()}
            >
              {itemMutation.isPending ? 'Saving...' : editingItem ? 'Update Item' : 'Add Item'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stock Transaction Dialog */}
      <Dialog open={showTransactionDialog} onOpenChange={setShowTransactionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {transactionForm.type === 'in' ? 'Stock In' : transactionForm.type === 'out' ? 'Stock Out' : 'Record Waste'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Transaction Type</Label>
              <Select value={transactionForm.type} onValueChange={(v) => setTransactionForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
                onChange={(e) => setTransactionForm((f) => ({ ...f, quantity: e.target.value }))}
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="Transaction notes"
                value={transactionForm.notes}
                onChange={(e) => setTransactionForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTransactionDialog(false)}>Cancel</Button>
            <Button
              className={transactionForm.type === 'in' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-amber-600 hover:bg-amber-700 text-white'}
              disabled={!transactionForm.quantity || parseFloat(transactionForm.quantity) <= 0 || transactionMutation.isPending}
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
