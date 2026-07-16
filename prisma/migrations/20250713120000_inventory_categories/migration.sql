-- Inventory categories for managed product grouping

CREATE TABLE `inventory_categories` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `inventory_categories_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `inventory_items` ADD COLUMN `category_id` VARCHAR(191) NULL;

CREATE INDEX `inventory_items_category_id_fkey` ON `inventory_items`(`category_id`);

ALTER TABLE `inventory_items`
  ADD CONSTRAINT `inventory_items_category_id_fkey`
  FOREIGN KEY (`category_id`) REFERENCES `inventory_categories`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed categories from existing free-text item categories
INSERT INTO `inventory_categories` (`id`, `name`, `description`, `active`, `sort_order`, `created_at`, `updated_at`)
SELECT
  REPLACE(UUID(), '-', ''),
  TRIM(category),
  NULL,
  true,
  0,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `inventory_items`
WHERE category IS NOT NULL AND TRIM(category) <> ''
GROUP BY TRIM(category);

UPDATE `inventory_items` i
INNER JOIN `inventory_categories` c ON c.name = TRIM(i.category)
SET i.category_id = c.id
WHERE i.category IS NOT NULL AND TRIM(i.category) <> '';
