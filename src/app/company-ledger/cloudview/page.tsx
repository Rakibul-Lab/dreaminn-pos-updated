'use client';

import { CloudViewRestaurantLedgerView } from '@/components/erp/restaurant/CloudViewRestaurantLedgerView';
import { AppDevelopedByFooter } from '@/components/AppDevelopedByFooter';
import { Button } from '@/components/ui/button';
import { useRequireLedgerAccess } from '@/hooks/use-require-ledger-access';
import { Skeleton } from '@/components/ui/skeleton';

export default function CloudViewRestaurantLedgerPage() {
  const { hydrated, allowed } = useRequireLedgerAccess({ allowRestaurant: true });

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
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">
        <div className="mb-4 flex justify-end print:hidden">
          <Button variant="outline" size="sm" onClick={() => window.close()}>
            Close tab
          </Button>
        </div>
        <CloudViewRestaurantLedgerView />
      </main>
      <AppDevelopedByFooter printHidden />
    </div>
  );
}
