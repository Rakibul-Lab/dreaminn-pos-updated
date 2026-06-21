-- CreateTable
CREATE TABLE `reservation_entries` (
    `id` VARCHAR(191) NOT NULL,
    `check_in` DATETIME(3) NOT NULL,
    `check_out` DATETIME(3) NOT NULL,
    `notes` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `reservation_entries_created_by_fkey`(`created_by`),
    INDEX `reservation_entries_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reservation_entry_lines` (
    `id` VARCHAR(191) NOT NULL,
    `reservation_entry_id` VARCHAR(191) NOT NULL,
    `room_type_id` VARCHAR(191) NOT NULL,
    `room_id` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,

    INDEX `reservation_entry_lines_reservation_entry_id_fkey`(`reservation_entry_id`),
    INDEX `reservation_entry_lines_room_type_id_fkey`(`room_type_id`),
    INDEX `reservation_entry_lines_room_id_fkey`(`room_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `reservation_entries` ADD CONSTRAINT `reservation_entries_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reservation_entry_lines` ADD CONSTRAINT `reservation_entry_lines_reservation_entry_id_fkey` FOREIGN KEY (`reservation_entry_id`) REFERENCES `reservation_entries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reservation_entry_lines` ADD CONSTRAINT `reservation_entry_lines_room_type_id_fkey` FOREIGN KEY (`room_type_id`) REFERENCES `room_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reservation_entry_lines` ADD CONSTRAINT `reservation_entry_lines_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
