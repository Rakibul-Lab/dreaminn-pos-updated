-- Fix stay duration and recalculate nights for registration 202607140002 (Booking cmrkis88q00bas0la2h7vzen3)
-- Stay period: 14-Jul-2026 to 04-Oct-2026 = 82 nights (previously miscalculated as 92 nights)
-- Nightly rate: 3,500 BDT -> Room charges: 82 * 3,500 = 287,000 BDT (100% discount: 287,000 BDT)

-- 1. Synchronize booking check_out with actual check-out (04-Oct-2026) and update total room charge
UPDATE `bookings`
SET
  `checkOut` = '2026-10-04 06:00:00',
  `totalRoomCharge` = 287000,
  `dueAmount` = 0
WHERE `registration_number` = '202607140002' OR `id` = 'cmrkis88q00bas0la2h7vzen3';

-- 2. Update invoice totals
UPDATE `invoices`
SET
  `roomCharges` = 287000,
  `subtotal` = 287000,
  `discount` = 287000,
  `totalAmount` = 0,
  `dueAmount` = 0
WHERE `id` = 'cmsu865si000js0vgtgukhplm' OR `bookingId` = 'cmrkis88q00bas0la2h7vzen3';

-- 3. Update invoice line items (room charge nights and discount)
UPDATE `invoice_items`
SET
  `description` = 'Room 1009 (RRP Deluxe Single Room) – 82 nights',
  `quantity` = 82,
  `unitPrice` = 3500,
  `total` = 287000
WHERE `invoiceId` = 'cmsu865si000js0vgtgukhplm' AND `itemType` = 'room_charge';

UPDATE `invoice_items`
SET
  `unitPrice` = -287000,
  `total` = -287000
WHERE `invoiceId` = 'cmsu865si000js0vgtgukhplm' AND `itemType` = 'discount';

