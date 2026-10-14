-- =============================================================================
-- Rooms 1002 / 1005 / 1006 — fold Half Board food (SA-56920, ৳400) into room rent
-- Goal: invoice shows ৳3,700 as room rent only; no restaurant lines on invoice.
--
-- Current (each):
--   room 5,500 − discount 2,200 (=40%) = 3,300 room
--   + food SA-56920 400 (foodCharges 381 + rest. VAT 19) = TOTAL 3,700
-- After:
--   roomCharges 3,700 · food 0 · discount 0 · VAT 0 · total 3,700
--   invoice items: only one room_charge line at 3,700
--   restaurant orders cancelled so regenerate cannot pull food back
--   booking discount switched to FIXED 1,800 (5,500 − 1,800 = 3,700) for 1002
--
-- Safe to re-run (idempotent on these three invoice IDs).
-- Run on production MySQL. Take a backup / start a transaction first.
-- =============================================================================

START TRANSACTION;

-- Preview before (optional — run alone if you want to inspect first)
-- SELECT r.roomNumber, b.id AS booking_id, b.status, i.id AS invoice_id, i.invoiceNumber,
--        i.roomCharges, i.foodCharges, i.discount, i.vatAmount, i.totalAmount, i.paidAmount, i.dueAmount
-- FROM invoices i
-- JOIN bookings b ON b.id = i.bookingId
-- JOIN rooms r ON r.id = b.roomId
-- WHERE i.id IN (
--   'cmudg9nca00dgs0ft8zt8ubyw',  -- 1002 20260923-G5EP
--   'cmucmxtek00ass0ftbdr019ii',  -- 1005 20260922-QEZG
--   'cmucmrg6d00aes0ftzbh4wfkr'   -- 1006 20260922-PET5
-- );

-- -----------------------------------------------------------------------------
-- 1) Invoice headers → room-only ৳3,700 (paid/due unchanged)
-- -----------------------------------------------------------------------------
UPDATE invoices
SET
  roomCharges  = 3700,
  foodCharges  = 0,
  extraCharges = 0,
  subtotal     = 3700,
  discount     = 0,
  vatAmount    = 0,
  totalAmount  = 3700,
  -- paidAmount / dueAmount / status left as-is:
  --   1002: paid 0, due 3700, ISSUED
  --   1005: paid 3700, due 0, PAID
  --   1006: paid 3700, due 0, PAID
  updatedAt    = NOW(3)
WHERE id IN (
  'cmudg9nca00dgs0ft8zt8ubyw',  -- 1002 Mohammad Mosharrof Hossain
  'cmucmxtek00ass0ftbdr019ii',  -- 1005 Mozammel Haque Bhuiyan
  'cmucmrg6d00aes0ftzbh4wfkr'   -- 1006 Tahzib Ahmad
);

-- -----------------------------------------------------------------------------
-- 2) Remove restaurant + discount + restaurant-VAT lines from those invoices
-- -----------------------------------------------------------------------------
DELETE FROM invoice_items
WHERE invoiceId IN (
  'cmudg9nca00dgs0ft8zt8ubyw',
  'cmucmxtek00ass0ftbdr019ii',
  'cmucmrg6d00aes0ftzbh4wfkr'
)
AND itemType IN ('food_order', 'vat_restaurant', 'discount');

-- -----------------------------------------------------------------------------
-- 3) Room charge line → ৳3,700 (keep room / type / nights wording)
-- -----------------------------------------------------------------------------
UPDATE invoice_items
SET
  unitPrice = 3700,
  total     = 3700,
  quantity  = 1
WHERE invoiceId IN (
  'cmudg9nca00dgs0ft8zt8ubyw',
  'cmucmxtek00ass0ftbdr019ii',
  'cmucmrg6d00aes0ftzbh4wfkr'
)
AND itemType = 'room_charge';

-- -----------------------------------------------------------------------------
-- 4) Cancel Half Board package food orders (SA-56920) so they cannot reappear
--    on a future invoice regenerate for room 1002 (still checked in).
-- -----------------------------------------------------------------------------
UPDATE restaurant_orders
SET
  status    = 'CANCELLED',
  notes     = CONCAT(
                COALESCE(notes, ''),
                '\n[Cancelled] Included in room rent ৳3700 — removed from invoice ',
                DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i')
              ),
  updatedAt = NOW(3)
WHERE id IN (
  'cmucuw3eq00cjs0ft8z4n1ale',  -- 1002 RRP-CVR-20260922-0003
  'cmucuwzcq00cns0ftfq2kde5x',  -- 1005 RRP-CVR-20260922-0004
  'cmucuz8nz00crs0ft5af090tw'   -- 1006 RRP-CVR-20260922-0005
);

-- -----------------------------------------------------------------------------
-- 5) Booking discount: FIXED 1,800 so 5,500 − 1,800 = 3,700 room-only
--    (was PERCENTAGE 40% → 3,300 + food 400). Important for 1002 still in house.
-- -----------------------------------------------------------------------------
UPDATE bookings
SET
  discount_enabled = 1,
  discount_type    = 'FIXED',
  discount_value   = 1800,
  dueAmount        = CASE
                       WHEN id = 'cmucpd1l800bes0ftzfy55jcn' THEN 3700  -- 1002 still open
                       ELSE dueAmount                                  -- 1005/1006 already paid
                     END,
  updatedAt        = NOW(3)
WHERE id IN (
  'cmucpd1l800bes0ftzfy55jcn',  -- 1002
  'cmucmxiiq00aos0ftgc3cdtz2',  -- 1005
  'cmucmr0lx00aas0ft5y00goct'   -- 1006
);

-- -----------------------------------------------------------------------------
-- Verify
-- -----------------------------------------------------------------------------
SELECT
  r.roomNumber,
  c.name AS guest,
  b.status,
  i.invoiceNumber,
  i.roomCharges,
  i.foodCharges,
  i.discount,
  i.vatAmount,
  i.totalAmount,
  i.paidAmount,
  i.dueAmount,
  i.status AS invoice_status
FROM invoices i
JOIN bookings b ON b.id = i.bookingId
JOIN rooms r ON r.id = b.roomId
JOIN customers c ON c.id = b.customerId
WHERE i.id IN (
  'cmudg9nca00dgs0ft8zt8ubyw',
  'cmucmxtek00ass0ftbdr019ii',
  'cmucmrg6d00aes0ftzbh4wfkr'
)
ORDER BY r.roomNumber;

SELECT
  r.roomNumber,
  ii.itemType,
  ii.description,
  ii.quantity,
  ii.unitPrice,
  ii.total
FROM invoice_items ii
JOIN invoices i ON i.id = ii.invoiceId
JOIN bookings b ON b.id = i.bookingId
JOIN rooms r ON r.id = b.roomId
WHERE i.id IN (
  'cmudg9nca00dgs0ft8zt8ubyw',
  'cmucmxtek00ass0ftbdr019ii',
  'cmucmrg6d00aes0ftzbh4wfkr'
)
ORDER BY r.roomNumber, ii.itemType;

SELECT
  r.roomNumber,
  o.orderNumber,
  o.status,
  o.totalAmount,
  o.notes
FROM restaurant_orders o
LEFT JOIN rooms r ON r.id = o.roomId
WHERE o.id IN (
  'cmucuw3eq00cjs0ft8z4n1ale',
  'cmucuwzcq00cns0ftfq2kde5x',
  'cmucuz8nz00crs0ft5af090tw'
);

-- If the three SELECTs look right:
COMMIT;
-- If anything is wrong:
-- ROLLBACK;
