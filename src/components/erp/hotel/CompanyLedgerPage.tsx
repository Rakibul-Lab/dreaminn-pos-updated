'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmailInput } from '@/components/ui/email-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Plus,
  Search,
  Building2,
  Phone,
  Mail,
  MapPin,
  Users,
  Pencil,
  Trash2,
  Eye,
} from 'lucide-react';
import { getPaginationPages } from '@/lib/pagination-pages';
import { formatBdt } from '@/lib/currency';
import {
  openCloudViewRestaurantLedgerTab,
  openCompanyLedgerCompanyViewTab,
} from '@/lib/company-ledger-navigation';
import { useAuthStore, canAccessAdmin } from '@/lib/auth-store';
import { CLOUDVIEW_RESTAURANT_SLUG } from '@/lib/cloudview-ledger';

interface CompanyLedgerRecord {
  id: string;
  name: string;
  slug?: string | null;
  isSystem?: boolean;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  active: boolean;
  totalBilled?: number;
  totalPaid?: number;
  dueAmount?: number;
  _count?: { guests: number; bills?: number };
}

const emptyCompanyForm = {
  name: '',
  contactPerson: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
};

export function CompanyLedgerPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = canAccessAdmin(user?.role);
  const isRestaurantStaff = user?.role === 'RESTAURANT_STAFF';
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<CompanyLedgerRecord | null>(null);
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm);
  const [companyEmailBlocking, setCompanyEmailBlocking] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const listQuery = useQuery({
    queryKey: ['company-ledger', page, pageSize, searchQuery],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(pageSize));
      if (searchQuery) params.set('search', searchQuery);
      return api.get<{
        success: boolean;
        data: CompanyLedgerRecord[];
        meta?: { total: number; totalPages: number };
      }>(`/company-ledger?${params.toString()}`);
    },
    enabled: !isRestaurantStaff,
  });

  const companies = listQuery.data?.data ?? [];
  const total = listQuery.data?.meta?.total ?? 0;
  const totalPages = listQuery.data?.meta?.totalPages ?? 1;

  const saveCompanyMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: companyForm.name.trim(),
        contactPerson: companyForm.contactPerson.trim() || null,
        phone: companyForm.phone.trim() || null,
        email: companyForm.email.trim() || null,
        address: companyForm.address.trim() || null,
        notes: companyForm.notes.trim() || null,
      };
      if (editingCompany) {
        return api.put(`/company-ledger/${editingCompany.id}`, payload);
      }
      return api.post('/company-ledger', payload);
    },
    onSuccess: (res: { success?: boolean; message?: string; error?: string }) => {
      if (!res?.success) {
        toast.error(res?.error || 'Failed to save company');
        return;
      }
      toast.success(res.message || 'Company saved');
      setCompanyDialogOpen(false);
      setEditingCompany(null);
      setCompanyForm(emptyCompanyForm);
      queryClient.invalidateQueries({ queryKey: ['company-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['company-ledger-options'] });
    },
    onError: () => toast.error('Failed to save company'),
  });

  const deleteCompanyMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/company-ledger/${id}`),
    onSuccess: (res: { success?: boolean; message?: string; error?: string }) => {
      if (!res?.success) {
        toast.error(res?.error || 'Failed to delete company');
        return;
      }
      toast.success(res.message || 'Company removed');
      queryClient.invalidateQueries({ queryKey: ['company-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['company-ledger-options'] });
    },
    onError: () => toast.error('Failed to delete company'),
  });

  const openAddCompany = () => {
    setEditingCompany(null);
    setCompanyForm(emptyCompanyForm);
    setCompanyDialogOpen(true);
  };

  const openEditCompany = (company: CompanyLedgerRecord) => {
    setEditingCompany(company);
    setCompanyForm({
      name: company.name,
      contactPerson: company.contactPerson || '',
      phone: company.phone || '',
      email: company.email || '',
      address: company.address || '',
      notes: company.notes || '',
    });
    setCompanyDialogOpen(true);
  };

  const paginationPages = getPaginationPages(page, totalPages);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Building2 className="h-5 w-5 text-amber-600" />
            Company Ledger
          </h2>
          <p className="text-sm text-muted-foreground">
            Corporate accounts, guests from reservations, and company billing
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="border-emerald-300 text-emerald-800 hover:bg-emerald-50"
            onClick={() => openCloudViewRestaurantLedgerTab()}
          >
            <Eye className="w-4 h-4 mr-2" />
            CloudView Restaurant
          </Button>
          {!isRestaurantStaff && (
          <Button className="bg-amber-600 hover:bg-amber-700 text-white" onClick={openAddCompany}>
            <Plus className="w-4 h-4 mr-2" />
            Add Company
          </Button>
          )}
        </div>
      </div>

      {isRestaurantStaff ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <p>Open CloudView Restaurant to view, clear, and collect hotel-owed restaurant bills.</p>
          </CardContent>
        </Card>
      ) : (
      <>
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search company or guest name..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="pl-9"
        />
      </div>

      {listQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : companies.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Building2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No companies in the ledger yet.</p>
            <p className="text-sm mt-1">
              Add a company, then select it on new reservations to bill checkout to the ledger.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {companies.map((company) => {
            const guestCount = company._count?.guests ?? 0;

            return (
              <Card key={company.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                        {company.name}
                        {company.isSystem && (
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
                            System
                          </Badge>
                        )}
                        <Badge variant="secondary" className="font-normal">
                          <Users className="h-3 w-3 mr-1" />
                          {guestCount} guest{guestCount !== 1 ? 's' : ''}
                        </Badge>
                      </CardTitle>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <Badge variant="outline">Billed: {formatBdt(company.totalBilled ?? 0)}</Badge>
                        <Badge variant="outline" className="text-emerald-700">
                          Paid: {formatBdt(company.totalPaid ?? 0)}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={(company.dueAmount ?? 0) > 0 ? 'text-red-700' : ''}
                        >
                          Due: {formatBdt(company.dueAmount ?? 0)}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        {company.contactPerson && (
                          <span>Contact: {company.contactPerson}</span>
                        )}
                        {company.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {company.phone}
                          </span>
                        )}
                        {company.email && (
                          <span className="inline-flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {company.email}
                          </span>
                        )}
                        {company.address && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {company.address}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(!company.isSystem || isAdmin) && (
                        <Button size="sm" variant="outline" onClick={() => openEditCompany(company)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {!company.isSystem && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50"
                          title="Delete company"
                          disabled={deleteCompanyMutation.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remove "${company.name}" and all its guests from the ledger?`
                              )
                            ) {
                              deleteCompanyMutation.mutate(company.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                        title={
                          company.slug === CLOUDVIEW_RESTAURANT_SLUG
                            ? 'Open CloudView restaurant ledger'
                            : 'View guest list & settle due'
                        }
                        onClick={() => {
                          if (company.slug === CLOUDVIEW_RESTAURANT_SLUG) {
                            openCloudViewRestaurantLedgerTab();
                          } else {
                            openCompanyLedgerCompanyViewTab(company.id);
                          }
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1">
          {paginationPages.map((p, idx) =>
            p === '...' ? (
              <span key={`ellipsis-${idx}`} className="px-2 text-muted-foreground">
                …
              </span>
            ) : (
              <Button
                key={p}
                size="sm"
                variant={page === p ? 'default' : 'outline'}
                onClick={() => setPage(p as number)}
              >
                {p}
              </Button>
            )
          )}
        </div>
      )}
      </>
      )}

      <Dialog open={companyDialogOpen} onOpenChange={setCompanyDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingCompany ? 'Edit Company' : 'Add Company'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-2">
              <Label>Company name *</Label>
              <Input
                value={companyForm.name}
                onChange={(e) => setCompanyForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. ABC Corporation Ltd."
              />
            </div>
            <div className="space-y-2">
              <Label>Contact person</Label>
              <Input
                value={companyForm.contactPerson}
                onChange={(e) => setCompanyForm((f) => ({ ...f, contactPerson: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={companyForm.phone}
                  onChange={(e) => setCompanyForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <EmailInput
                  value={companyForm.email}
                  onChange={(email) => setCompanyForm((f) => ({ ...f, email }))}
                  optional
                  onValidationChange={(result) => {
                    setCompanyEmailBlocking(result.isBlocking);
                  }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input
                value={companyForm.address}
                onChange={(e) => setCompanyForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={companyForm.notes}
                onChange={(e) => setCompanyForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <div className="flex gap-2 w-full justify-end">
              <Button variant="outline" onClick={() => setCompanyDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                className="bg-amber-600 hover:bg-amber-700 text-white"
                disabled={!companyForm.name.trim() || companyEmailBlocking || saveCompanyMutation.isPending}
                onClick={() => saveCompanyMutation.mutate()}
              >
                {saveCompanyMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
