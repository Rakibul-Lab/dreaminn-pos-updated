'use client'

import {
  PAPER_SALES_HEADERS,
  buildPaperSalesLines,
  buildPaperSummary,
  computePaperTotals,
  formatPaperAmount,
  formatPaperAmountAlways,
  formatPaperDate,
  paperLineToRow,
  paperTotalsToRow,
  type PaperSalesInput,
} from '@/lib/daily-sales-paper-format'
import { HOTEL_NAME } from '@/lib/reservation-terms'

type DailySalesPaperViewProps = {
  data: PaperSalesInput & {
    businessDate: string
    businessDateDisplay?: string
    cashReconciliation?: PaperSalesInput['cashReconciliation']
    headOfficeRemittances?: Array<{
      id: string
      amount: number
      method: string
      reference?: string | null
      notes?: string | null
      sentBy?: string
      at: string
    }>
    billBreakdown?: PaperSalesInput['billBreakdown']
  }
}

export function DailySalesPaperView({ data }: DailySalesPaperViewProps) {
  const paperLines = buildPaperSalesLines(data.lines)
  const totals = computePaperTotals(paperLines)
  const summary = buildPaperSummary(data)
  const dateLabel = formatPaperDate(data.businessDate, data.businessDateDisplay)

  return (
    <div className="rounded-lg border bg-white text-sm text-black overflow-x-auto">
      <div className="p-4 min-w-[900px]">
        <div className="flex items-start justify-between gap-4 mb-3">
          <p className="font-semibold">Date: {dateLabel}</p>
          <div className="flex-1 text-center">
            <p className="text-xs text-muted-foreground">{HOTEL_NAME}</p>
            <p className="text-lg font-bold">Daily Sales Report</p>
          </div>
          <div className="w-40" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_220px] gap-4">
          <div>
            <table className="w-full border-collapse text-xs mb-2">
              <tbody>
                <tr className="border border-black">
                  <td colSpan={8} className="border border-black px-2 py-1 font-semibold">
                    Opening Balance(Cash)
                  </td>
                  <td className="border border-black px-2 py-1 text-right font-semibold">
                    {formatPaperAmountAlways(summary.openingBalance)}
                  </td>
                </tr>
              </tbody>
            </table>

            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-neutral-200">
                  {PAPER_SALES_HEADERS.map((header) => (
                    <th key={header} className="border border-black px-1 py-1 text-center font-semibold">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paperLines.length ? (
                  paperLines.map((line, index) => {
                    const row = paperLineToRow(line)
                    return (
                      <tr key={index}>
                        {row.map((cell, cellIndex) => (
                          <td
                            key={cellIndex}
                            className={`border border-black px-1 py-1 ${
                              cellIndex >= 2 ? 'text-right' : 'text-center'
                            }`}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={9} className="border border-black px-2 py-4 text-center text-muted-foreground">
                      No sales recorded for this business day
                    </td>
                  </tr>
                )}
                <tr className="font-semibold">
                  {paperTotalsToRow(totals, summary.totalSale).map((cell, index) => (
                    <td
                      key={index}
                      className={`border border-black px-1 py-1 ${
                        index === 6
                          ? 'text-red-600 text-right'
                          : index === 8
                            ? 'text-blue-700 text-right'
                            : index >= 2
                              ? 'text-right'
                              : 'text-left'
                      }`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="space-y-4">
            <table className="w-full border-collapse text-xs">
              <tbody>
                <tr>
                  <td className="border border-black px-2 py-1">Opening balance</td>
                  <td className="border border-black px-2 py-1 text-right">
                    {formatPaperAmountAlways(summary.openingBalance)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1">Grand total</td>
                  <td className="border border-black px-2 py-1 text-right">
                    {formatPaperAmountAlways(summary.openingBalance + summary.totalSale)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={2} className="border border-black px-2 py-1 bg-neutral-100 font-semibold text-[11px]">
                    Bill breakdown
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1">Hotel bills (incl. beverage)</td>
                  <td className="border border-black px-2 py-1 text-right">
                    {formatPaperAmountAlways(summary.hotelBills)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1">Transport bills</td>
                  <td className="border border-black px-2 py-1 text-right">
                    {formatPaperAmountAlways(summary.transportBills)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1">Restaurant bills</td>
                  <td className="border border-black px-2 py-1 text-right">
                    {formatPaperAmountAlways(summary.restaurantBills)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1">Hotel discount</td>
                  <td className="border border-black px-2 py-1 text-right text-red-600">
                    {formatPaperAmountAlways(summary.hotelDiscount)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1">Restaurant discount</td>
                  <td className="border border-black px-2 py-1 text-right text-red-600">
                    {formatPaperAmountAlways(summary.restaurantDiscount)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1 font-semibold">Total discount</td>
                  <td className="border border-black px-2 py-1 text-right text-red-600 font-semibold">
                    {formatPaperAmountAlways(summary.totalDiscount)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1">Company bill total</td>
                  <td className="border border-black px-2 py-1 text-right text-red-600 font-semibold">
                    {formatPaperAmountAlways(summary.dueBill)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1 font-semibold">Closing balance</td>
                  <td className="border border-black px-2 py-1 text-right font-semibold">
                    {formatPaperAmountAlways(summary.closingBalance)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={2} className="border border-black px-2 py-1 bg-neutral-100 font-semibold text-[11px]">
                    Cash reconciliation (matches Head Office)
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1">Cash collected</td>
                  <td className="border border-black px-2 py-1 text-right">
                    {formatPaperAmountAlways(summary.cashCollectedToday)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1">Card collected</td>
                  <td className="border border-black px-2 py-1 text-right">
                    {formatPaperAmountAlways(summary.cardCollectedToday)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1">M. banking collected</td>
                  <td className="border border-black px-2 py-1 text-right">
                    {formatPaperAmountAlways(summary.mBankingCollectedToday)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1">Sent to head office (cash)</td>
                  <td className="border border-black px-2 py-1 text-right text-amber-700">
                    {formatPaperAmountAlways(summary.cashSentToHeadOffice)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1">Sent to head office (card)</td>
                  <td className="border border-black px-2 py-1 text-right text-amber-700">
                    {formatPaperAmountAlways(summary.cardSentToHeadOffice)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1">Sent to head office (m. banking)</td>
                  <td className="border border-black px-2 py-1 text-right text-amber-700">
                    {formatPaperAmountAlways(summary.mBankingSentToHeadOffice)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1 font-semibold">Cash on hand</td>
                  <td className="border border-black px-2 py-1 text-right font-semibold text-sky-700">
                    {formatPaperAmountAlways(summary.cashOnHand)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1 text-[11px] text-muted-foreground" colSpan={2}>
                    Opening cash + Cash column − cash sent to HO
                  </td>
                </tr>
              </tbody>
            </table>

            {data.headOfficeRemittances?.length ? (
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-neutral-100">
                    <th className="border border-black px-2 py-1 text-left">Sent to HO</th>
                    <th className="border border-black px-2 py-1 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.headOfficeRemittances.map((row) => (
                    <tr key={row.id}>
                      <td className="border border-black px-2 py-1">
                        <span className="block">{row.method}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {row.reference || row.notes || row.sentBy || '—'}
                        </span>
                      </td>
                      <td className="border border-black px-2 py-1 text-right">
                        {formatPaperAmountAlways(row.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            <table className="w-full border-collapse text-xs">
              <tbody>
                <tr>
                  <td className="border border-black px-2 py-1 font-semibold">Todays Check In Room</td>
                  <td className="border border-black px-2 py-1 text-right">{summary.checkIns} Room</td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1 font-semibold">Todays Check Out Room</td>
                  <td className="border border-black px-2 py-1 text-right">{summary.checkOuts} Room</td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1 font-semibold">Occupied Room</td>
                  <td className="border border-black px-2 py-1 text-right">{summary.occupiedRooms} Room</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
