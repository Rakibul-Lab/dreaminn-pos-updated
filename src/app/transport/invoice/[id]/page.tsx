import { TransportInvoicePrintView } from '@/components/erp/hotel/TransportInvoicePrintView'

export default async function TransportInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ print?: string }>
}) {
  const { id } = await params
  const { print } = await searchParams
  const autoPrint = print === '1'

  return (
    <main className="min-h-screen bg-muted/30 py-6 print:bg-white print:py-0">
      <TransportInvoicePrintView saleId={id} autoPrint={autoPrint} />
    </main>
  )
}
