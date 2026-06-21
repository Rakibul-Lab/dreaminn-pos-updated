-- AlterTable
ALTER TABLE `reservation_entries`
  ADD COLUMN `guest_name` VARCHAR(191) NULL,
  ADD COLUMN `guest_phone` VARCHAR(191) NULL,
  ADD COLUMN `guest_email` VARCHAR(191) NULL,
  ADD COLUMN `guest_address` VARCHAR(191) NULL,
  ADD COLUMN `company` VARCHAR(191) NULL,
  ADD COLUMN `company_ledger_id` VARCHAR(191) NULL,
  ADD COLUMN `total_amount` DOUBLE NOT NULL DEFAULT 0,
  ADD COLUMN `advance_payment` DOUBLE NOT NULL DEFAULT 0,
  ADD COLUMN `due_amount` DOUBLE NOT NULL DEFAULT 0,
  ADD COLUMN `discount_enabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `discount_type` VARCHAR(191) NULL,
  ADD COLUMN `discount_value` DOUBLE NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `payments`
  ADD COLUMN `reservation_entry_id` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `company_ledger_bills`
  ADD COLUMN `reservation_entry_id` VARCHAR(191) NULL;

-- AlterEnum (MySQL: modify column enum)
ALTER TABLE `company_ledger_bills`
  MODIFY `bill_type` ENUM('BOOKING', 'RESTAURANT_ORDER', 'RESERVATION_ENTRY') NOT NULL DEFAULT 'BOOKING';

-- CreateIndex
CREATE UNIQUE INDEX `company_ledger_bills_reservation_entry_id_key` ON `company_ledger_bills`(`reservation_entry_id`);
CREATE INDEX `reservation_entries_company_ledger_id_fkey` ON `reservation_entries`(`company_ledger_id`);
CREATE INDEX `payments_reservation_entry_id_fkey` ON `payments`(`reservation_entry_id`);

-- AddForeignKey
ALTER TABLE `reservation_entries` ADD CONSTRAINT `reservation_entries_company_ledger_id_fkey` FOREIGN KEY (`company_ledger_id`) REFERENCES `company_ledgers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `payments` ADD CONSTRAINT `payments_reservation_entry_id_fkey` FOREIGN KEY (`reservation_entry_id`) REFERENCES `reservation_entries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `company_ledger_bills` ADD CONSTRAINT `company_ledger_bills_reservation_entry_id_fkey` FOREIGN KEY (`reservation_entry_id`) REFERENCES `reservation_entries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
