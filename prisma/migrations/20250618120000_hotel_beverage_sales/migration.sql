-- Hotel beverage sales (walk-in POS + room folio charges)

CREATE TABLE `hotel_beverage_sales` (
    `id` VARCHAR(191) NOT NULL,
    `sale_number` VARCHAR(191) NOT NULL,
    `sale_type` ENUM('WALK_IN', 'ROOM') NOT NULL,
    `booking_id` VARCHAR(191) NULL,
    `room_id` VARCHAR(191) NULL,
    `customer_name` VARCHAR(191) NULL,
    `customer_phone` VARCHAR(191) NULL,
    `subtotal` DOUBLE NOT NULL DEFAULT 0,
    `total_amount` DOUBLE NOT NULL DEFAULT 0,
    `payment_method` ENUM('NONE', 'CASH', 'CARD', 'BANK', 'MOBILE_BANKING', 'BKASH', 'NAGAD', 'UPAY') NULL,
    `notes` VARCHAR(191) NULL,
    `created_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `hotel_beverage_sales_sale_number_key`(`sale_number`),
    INDEX `hotel_beverage_sales_booking_id_fkey`(`booking_id`),
    INDEX `hotel_beverage_sales_room_id_fkey`(`room_id`),
    INDEX `hotel_beverage_sales_created_by_fkey`(`created_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hotel_beverage_sale_items` (
    `id` VARCHAR(191) NOT NULL,
    `sale_id` VARCHAR(191) NOT NULL,
    `menu_item_id` VARCHAR(191) NULL,
    `item_name` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `unit_price` DOUBLE NOT NULL,
    `line_total` DOUBLE NOT NULL,

    INDEX `hotel_beverage_sale_items_sale_id_fkey`(`sale_id`),
    INDEX `hotel_beverage_sale_items_menu_item_id_fkey`(`menu_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `room_charges` ADD COLUMN `hotel_beverage_sale_id` VARCHAR(191) NULL;
CREATE INDEX `room_charges_hotel_beverage_sale_id_fkey` ON `room_charges`(`hotel_beverage_sale_id`);

ALTER TABLE `hotel_beverage_sales` ADD CONSTRAINT `hotel_beverage_sales_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `hotel_beverage_sales` ADD CONSTRAINT `hotel_beverage_sales_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `hotel_beverage_sales` ADD CONSTRAINT `hotel_beverage_sales_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `hotel_beverage_sale_items` ADD CONSTRAINT `hotel_beverage_sale_items_sale_id_fkey` FOREIGN KEY (`sale_id`) REFERENCES `hotel_beverage_sales`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `hotel_beverage_sale_items` ADD CONSTRAINT `hotel_beverage_sale_items_menu_item_id_fkey` FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `room_charges` ADD CONSTRAINT `room_charges_hotel_beverage_sale_id_fkey` FOREIGN KEY (`hotel_beverage_sale_id`) REFERENCES `hotel_beverage_sales`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
