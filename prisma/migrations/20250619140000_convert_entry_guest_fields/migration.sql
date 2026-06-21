-- Placeholder per-room guests from reservation entry convert may omit phone until check-in.
ALTER TABLE `customers` MODIFY `phone` VARCHAR(191) NULL;

-- Multiple bookings from one reservation entry share the entry confirmation number.
DROP INDEX `bookings_confirmation_number_key` ON `bookings`;
