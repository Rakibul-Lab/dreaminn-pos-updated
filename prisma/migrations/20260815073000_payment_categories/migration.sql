-- User-defined payment types, offered alongside the built-in ones when recording a payment.
CREATE TABLE `payment_categories` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `created_by` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `payment_categories_name_key`(`name`),
  INDEX `payment_categories_created_by_fkey`(`created_by`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payment_categories`
  ADD CONSTRAINT `payment_categories_created_by_fkey`
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Keeps the custom type name on the payment so the list still reads correctly
-- even if the category is renamed or removed later.
ALTER TABLE `payments` ADD COLUMN `category_label` VARCHAR(191) NULL;
