-- Keep the folio charge category and staff note separate so invoice rows remain concise.
ALTER TABLE `room_charges` ADD COLUMN `notes` TEXT NULL;

-- Normalize charges created before this column existed by the Send to Room action.
UPDATE `room_charges`
SET
  `notes` = SUBSTRING(`description`, CHAR_LENGTH('Extra Charges — ') + 1),
  `description` = 'Extra Charges'
WHERE `chargeType` = 'EXTRA_SERVICE'
  AND `description` LIKE 'Extra Charges — %';

UPDATE `room_charges`
SET
  `notes` = SUBSTRING(`description`, CHAR_LENGTH('Others — ') + 1),
  `description` = 'Others'
WHERE `chargeType` = 'OTHER'
  AND `description` LIKE 'Others — %';

UPDATE `room_charges`
SET
  `notes` = SUBSTRING(`description`, CHAR_LENGTH('Damage Charges — ') + 1),
  `description` = 'Damage Charges'
WHERE `chargeType` = 'DAMAGE'
  AND `description` LIKE 'Damage Charges — %';
