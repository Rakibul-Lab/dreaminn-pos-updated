-- =============================================================================
-- Room 911 — Sahidun Nesa (CHECKED_IN)
-- Make invoice a 2-night bill (currently shows 1 night).
--
-- Current:
--   roomCharges 6,000 · discount 2,400 (40%) · total/due 3,600 · "1 night"
-- After:
--   roomCharges 12,000 · discount 4,800 (40%) · total/due 7,200 · "2 nights"
--   booking.totalRoomCharge 12,000 · dueAmount 7,200
--
-- IDs (local/prod should match if this is the live stay):
--   booking  cmufz1wah01c1s0ftrc27jxbg
--   invoice  cmufznzay01c6s0ft5e8mcm22  (20260925-VBCF)
--
-- Safe to re-run. Use START TRANSACTION → verify SELECTs → COMMIT.
-- =============================================================================

START TRANSACTION;

-- Preview (optional)
SELECT
  r.roomNumber,
  c.name AS guest,
  b.status,
  b.checkIn,
  b.checkOut,
  b.totalRoomCharge,
  b.dueAmount,
  b.discount_enabled,
  b.discount_type,
  b.discount_value,
  i.id AS invoice_id,
  i.invoiceNumber,
  i.roomCharges,
  i.discount,
  i.totalAmount,
  i.paidAmount,
  i.dueAmount AS invoice_due
FROM bookings b
JOIN rooms r ON r.id = b.roomId
JOIN customers c ON c.id = b.customerId
LEFT JOIN invoices i ON i.bookingId = b.id AND i.status <> 'CANCELLED'
WHERE b.id = 'cmufz1wah01c1s0ftrc27jxbg';

-- -----------------------------------------------------------------------------
-- 1) Booking → 2 nights at rack ৳6,000 = ৳12,000; due after 40% = ৳7,200
-- -----------------------------------------------------------------------------
UPDATE bookings
SET
  totalRoomCharge = 12000,
  dueAmount       = 7200,
  updatedAt       = NOW(3)
WHERE id = 'cmufz1wah01c1s0ftrc27jxbg';

-- -----------------------------------------------------------------------------
-- 2) Invoice header → 2-night totals
-- -----------------------------------------------------------------------------
UPDATE invoices
SET
  roomCharges  = 12000,
  foodCharges  = 0,
  extraCharges = 0,
  subtotal     = 12000,
  discount     = 4800,
  vatAmount    = 0,
  totalAmount  = 7200,
  paidAmount   = 0,
  dueAmount    = 7200,
  status       = 'ISSUED',
  updatedAt    = NOW(3)
WHERE id = 'cmufznzay01c6s0ft5e8mcm22';

-- -----------------------------------------------------------------------------
-- 3) Room charge line → 2 nights × ৳6,000
-- -----------------------------------------------------------------------------
UPDATE invoice_items
SET
  description = 'Room 911 (RRP Executive Room) – 2 nights',
  quantity    = 2,
  unitPrice   = 6000,
  total       = 12000
WHERE invoiceId = 'cmufznzay01c6s0ft5e8mcm22'
  AND itemType = 'room_charge';

-- -----------------------------------------------------------------------------
-- 4) Discount line → 40% of 12,000 = ৳4,800
-- -----------------------------------------------------------------------------
UPDATE invoice_items
SET
  unitPrice = -4800,
  total     = -4800,
  quantity  = 1
WHERE invoiceId = 'cmufznzay01c6s0ft5e8mcm22'
  AND itemType = 'discount';

-- If a discount line is missing (unlikely), insert one:
INSERT INTO invoice_items (id, invoiceId, itemType, referenceId, description, quantity, unitPrice, total)
SELECT
  REPLACE(UUID(), '-', ''),
  'cmufznzay01c6s0ft5e8mcm22',
  'discount',
  NULL,
  'Hotel discount',
  1,
  -4800,
  -4800
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM invoice_items
  WHERE invoiceId = 'cmufznzay01c6s0ft5e8mcm22'
    AND itemType = 'discount'
);

-- -----------------------------------------------------------------------------
-- Verify
-- -----------------------------------------------------------------------------
SELECT
  r.roomNumber,
  c.name AS guest,
  b.totalRoomCharge,
  b.dueAmount AS booking_due,
  i.invoiceNumber,
  i.roomCharges,
  i.discount,
  i.totalAmount,
  i.paidAmount,
  i.dueAmount AS invoice_due,
  i.status
FROM invoices i
JOIN bookings b ON b.id = i.bookingId
JOIN rooms r ON r.id = b.roomId
JOIN customers c ON c.id = b.customerId
WHERE i.id = 'cmufznzay01c6s0ft5e8mcm22';

SELECT
  itemType,
  description,
  quantity,
  unitPrice,
  total
FROM invoice_items
WHERE invoiceId = 'cmufznzay01c6s0ft5e8mcm22'
ORDER BY itemType;

-- If looks right:
COMMIT;
-- If wrong:
-- ROLLBACK;
