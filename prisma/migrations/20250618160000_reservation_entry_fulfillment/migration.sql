-- AlterEnum: extend reservation entry lifecycle
ALTER TABLE `reservation_entries` MODIFY `status` ENUM('ACTIVE', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE';

-- AlterTable: reservation entry fulfillment timestamp
ALTER TABLE `reservation_entries` ADD COLUMN `fulfilled_at` DATETIME(3) NULL;

-- AlterTable: booking source link
ALTER TABLE `bookings` ADD COLUMN `source_reservation_entry_id` VARCHAR(191) NULL;
CREATE INDEX `bookings_source_reservation_entry_id_fkey` ON `bookings`(`source_reservation_entry_id`);
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_source_reservation_entry_id_fkey` FOREIGN KEY (`source_reservation_entry_id`) REFERENCES `reservation_entries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: line-to-booking fulfillment join
CREATE TABLE `reservation_entry_line_bookings` (
    `id` VARCHAR(191) NOT NULL,
    `reservation_entry_line_id` VARCHAR(191) NOT NULL,
    `booking_id` VARCHAR(191) NOT NULL,
    `room_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `reservation_entry_line_bookings_booking_id_key`(`booking_id`),
    INDEX `reservation_entry_line_bookings_line_id_fkey`(`reservation_entry_line_id`),
    INDEX `reservation_entry_line_bookings_room_id_fkey`(`room_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `reservation_entry_line_bookings` ADD CONSTRAINT `reservation_entry_line_bookings_line_id_fkey` FOREIGN KEY (`reservation_entry_line_id`) REFERENCES `reservation_entry_lines`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `reservation_entry_line_bookings` ADD CONSTRAINT `reservation_entry_line_bookings_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `reservation_entry_line_bookings` ADD CONSTRAINT `reservation_entry_line_bookings_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
