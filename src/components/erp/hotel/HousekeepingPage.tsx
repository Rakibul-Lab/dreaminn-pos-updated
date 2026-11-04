'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { StatusBadge } from '../shared/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Plus, Play, CheckCircle2, Clock, SprayCan, UserPlus, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CleaningStaffListPanel } from './CleaningStaffListPanel';
import { getPaginationPages } from '@/lib/pagination-pages';
import { cn } from '@/lib/utils';
import {
  CleaningStaffSearchField,
  formatCleaningStaffLabel,
  type CleaningStaffResult,
} from './CleaningStaffSearchField';

interface HousekeepingTask {
  id: string;
  roomId: string;
  taskType: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  assignedTo: string | null;
  cleaningStaffId: string | null;
  notes?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  room: { id: string; roomNumber: string; floor: number; status: string };
  cleaningStaff: {
    id: string;
    staffCode: string;
    name: string;
    phone?: string | null;
  } | null;
  assigned: { id: string; name: string; email: string; role: string } | null;
}

interface Room {
  id: string;
  roomNumber: string;
  floor: number;
  status: string;
}

function taskAssigneeName(task: HousekeepingTask): string {
  if (task.cleaningStaff) return task.cleaningStaff.name;
  if (task.assigned) return task.assigned.name;
  return 'Unassigned';
}

function taskAssigneeId(task: HousekeepingTask): string | null {
  if (task.cleaningStaff) return task.cleaningStaff.staffCode;
  if (task.assigned) return task.assigned.id;
  return null;
}

