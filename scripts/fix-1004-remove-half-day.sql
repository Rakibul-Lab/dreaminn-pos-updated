-- =============================================================================
-- Room 1004 — Mostafa Jahan Palash (CHECKED_IN)
-- Remove ৳2,000 Half Day Charge (early check-in) so due becomes 0.
--
-- Current invoice 20260925-JS7Q:
--   room 8,000 − discount 8,000 (100%)
--   + food ~810 (paid by CARD 810)
--   + Half Day Charge 2,000  ← REMOVE
--   total 2,810 · paid 810 · due 2,000
-- After:
--   extraCharges 0 · total 810 · paid 810 · due 0 · status PAID
--   booking.dueAmount 0
--   room_charges row for Half Day Charge deleted
--
-- IDs:
--   booking       cmug54ywu01cks0ftd8gsuqfp
--   invoice       cmug58bpc01crs0ftpw8qg5r4
--   invoice item  cmuhus4ni01vfs0ftqvbhr0cz  (Half Day Charge)
--   room charge   cmugvqke101igs0ftz7rwa3al  (Half Day Charge)
--
-- Use START TRANSACTION → verify SELECTs → COMMIT.
-- =============================================================================

START TRANSACTION;

-- Preview
SELECT
  r.roomNumber,
  c.name AS guest,
  b.status,
  b.dueAmount AS booking_due,
  i.invoiceNumber,
  i.roomCharges,
  i.foodCharges,
  i.extraCharges,
  i.discount,
  i.vatAmount,
  i.totalAmount,
  i.paidAmount,
  i.dueAmount AS invoice_due,
  i.status AS invoice_status
FROM bookings b
JOIN rooms r ON r.id = b.roomId
JOIN customers c ON c.id = b.customerId
JOIN invoices i ON i.bookingId = b.id AND i.status <> 'CANCELLED'
WHERE b.id = 'cmug54ywu01cks0ftd8gsuqfp';

-- -----------------------------------------------------------------------------
-- 1) Delete Half Day Charge from invoice lines
-- -----------------------------------------------------------------------------
DELETE FROM invoice_items
WHERE id = 'cmuhus4ni01vfs0ftqvbhr0cz'
   OR (
     invoiceId = 'cmug58bpc01crs0ftpw8qg5r4'
     AND itemType = 'extra_service'
     AND description LIKE '%Half Day%'
   );

-- -----------------------------------------------------------------------------
-- 2) Delete Half Day Charge from room_charges (so it cannot regenerate)
-- -----------------------------------------------------------------------------
DELETE FROM room_charges
WHERE id = 'cmugvqke101igs0ftz7rwa3al'
   OR (
     bookingId = 'cmug54ywu01cks0ftd8gsuqfp'
     AND description LIKE '%Half Day%'
   );

-- -----------------------------------------------------------------------------
-- 3) Invoice header — drop ৳2,000 extra; paid 810 covers food only
-- -----------------------------------------------------------------------------
UPDATE invoices
SET
  roomCharges  = 8000,
  foodCharges  = 771,
  extraCharges = 0,
  subtotal     = 8771,
  discount     = 8000,
  vatAmount    = 39,
  totalAmount  = 810,
  paidAmount   = 810,
  dueAmount    = 0,
  status       = 'PAID',
  paidAt       = COALESCE(paidAt, NOW(3)),
  updatedAt    = NOW(3)
WHERE id = 'cmug58bpc01crs0ftpw8qg5r4';

-- -----------------------------------------------------------------------------
-- 4) Booking due → 0
-- -----------------------------------------------------------------------------
UPDATE bookings
SET
  dueAmount = 0,
  updatedAt = NOW(3)
WHERE id = 'cmug54ywu01cks0ftd8gsuqfp';

-- -----------------------------------------------------------------------------
-- Verify
-- -----------------------------------------------------------------------------
SELECT
  r.roomNumber,
  c.name AS guest,
  b.dueAmount AS booking_due,
  i.invoiceNumber,
  i.roomCharges,
  i.foodCharges,
  i.extraCharges,
  i.discount,
  i.vatAmount,
  i.totalAmount,
  i.paidAmount,
  i.dueAmount AS invoice_due,
  i.status
FROM invoices i
JOIN bookings b ON b.id = i.bookingId
JOIN rooms r ON r.id = b.roomId
JOIN customers c ON c.id = b.customerId
WHERE i.id = 'cmug58bpc01crs0ftpw8qg5r4';

SELECT itemType, description, quantity, unitPrice, total
FROM invoice_items
WHERE invoiceId = 'cmug58bpc01crs0ftpw8qg5r4'
ORDER BY itemType, description;

SELECT id, chargeType, description, amount, notes
FROM room_charges
WHERE bookingId = 'cmug54ywu01cks0ftd8gsuqfp';

-- Expect: booking_due 0, invoice_due 0, totalAmount 810, paidAmount 810,
--         no Half Day Charge on invoice_items or room_charges.

COMMIT;
-- ROLLBACK;
