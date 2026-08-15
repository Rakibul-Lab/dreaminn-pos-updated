-- Remove legacy appended notes from invoice rows created before room charge notes
-- were stored separately. The note itself is preserved on room_charges by the
-- preceding migration.
UPDATE `invoice_items`
SET `description` = 'Extra Charges'
WHERE `itemType` = 'extra_service'
  AND `description` LIKE 'Extra Charges — %';

UPDATE `invoice_items`
SET `description` = 'Others'
WHERE `itemType` = 'extra_service'
  AND `description` LIKE 'Others — %';

UPDATE `invoice_items`
SET `description` = 'Damage Charges'
WHERE `itemType` = 'extra_service'
  AND `description` LIKE 'Damage Charges — %';
