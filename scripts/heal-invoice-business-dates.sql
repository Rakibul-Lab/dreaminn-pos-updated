-- =============================================================================
-- Fix historical invoice business_date to match checkout date
-- Run this in phpMyAdmin or MySQL client on production if invoices were
-- previously viewed/regenerated and had their business_date overwritten.
-- =============================================================================

UPDATE invoices i
JOIN bookings b ON b.id = i.bookingId
SET i.business_date = DATE_FORMAT(b.actualCheckOut, '%Y-%m-%d')
WHERE b.status = 'CHECKED_OUT'
  AND b.actualCheckOut IS NOT NULL
  AND (i.business_date IS NULL OR i.business_date <> DATE_FORMAT(b.actualCheckOut, '%Y-%m-%d'));