export function HousekeepingPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [staffDialogOpen, setStaffDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('tasks');
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [startTask, setStartTask] = useState<HousekeepingTask | null>(null);

  const [formRoomId, setFormRoomId] = useState('');
  const [formTaskType, setFormTaskType] = useState('cleaning');
  const [formCleaningStaffId, setFormCleaningStaffId] = useState('');
  const [formCleaningStaffLabel, setFormCleaningStaffLabel] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const [startCleaningStaffId, setStartCleaningStaffId] = useState('');
  const [startCleaningStaffLabel, setStartCleaningStaffLabel] = useState('');
  const [startNotes, setStartNotes] = useState('');

  const [staffCode, setStaffCode] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffPhone, setStaffPhone] = useState('');

  const buildQuery = (status?: string, p = page, limit = pageSize) => {
    const params: string[] = [`page=${p}`, `limit=${limit}`];
    const s = status ?? (statusFilter !== 'all' ? statusFilter : undefined);
    if (s) params.push(`status=${s}`);
    return `/housekeeping?${params.join('&')}`;
  };

  const { data, isLoading } = useQuery({
    queryKey: ['housekeeping', statusFilter, page, pageSize],
    queryFn: () =>
      api.get<{
        success: boolean;
        data: HousekeepingTask[];
        meta: { total: number; page: number; totalPages: number };
      }>(buildQuery()),
  });

  const { data: pendingCountData } = useQuery({
    queryKey: ['housekeeping-count', 'PENDING'],
    queryFn: () => api.get(buildQuery('PENDING', 1, 1)),
  });
  const { data: inProgressCountData } = useQuery({
    queryKey: ['housekeeping-count', 'IN_PROGRESS'],
    queryFn: () => api.get(buildQuery('IN_PROGRESS', 1, 1)),
  });
  const { data: completedCountData } = useQuery({
    queryKey: ['housekeeping-count', 'COMPLETED'],
    queryFn: () => api.get(buildQuery('COMPLETED', 1, 1)),
  });

  const { data: roomsData } = useQuery({
    queryKey: ['rooms-for-housekeeping'],
    queryFn: () => api.get('/rooms?limit=100'),
  });

  const tasks = ((data as any)?.data || []) as HousekeepingTask[];
  const total = (data as any)?.meta?.total || 0;
  const totalPages = Math.max((data as any)?.meta?.totalPages || 1, 1);
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const pageNumbers = getPaginationPages(page, totalPages);
  const rooms = ((roomsData as any)?.data || []) as Room[];

  const addStaffMutation = useMutation({
    mutationFn: (body: { staffCode: string; name: string; phone?: string }) =>
      api.post('/housekeeping/cleaning-staff', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaning-staff-search'] });
      queryClient.invalidateQueries({ queryKey: ['cleaning-staff-list'] });
      toast.success('Cleaning staff added');
      closeStaffDialog();
    },
    onError: (err: Error) => {
      toast.error(err?.message || 'Failed to add cleaning staff');
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post('/housekeeping', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['housekeeping'] });
      queryClient.invalidateQueries({ queryKey: ['housekeeping-count'] });
      queryClient.invalidateQueries({ queryKey: ['cleaning-staff-list'] });
      queryClient.invalidateQueries({ queryKey: ['cleaning-staff-history'] });
      toast.success('Task created successfully');
      closeCreateDialog();
    },
    onError: (err: Error) => toast.error(err?.message || 'Failed to create task'),
  });

  const updateMutation = useMutation({
    mutationFn: (body: any) => api.put('/housekeeping', body),
    onSuccess: (res: any) => {
      if (!res?.success) {
        toast.error(res?.error || res?.message || 'Failed to update task');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['housekeeping'] });
      queryClient.invalidateQueries({ queryKey: ['housekeeping-count'] });
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      queryClient.invalidateQueries({ queryKey: ['cleaning-staff-list'] });
      queryClient.invalidateQueries({ queryKey: ['cleaning-staff-history'] });
      toast.success('Task updated successfully');
      closeStartDialog();
    },
    onError: (err: Error) => toast.error(err?.message || 'Failed to update task'),
  });

  const resetCreateForm = () => {
    setFormRoomId('');
    setFormTaskType('cleaning');
    setFormCleaningStaffId('');
    setFormCleaningStaffLabel('');
    setFormNotes('');
  };

  const resetStaffForm = () => {
    setStaffCode('');
    setStaffName('');
    setStaffPhone('');
  };

  const resetStartForm = () => {
    setStartCleaningStaffId('');
    setStartCleaningStaffLabel('');
    setStartNotes('');
  };

  const closeCreateDialog = () => {
    setCreateDialogOpen(false);
    resetCreateForm();
  };

  const closeStaffDialog = () => {
    setStaffDialogOpen(false);
    resetStaffForm();
  };

  const closeStartDialog = () => {
    setStartDialogOpen(false);
    setStartTask(null);
    resetStartForm();
  };

  const openCreateDialog = () => {
    resetCreateForm();
    setCreateDialogOpen(true);
  };

  const openStaffDialog = () => {
    resetStaffForm();
    setStaffDialogOpen(true);
  };

  const handleAddStaff = () => {
    if (!staffCode.trim()) {
      toast.error('Staff ID is required');
      return;
    }
    if (!staffName.trim()) {
      toast.error('Staff name is required');
      return;
    }
    addStaffMutation.mutate({
      staffCode: staffCode.trim(),
      name: staffName.trim(),
      phone: staffPhone.trim() || undefined,
    });
  };

  const handleCreate = () => {
    if (!formRoomId || !formTaskType) {
      toast.error('Room and task type are required');
      return;
    }
    if (!formCleaningStaffId) {
      toast.error('Please assign cleaning staff');
      return;
    }
    createMutation.mutate({
      roomId: formRoomId,
      taskType: formTaskType,
      cleaningStaffId: formCleaningStaffId,
      notes: formNotes.trim() || undefined,
    });
  };

  const handleStatusUpdate = (taskId: string, newStatus: string) => {
    updateMutation.mutate({ id: taskId, status: newStatus });
  };

  const openStartDialog = (task: HousekeepingTask) => {
    setStartTask(task);
    resetStartForm();
    setStartNotes(task.notes || '');
    setStartDialogOpen(true);
  };

  const handleStartTask = () => {
    if (!startTask) return;
    if (!startCleaningStaffId) {
      toast.error('Please assign cleaning staff');
      return;
    }
    updateMutation.mutate({
      id: startTask.id,
      status: 'IN_PROGRESS',
      cleaningStaffId: startCleaningStaffId,
      notes: startNotes.trim() || null,
    });
  };

  const handleSelectFormStaff = (staff: CleaningStaffResult) => {
    setFormCleaningStaffId(staff.id);
    setFormCleaningStaffLabel(formatCleaningStaffLabel(staff));
  };

  const handleSelectStartStaff = (staff: CleaningStaffResult) => {
    setStartCleaningStaffId(staff.id);
    setStartCleaningStaffLabel(formatCleaningStaffLabel(staff));
  };

  const getTaskTypeIcon = (type: string) => {
    switch (type) {
      case 'cleaning':
        return <SprayCan className="w-4 h-4 text-amber-500" />;
      case 'maintenance':
        return <Clock className="w-4 h-4 text-muted-foreground" />;
      case 'deep_clean':
        return <SprayCan className="w-4 h-4 text-emerald-500" />;
      default:
        return <SprayCan className="w-4 h-4" />;
    }
  };

  const counts = {
    pending: (pendingCountData as any)?.meta?.total ?? 0,
    inProgress: (inProgressCountData as any)?.meta?.total ?? 0,
    completed: (completedCountData as any)?.meta?.total ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Housekeeping</h2>
          <p className="text-sm text-muted-foreground">Manage cleaning and maintenance tasks</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeTab === 'tasks' && (
            <>
              <Button variant="outline" onClick={openStaffDialog}>
                <UserPlus className="w-4 h-4 mr-2" />
                Add Cleaning Staff
              </Button>
              <Button className="bg-amber-600 hover:bg-amber-700 text-white" onClick={openCreateDialog}>
                <Plus className="w-4 h-4 mr-2" />
                Create Task
              </Button>
            </>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="staff">
            <Users className="w-4 h-4 mr-1.5" />
            Cleaning Staff
          </TabsTrigger>
        </TabsList>

        <TabsContent value="staff" className="mt-4">
          <CleaningStaffListPanel />
        </TabsContent>

        <TabsContent value="tasks" className="mt-4 space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-4 flex items-center gap-3">
            <Clock className="w-5 h-5 text-amber-600" />
            <div>
              <p className="text-2xl font-bold text-amber-700">{counts.pending}</p>
              <p className="text-xs text-amber-600">Pending</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-orange-50 border-orange-200">
          <CardContent className="p-4 flex items-center gap-3">
            <Play className="w-5 h-5 text-orange-600" />
            <div>
              <p className="text-2xl font-bold text-orange-700">{counts.inProgress}</p>
              <p className="text-xs text-orange-600">In Progress</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50 border-emerald-200">
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <div>
              <p className="text-2xl font-bold text-emerald-700">{counts.completed}</p>
              <p className="text-xs text-emerald-600">Completed</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tasks</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            {Array.from({ length: pageSize }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-border bg-card text-card-foreground shadow-sm">
          <div className="max-h-[min(70vh,720px)] overflow-auto custom-scrollbar">
            <table className="bookings-sticky-table bookings-sticky-table--in-scroll w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="p-3 text-left font-medium">Room</th>
                  <th className="p-3 text-left font-medium">Task Type</th>
                  <th className="p-3 text-left font-medium">Assigned To</th>
                  <th className="p-3 text-left font-medium">Status</th>
                  <th className="p-3 text-left font-medium">Created</th>
                  <th className="p-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-background">
              {tasks.map((task) => (
                <tr key={task.id} className="border-b border-border/60 hover:bg-muted/40">
                  <td className="p-3">
                    <div>
                      <p className="font-medium">Room {task.room?.roomNumber}</p>
                      <p className="text-xs text-muted-foreground">Floor {task.room?.floor}</p>
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {getTaskTypeIcon(task.taskType)}
                      <span className="capitalize">{task.taskType?.replace('_', ' ')}</span>
                    </div>
                  </td>
                  <td className="p-3">
                    <p className="font-medium">{taskAssigneeName(task)}</p>
                    {taskAssigneeId(task) && (
                      <p className="text-xs text-muted-foreground">ID: {taskAssigneeId(task)}</p>
                    )}
                  </td>
                  <td className="p-3">
                    <StatusBadge status={task.status} />
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {format(new Date(task.createdAt), 'MMM dd, HH:mm')}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      {task.status === 'PENDING' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs border-amber-500 text-amber-700 hover:bg-amber-50"
                          onClick={() => openStartDialog(task)}
                          disabled={updateMutation.isPending}
                        >
                          <Play className="w-3 h-3 mr-1" />
                          Start
                        </Button>
                      )}
                      {task.status === 'IN_PROGRESS' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs border-emerald-500 text-emerald-700 hover:bg-emerald-50"
                          onClick={() => handleStatusUpdate(task.id, 'COMPLETED')}
                          disabled={updateMutation.isPending}
                        >
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Complete
                        </Button>
                      )}
                      {task.status === 'COMPLETED' && (
                        <span className="text-xs text-emerald-600">Done</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    No housekeeping tasks found
                  </td>
                </tr>
              )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {total === 0 ? 'No results' : `Showing ${rangeStart}–${rangeEnd} of ${total}`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 / page</SelectItem>
                  <SelectItem value="20">20 / page</SelectItem>
                  <SelectItem value="50">50 / page</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <div className="flex flex-wrap items-center gap-1">
                {pageNumbers.map((item, index) =>
                  item === 'ellipsis' ? (
                    <span
                      key={`ellipsis-${index}`}
                      className="flex h-8 min-w-8 items-center justify-center px-1 text-sm text-muted-foreground"
                    >
                      …
                    </span>
                  ) : (
                    <Button
                      key={item}
                      type="button"
                      variant="outline"
                      size="sm"
                      className={cn(
                        'h-8 min-w-8 px-2',
                        item === page &&
                          'border-amber-600 bg-amber-600 text-white hover:bg-amber-700 hover:text-white'
                      )}
                      onClick={() => setPage(item)}
                      aria-current={item === page ? 'page' : undefined}
                    >
                      {item}
                    </Button>
                  )
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
        </TabsContent>
      </Tabs>

      <Dialog open={staffDialogOpen} onOpenChange={(open) => { if (!open) closeStaffDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Cleaning Staff</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Staff ID *</Label>
              <Input
                value={staffCode}
                onChange={(e) => setStaffCode(e.target.value)}
                placeholder="e.g. HK-001"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">Enter the ID you assign to this staff member</p>
            </div>
            <div className="space-y-2">
              <Label>Staff Name *</Label>
              <Input
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                placeholder="Full name"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={staffPhone}
                onChange={(e) => setStaffPhone(e.target.value)}
                placeholder="Optional"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeStaffDialog}>Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleAddStaff}
              disabled={addStaffMutation.isPending}
            >
              {addStaffMutation.isPending ? 'Saving...' : 'Add Staff'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createDialogOpen} onOpenChange={(open) => { if (!open) closeCreateDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Housekeeping Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Room *</Label>
              <Select value={formRoomId || undefined} onValueChange={setFormRoomId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select room" />
                </SelectTrigger>
                <SelectContent>
                  {rooms.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      Room {r.roomNumber} - Floor {r.floor} ({r.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Task Type *</Label>
              <Select value={formTaskType} onValueChange={setFormTaskType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cleaning">Cleaning</SelectItem>
                  <SelectItem value="deep_clean">Deep Clean</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <CleaningStaffSearchField
              label="Assign Staff *"
              selectedId={formCleaningStaffId}
              selectedLabel={formCleaningStaffLabel}
              onSelect={handleSelectFormStaff}
              onClear={() => {
                setFormCleaningStaffId('');
                setFormCleaningStaffLabel('');
              }}
            />
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Additional instructions..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCreateDialog}>Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleCreate}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={startDialogOpen} onOpenChange={(open) => { if (!open) closeStartDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Start Cleaning</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">Room {startTask?.room?.roomNumber || '-'}</p>
              <p className="text-xs text-muted-foreground">
                {startTask?.taskType ? startTask.taskType.replace('_', ' ') : 'Cleaning task'}
              </p>
            </div>
            <CleaningStaffSearchField
              label="Assign Staff *"
              selectedId={startCleaningStaffId}
              selectedLabel={startCleaningStaffLabel}
              onSelect={handleSelectStartStaff}
              onClear={() => {
                setStartCleaningStaffId('');
                setStartCleaningStaffLabel('');
              }}
            />
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={startNotes}
                onChange={(e) => setStartNotes(e.target.value)}
                placeholder="Cleaning instructions..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeStartDialog}>
              Cancel
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleStartTask}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Starting...' : 'Start Cleaning'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
