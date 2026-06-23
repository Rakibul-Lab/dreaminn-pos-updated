import { BookingPaymentThermalReceiptView } from '@/components/erp/hotel/BookingPaymentThermalReceiptView';

export default async function BookingPaymentReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const { id } = await params;
  const { print } = await searchParams;
  const autoPrint = print === '1';

  return (
    <main className="min-h-screen bg-muted/30 py-6 print:bg-white print:py-0">
      <BookingPaymentThermalReceiptView paymentId={id} autoPrint={autoPrint} />
    </main>
  );
}
