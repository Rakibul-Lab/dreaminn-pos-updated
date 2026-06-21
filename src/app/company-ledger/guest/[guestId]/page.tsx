'use client';

import { useParams } from 'next/navigation';
import { CompanyLedgerGuestHistoryView } from '@/components/erp/hotel/CompanyLedgerGuestHistoryView';
import { AppDevelopedByFooter } from '@/components/AppDevelopedByFooter';
import { useRequireLedgerAccess } from '@/hooks/use-require-ledger-access';
import { Skeleton } from '@/components/ui/skeleton';

export default function CompanyLedgerGuestHistoryPage() {
  const params = useParams<{ guestId: string }>();
  const guestId = params?.guestId;
  const { hydrated, allowed } = useRequireLedgerAccess();

  if (!guestId) {
    return <div className="p-8 text-red-600">Invalid guest link.</div>;
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
        <CompanyLedgerGuestHistoryView guestId={guestId} />
      </main>
      <AppDevelopedByFooter printHidden />
    </div>
  );
}
