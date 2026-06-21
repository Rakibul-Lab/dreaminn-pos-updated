'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { DailySalesBalances } from '@/lib/daily-sales-balance'

type HotelSalesSlice = {
  roomSales?: number
  foodSales?: number
  beverageWalkInSales?: number
  beverageRoomSales?: number
  hotelSalesTotal?: number
  invoiceTotal?: number
  discount?: number
}

type RestaurantSalesSlice = {
  grossSales?: number
  discount?: number
}

type CollectionsSummary = {
  grossCollected?: number
  refunds?: number
  netCollected?: number
  depositTotal?: number
}

type CollectionsByMethod = { method: string; amount: number }

type GuestMovement = {
  actualCheckIns?: number
  expectedArrivals?: number
  totalListed?: number
  actualCheckOuts?: number
}

export type BusinessDaySummarySectionProps = {
  isLoading?: boolean
  salesBalances?: DailySalesBalances | null
  grandTotal?: number
  hotel?: HotelSalesSlice | null
  restaurant?: RestaurantSalesSlice | null
  collectionsSummary?: CollectionsSummary | null
  collectionsByMethod?: CollectionsByMethod[]
  guestMovement?: GuestMovement | null
  openingBalanceOverride?: number | null
  totalDiscount?: number
}

export function BusinessDaySummarySection({
  isLoading = false,
  salesBalances,
  grandTotal = 0,
  hotel,
  restaurant,
  collectionsSummary,
  collectionsByMethod = [],
  guestMovement,
  openingBalanceOverride,
  totalDiscount: totalDiscountProp,
}: BusinessDaySummarySectionProps) {
  const openingBalance =
    openingBalanceOverride !== undefined && openingBalanceOverride !== null
      ? openingBalanceOverride
      : (salesBalances?.openingBalance ?? 0)
  const closingBalance =
    openingBalanceOverride !== undefined && openingBalanceOverride !== null && salesBalances
      ? openingBalanceOverride +
        salesBalances.salesTotal -
        salesBalances.companyBillTotal
      : (salesBalances?.closingBalance ?? 0)
  const resolvedGrandTotal =
    openingBalanceOverride !== undefined && openingBalanceOverride !== null && salesBalances
      ? openingBalanceOverride + salesBalances.salesTotal
      : (salesBalances?.grandTotal ?? grandTotal)

  const hotelSalesTotal =
    hotel?.hotelSalesTotal ?? hotel?.invoiceTotal ?? 0

  const hotelDiscount = hotel?.discount ?? 0
  const restaurantDiscount = restaurant?.discount ?? 0
  const totalDiscount =
    totalDiscountProp !== undefined
      ? totalDiscountProp
      : hotelDiscount + restaurantDiscount

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Opening balance</p>
            {isLoading ? (
              <Skeleton className="h-7 w-24 mt-1" />
            ) : (
              <p className="text-xl font-bold text-amber-700">
                ৳{openingBalance.toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Grand total</p>
            {isLoading ? (
              <Skeleton className="h-7 w-24 mt-1" />
            ) : (
              <p className="text-xl font-bold text-sky-700">
                ৳{resolvedGrandTotal.toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Closing balance</p>
            {isLoading ? (
              <Skeleton className="h-7 w-24 mt-1" />
            ) : (
              <p className="text-xl font-bold text-rose-700">
                ৳{closingBalance.toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Hotel sales</p>
            {isLoading ? (
              <Skeleton className="h-7 w-24 mt-1" />
            ) : (
              <p className="text-xl font-bold text-amber-700">
                ৳{hotelSalesTotal.toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Restaurant</p>
            {isLoading ? (
              <Skeleton className="h-7 w-24 mt-1" />
            ) : (
              <p className="text-xl font-bold text-emerald-700">
                ৳{(restaurant?.grossSales ?? 0).toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total discount</p>
            {isLoading ? (
              <Skeleton className="h-7 w-24 mt-1" />
            ) : (
              <p className="text-xl font-bold text-red-600">
                ৳{totalDiscount.toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Net collected</p>
            {isLoading ? (
              <Skeleton className="h-7 w-24 mt-1" />
            ) : (
              <p className="text-xl font-bold text-purple-700">
                ৳{(collectionsSummary?.netCollected ?? 0).toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Check-ins</p>
            {isLoading ? (
              <Skeleton className="h-7 w-16 mt-1" />
            ) : (
              <>
                <p className="text-xl font-bold text-emerald-700">
                  {guestMovement?.actualCheckIns ?? 0}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Expected {guestMovement?.expectedArrivals ?? 0}
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Check-outs</p>
            {isLoading ? (
              <Skeleton className="h-7 w-16 mt-1" />
            ) : (
              <>
                <p className="text-xl font-bold text-sky-700">
                  {guestMovement?.actualCheckOuts ?? 0}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Listed {guestMovement?.totalListed ?? 0}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Sales</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span>Room sales</span>
                  <span>৳{(hotel?.roomSales ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Food</span>
                  <span>৳{(hotel?.foodSales ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Hotel beverage (walk-in)</span>
                  <span>৳{(hotel?.beverageWalkInSales ?? 0).toLocaleString()}</span>
                </div>
                {(hotel?.beverageRoomSales ?? 0) > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Beverage (room charge)</span>
                    <span>৳{(hotel?.beverageRoomSales ?? 0).toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between font-medium">
                  <span>Hotel sales total</span>
                  <span>৳{hotelSalesTotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Restaurant POS</span>
                  <span>৳{(restaurant?.grossSales ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-red-600">
                  <span>Hotel discount</span>
                  <span>৳{hotelDiscount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-red-600">
                  <span>Restaurant discount</span>
                  <span>৳{restaurantDiscount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-medium text-red-600">
                  <span>Total discount</span>
                  <span>৳{totalDiscount.toLocaleString()}</span>
                </div>
                <hr className="my-2" />
                <div className="flex justify-between font-semibold">
                  <span>Today&apos;s sales</span>
                  <span>৳{(salesBalances?.salesTotal ?? 0).toLocaleString()}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Collections</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span>Gross</span>
                  <span>৳{(collectionsSummary?.grossCollected ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Refunds</span>
                  <span>৳{(collectionsSummary?.refunds ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Deposits</span>
                  <span>৳{(collectionsSummary?.depositTotal ?? 0).toLocaleString()}</span>
                </div>
                <hr className="my-2" />
                <div className="flex justify-between font-semibold">
                  <span>Net collected</span>
                  <span>৳{(collectionsSummary?.netCollected ?? 0).toLocaleString()}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Guest movement</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span>Actual check-ins</span>
                  <span>{guestMovement?.actualCheckIns ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>Expected arrivals</span>
                  <span>{guestMovement?.expectedArrivals ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>Arrivals listed</span>
                  <span>{guestMovement?.totalListed ?? 0}</span>
                </div>
                <hr className="my-2" />
                <div className="flex justify-between font-semibold">
                  <span>Actual check-outs</span>
                  <span>{guestMovement?.actualCheckOuts ?? 0}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {collectionsByMethod.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Collections by payment method</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-48 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {collectionsByMethod.map((row, i) => (
                    <TableRow key={`${row.method}-${i}`}>
                      <TableCell>{row.method}</TableCell>
                      <TableCell className="text-right">
                        ৳{row.amount.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
