-- Add ID fields to reservation_entries (safe additive migration)
ALTER TABLE `reservation_entries`
  ADD COLUMN `guest_nationality` VARCHAR(191) NULL,
  ADD COLUMN `guest_id_type` VARCHAR(191) NULL,
  ADD COLUMN `guest_id_number` VARCHAR(191) NULL,
  ADD COLUMN `nid_physically_received` BOOLEAN NOT NULL DEFAULT false;
