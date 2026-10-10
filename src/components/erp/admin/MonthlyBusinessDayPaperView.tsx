'use client'

import type { MonthlyBusinessDayReportData } from '@/lib/daily-sales-report'
import { HOTEL_NAME } from '@/lib/reservation-terms'

type MonthlyBusinessDayPaperViewProps = {
  data: MonthlyBusinessDayReportData
}

function formatAmount(val: number): string {
  if (!Number.isFinite(val) || val === 0) return '0'
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

export function MonthlyBusinessDayPaperView({ data }: MonthlyBusinessDayPaperViewProps) {
  const { days = [], totals } = data

  return (
    <div className="rounded-lg border bg-white p-6 text-black text-sm shadow-sm overflow-x-auto print:p-0 print:border-none">
      <div className="min-w-[760px] max-w-[900px] mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-1 pb-2 border-b">
          <h2 className="text-xl font-bold tracking-wide uppercase">{HOTEL_NAME}</h2>
          <h3 className="text-lg font-semibold text-neutral-800">Monthly Business Day Sales Report</h3>
          <p className="text-xs text-neutral-600 font-medium">
            Period: <span className="font-semibold text-black">{data.businessDateDisplay}</span>
          </p>
        </div>

        {/* Main Table */}
        <table className="w-full border-collapse text-xs border border-black font-sans">
          <thead>
            <tr className="bg-neutral-100 border-b border-black">
              <th className="border border-black px-2 py-1.5 text-center font-bold">Date</th>
              <th className="border border-black px-2 py-1.5 text-right font-bold">Cash</th>
              <th className="border border-black px-2 py-1.5 text-right font-bold">Card</th>
              <th className="border border-black px-2 py-1.5 text-right font-bold">Bank Payment</th>
              <th className="border border-black px-2 py-1.5 text-right font-bold">M.Finance</th>
              <th className="border border-black px-2 py-1.5 text-right font-bold">Due</th>
              <th className="border border-black px-2 py-1.5 text-right font-bold">Food Bill</th>
              <th className="border border-black px-2 py-1.5 text-right font-bold">Total</th>
            </tr>
          </thead>
          <tbody>
            {days.length > 0 ? (
              days.map((row) => (
                <tr key={row.businessDate} className="hover:bg-neutral-50 border-b border-black">
                  <td className="border border-black px-2 py-1 text-center font-medium font-mono">{row.formattedDate}</td>
                  <td className="border border-black px-2 py-1 text-right">{formatAmount(row.cash)}</td>
                  <td className="border border-black px-2 py-1 text-right">{formatAmount(row.card)}</td>
                  <td className="border border-black px-2 py-1 text-right">{formatAmount(row.bankPayment)}</td>
                  <td className="border border-black px-2 py-1 text-right">{formatAmount(row.mFinance)}</td>
                  <td className="border border-black px-2 py-1 text-right">{formatAmount(row.due)}</td>
                  <td className="border border-black px-2 py-1 text-right">{formatAmount(row.foodBill)}</td>
                  <td className="border border-black px-2 py-1 text-right font-semibold">{formatAmount(row.total)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="border border-black px-2 py-6 text-center text-neutral-500">
                  No sales recorded for this period
                </td>
              </tr>
            )}

            {/* Column Totals Row */}
            <tr className="bg-neutral-100 font-bold border-t-2 border-black">
              <td className="border border-black px-2 py-1.5 text-left font-bold">Total=</td>
              <td className="border border-black px-2 py-1.5 text-right font-bold">{formatAmount(totals?.cash ?? 0)}</td>
              <td className="border border-black px-2 py-1.5 text-right font-bold">{formatAmount(totals?.card ?? 0)}</td>
              <td className="border border-black px-2 py-1.5 text-right font-bold">{formatAmount(totals?.bankPayment ?? 0)}</td>
              <td className="border border-black px-2 py-1.5 text-right font-bold">{formatAmount(totals?.mFinance ?? 0)}</td>
              <td className="border border-black px-2 py-1.5 text-right font-bold">{formatAmount(totals?.due ?? 0)}</td>
              <td className="border border-black px-2 py-1.5 text-right font-bold">{formatAmount(totals?.foodBill ?? 0)}</td>
              <td className="border border-black px-2 py-1.5 text-right font-bold underline decoration-double">{formatAmount(totals?.totalSales ?? 0)}</td>
            </tr>
          </tbody>
        </table>

        {/* Bottom Right Summary Section (Matching uploaded document format) */}
        <div className="flex justify-end pt-4">
          <div className="w-64 space-y-1.5 text-sm font-sans">
            <div className="flex justify-between items-center py-0.5">
              <span className="font-semibold text-neutral-800">Total Sales</span>
              <span className="font-bold text-black font-mono">{formatAmount(totals?.totalSales ?? 0)}</span>
            </div>
            <div className="flex justify-between items-center py-0.5">
              <span className="font-semibold text-neutral-800">Company Due</span>
              <span className="font-bold text-black font-mono">{formatAmount(totals?.companyDue ?? 0)}</span>
            </div>
            <div className="flex justify-between items-center pt-1.5 border-t border-black">
              <span className="font-bold text-lg text-black">=</span>
              <span className="font-bold text-lg text-black underline decoration-double font-mono">{formatAmount(totals?.netSales ?? 0)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
