'use client';

import { useParams } from 'next/navigation';
import { CompanyLedgerCompanyView } from '@/components/erp/hotel/CompanyLedgerCompanyView';
import { AppDevelopedByFooter } from '@/components/AppDevelopedByFooter';
import { useRequireLedgerAccess } from '@/hooks/use-require-ledger-access';
import { Skeleton } from '@/components/ui/skeleton';

export default function CompanyLedgerCompanyPage() {
  const params = useParams<{ companyId: string }>();
  const companyId = params?.companyId;
  const { hydrated, allowed } = useRequireLedgerAccess();

  if (!companyId) {
    return <div className="p-8 text-red-600">Invalid company link.</div>;
  }

  if (!hydrated) {
    return (
      <div className="min-h-screen bg-background p-8 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!allowed) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-6">
        <CompanyLedgerCompanyView companyId={companyId} />
      </main>
      <AppDevelopedByFooter printHidden />
    </div>
  );
}
