-- Remove orphan bookings created without a room assignment (breaks Prisma non-null roomId).
DELETE FROM `bookings` WHERE `roomId` IS NULL;

-- Restore NOT NULL to match application schema.
ALTER TABLE `bookings` MODIFY `roomId` VARCHAR(191) NOT NULL;
