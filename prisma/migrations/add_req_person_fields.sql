-- Add req_person fields to reservation_entries and bookings (safe additive migration)
ALTER TABLE `reservation_entries`
  ADD COLUMN `req_person_name` VARCHAR(191) NULL,
  ADD COLUMN `req_person_phone` VARCHAR(191) NULL;

ALTER TABLE `bookings`
  ADD COLUMN `req_person_name` VARCHAR(191) NULL,
  ADD COLUMN `req_person_phone` VARCHAR(191) NULL;

