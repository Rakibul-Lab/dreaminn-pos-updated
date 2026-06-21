'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Users, Wifi } from 'lucide-react';
import { useAuthStore, canManageRoomInventory } from '@/lib/auth-store';

interface RoomType {
  id: string;
  name: string;
  description?: string;
  capacity: number;
  amenities?: string | null;
  _count?: { rooms: number };
}

export function RoomTypesPage() {
  const user = useAuthStore((s) => s.user);
  const canManage = canManageRoomInventory(user?.role);
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<RoomType | null>(null);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCapacity, setFormCapacity] = useState('2');
  const [formAmenities, setFormAmenities] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['room-types'],
    queryFn: () => api.get<{ success: boolean; data: RoomType[] }>('/room-types'),
  });

  const roomTypes = ((data as any)?.data || []) as RoomType[];

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post('/room-types', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['room-types'] });
      toast.success('Room type created successfully');
      closeDialog();
    },
    onError: () => toast.error('Failed to create room type'),
  });

  const updateMutation = useMutation({
    mutationFn: (body: any) => api.put('/room-types', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['room-types'] });
      toast.success('Room type updated successfully');
      closeDialog();
    },
    onError: () => toast.error('Failed to update room type'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/room-types?id=${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['room-types'] });
      toast.success('Room type deleted successfully');
      setDeleteDialogOpen(false);
      setSelectedType(null);
    },
    onError: () => toast.error('Failed to delete room type'),
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setSelectedType(null);
    setFormName('');
    setFormDescription('');
    setFormCapacity('2');
    setFormAmenities('');
  };

  const openEditDialog = (rt: RoomType) => {
    setSelectedType(rt);
    setFormName(rt.name);
    setFormDescription(rt.description || '');
    setFormCapacity(String(rt.capacity));
    try {
      const amenities = rt.amenities ? JSON.parse(rt.amenities) : [];
      setFormAmenities(Array.isArray(amenities) ? amenities.join(', ') : rt.amenities || '');
    } catch {
      setFormAmenities(rt.amenities || '');
    }
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formName) {
      toast.error('Name is required');
      return;
    }

    const amenitiesArr = formAmenities
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);

    const payload = {
      name: formName,
      description: formDescription,
      capacity: parseInt(formCapacity),
      amenities: amenitiesArr.length > 0 ? JSON.stringify(amenitiesArr) : null,
    };

    if (selectedType) {
      updateMutation.mutate({ id: selectedType.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const parseAmenities = (amenities: string | null | undefined): string[] => {
    if (!amenities) return [];
    try {
      const parsed = JSON.parse(amenities);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  if (!canManage) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="p-6 text-center">
          <p className="text-amber-700 font-medium">Access Denied</p>
          <p className="text-amber-600 text-sm mt-1">Only hotel managers and admins can manage room types.</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Room Types</h2>
          <p className="text-sm text-muted-foreground">
            {roomTypes.length} categories — set rates per room on the Rooms page
          </p>
        </div>
        <Button className="bg-amber-600 hover:bg-amber-700 text-white" onClick={() => setDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Room Type
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {roomTypes.map((rt) => (
          <Card key={rt.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{rt.name}</CardTitle>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(rt)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-red-500 hover:text-red-600"
                    onClick={() => {
                      if ((rt._count?.rooms || 0) > 0) {
                        toast.error('Cannot delete room type with assigned rooms');
                        return;
                      }
                      setSelectedType(rt);
                      setDeleteDialogOpen(true);
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {rt.description && (
                <p className="text-sm text-muted-foreground">{rt.description}</p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Users className="w-4 h-4 text-emerald-600" />
                  <span className="text-muted-foreground">Capacity:</span>
                  <span className="font-semibold">{rt.capacity} guests</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Rooms:</span>
                  <span className="font-semibold">{rt._count?.rooms || 0}</span>
                </div>
              </div>
              {parseAmenities(rt.amenities).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {parseAmenities(rt.amenities).map((amenity) => (
                    <span
                      key={amenity}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted text-xs rounded-full"
                    >
                      <Wifi className="w-3 h-3" />
                      {amenity}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedType ? 'Edit Room Type' : 'Add Room Type'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Deluxe" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder="Room type description" rows={2} />
            </div>
            <div className="space-y-2">
              <Label>Capacity</Label>
              <Input type="number" value={formCapacity} onChange={(e) => setFormCapacity(e.target.value)} placeholder="2" />
            </div>
            <div className="space-y-2">
              <Label>Amenities (comma separated)</Label>
              <Input value={formAmenities} onChange={(e) => setFormAmenities(e.target.value)} placeholder="WiFi, AC, TV, Mini Bar" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {(createMutation.isPending || updateMutation.isPending) ? 'Saving...' : selectedType ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Room Type</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{selectedType?.name}&rdquo;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => selectedType && deleteMutation.mutate(selectedType.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
