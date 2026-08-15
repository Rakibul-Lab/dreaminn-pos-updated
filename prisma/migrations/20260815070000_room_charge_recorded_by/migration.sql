-- Marks folio charges posted from Payments → Send to Room so they can be listed
-- alongside payments with their own settlement status.
ALTER TABLE `room_charges` ADD COLUMN `recorded_by` VARCHAR(191) NULL;

CREATE INDEX `room_charges_recorded_by_fkey` ON `room_charges`(`recorded_by`);

ALTER TABLE `room_charges`
  ADD CONSTRAINT `room_charges_recorded_by_fkey`
  FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill charges posted before this column existed, using the activity log
-- entry written by the same request.
UPDATE `room_charges` rc
JOIN `activity_logs` al
  ON al.`action` = 'ROOM_CHARGE_CREATED'
 AND al.`userId` IS NOT NULL
 AND al.`details` LIKE CONCAT('%"roomChargeId":"', rc.`id`, '"%')
SET rc.`recorded_by` = al.`userId`
WHERE rc.`recorded_by` IS NULL;
