-- One-time fix for checked-in rooms 903 and 915 (DreamInn production)
-- Run in phpMyAdmin / MySQL on the LIVE database after backup.
-- Safe guards: only updates CHECKED_IN rows that still have the old 1-night checkout/charge.

-- 1) Preview (run first)
SELECT
  b.id,
  b.registration_number,
  r.roomNumber,
  b.status,
  b.checkIn,
  b.checkOut,
  b.totalRoomCharge,
  b.dueAmount,
  b.discount_type,
  b.discount_value,
  b.notes
FROM bookings b
JOIN rooms r ON r.id = b.roomId
WHERE r.roomNumber IN ('903', '915')
  AND b.status = 'CHECKED_IN'
ORDER BY r.roomNumber;

START TRANSACTION;

-- 2) Room 903 — +1 night (15 Sep checkout → 16 Sep), charge 5500 → 11000, due → 3500
UPDATE bookings b
JOIN rooms r ON r.id = b.roomId
SET
  b.checkOut = DATE_ADD(b.checkOut, INTERVAL 1 DAY),
  b.totalRoomCharge = 11000,
  b.dueAmount = 3500,
  b.notes = CASE
    WHEN b.notes IS NULL OR b.notes = '' THEN
      'Auto next-day bill (+1 night) on business day close 2026-09-15.'
    WHEN b.notes LIKE '%Auto next-day bill (+1 night)%' THEN b.notes
    ELSE CONCAT(b.notes, '\nAuto next-day bill (+1 night) on business day close 2026-09-15.')
  END,
  b.updatedAt = NOW()
WHERE r.roomNumber = '903'
  AND b.status = 'CHECKED_IN'
  AND b.registration_number = '202609140001'
  AND b.totalRoomCharge <= 5500.01
  AND DATE(CONVERT_TZ(b.checkOut, '+00:00', '+06:00')) <= '2026-09-15';

-- 3) Room 915 — +1 night (16 Sep → 17 Sep), charge 3500 → 7000,
--    discount PERCENTAGE 1000 → FIXED 1000, due → 2500
UPDATE bookings b
JOIN rooms r ON r.id = b.roomId
SET
  b.checkOut = DATE_ADD(b.checkOut, INTERVAL 1 DAY),
  b.totalRoomCharge = 7000,
  b.discount_type = 'FIXED',
  b.dueAmount = 2500,
  b.notes = CASE
    WHEN b.notes IS NULL OR b.notes = '' THEN
      'Auto next-day bill (+1 night) on business day close 2026-09-16.'
    WHEN b.notes LIKE '%Auto next-day bill (+1 night)%' THEN b.notes
    ELSE CONCAT(b.notes, '\nAuto next-day bill (+1 night) on business day close 2026-09-16.')
  END,
  b.updatedAt = NOW()
WHERE r.roomNumber = '915'
  AND b.status = 'CHECKED_IN'
  AND b.registration_number = '202609130005'
  AND b.totalRoomCharge <= 3500.01
  AND DATE(CONVERT_TZ(b.checkOut, '+00:00', '+06:00')) <= '2026-09-16';

-- 4) Verify
SELECT
  b.registration_number,
  r.roomNumber,
  b.checkOut,
  b.totalRoomCharge,
  b.dueAmount,
  b.discount_type,
  b.discount_value
FROM bookings b
JOIN rooms r ON r.id = b.roomId
WHERE r.roomNumber IN ('903', '915')
  AND b.status = 'CHECKED_IN'
ORDER BY r.roomNumber;

-- If the verify rows look correct:
COMMIT;
-- If not:
-- ROLLBACK;
