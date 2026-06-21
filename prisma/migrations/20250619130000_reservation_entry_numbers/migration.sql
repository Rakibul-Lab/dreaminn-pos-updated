-- AlterTable
ALTER TABLE `reservation_entries` ADD COLUMN `registration_number` VARCHAR(191) NULL,
    ADD COLUMN `confirmation_number` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `reservation_entries_registration_number_key` ON `reservation_entries`(`registration_number`);

-- CreateIndex
CREATE UNIQUE INDEX `reservation_entries_confirmation_number_key` ON `reservation_entries`(`confirmation_number`);
