-- Transport services, sales, and standalone invoices

CREATE TABLE `transport_services` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `default_price` DOUBLE NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `transport_sales` (
    `id` VARCHAR(191) NOT NULL,
    `sale_number` VARCHAR(191) NOT NULL,
    `sale_type` ENUM('WALK_IN', 'ROOM') NOT NULL,
    `booking_id` VARCHAR(191) NULL,
    `room_id` VARCHAR(191) NULL,
    `customer_name` VARCHAR(191) NOT NULL,
    `customer_phone` VARCHAR(191) NULL,
    `route_from` VARCHAR(191) NULL,
    `route_to` VARCHAR(191) NULL,
    `trip_date` DATETIME(3) NULL,
    `subtotal` DOUBLE NOT NULL DEFAULT 0,
    `vat_amount` DOUBLE NOT NULL DEFAULT 0,
    `total_amount` DOUBLE NOT NULL DEFAULT 0,
    `payment_method` ENUM('CASH', 'CARD', 'MOBILE_BANKING', 'BKASH', 'NAGAD', 'UPAY', 'BANK', 'COMPANY_LEDGER') NULL,
    `notes` VARCHAR(191) NULL,
    `business_date` VARCHAR(191) NULL,
    `created_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `transport_sales_sale_number_key`(`sale_number`),
    INDEX `transport_sales_booking_id_fkey`(`booking_id`),
    INDEX `transport_sales_room_id_fkey`(`room_id`),
    INDEX `transport_sales_created_by_fkey`(`created_by`),
    INDEX `transport_sales_business_date_idx`(`business_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `transport_sale_items` (
    `id` VARCHAR(191) NOT NULL,
    `sale_id` VARCHAR(191) NOT NULL,
    `transport_service_id` VARCHAR(191) NULL,
    `service_name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `unit_price` DOUBLE NOT NULL,
    `line_total` DOUBLE NOT NULL,

    INDEX `transport_sale_items_sale_id_fkey`(`sale_id`),
    INDEX `transport_sale_items_transport_service_id_fkey`(`transport_service_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `transport_invoices` (
    `id` VARCHAR(191) NOT NULL,
    `invoice_number` VARCHAR(191) NOT NULL,
    `sale_id` VARCHAR(191) NOT NULL,
    `subtotal` DOUBLE NOT NULL DEFAULT 0,
    `vat_amount` DOUBLE NOT NULL DEFAULT 0,
    `discount` DOUBLE NOT NULL DEFAULT 0,
    `total_amount` DOUBLE NOT NULL DEFAULT 0,
    `paid_amount` DOUBLE NOT NULL DEFAULT 0,
    `due_amount` DOUBLE NOT NULL DEFAULT 0,
    `status` ENUM('ISSUED', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'ISSUED',
    `business_date` VARCHAR(191) NULL,
    `issued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `paid_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `transport_invoices_invoice_number_key`(`invoice_number`),
    UNIQUE INDEX `transport_invoices_sale_id_key`(`sale_id`),
    INDEX `transport_invoices_business_date_idx`(`business_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `room_charges` ADD COLUMN `transport_sale_id` VARCHAR(191) NULL;
CREATE INDEX `room_charges_transport_sale_id_fkey` ON `room_charges`(`transport_sale_id`);

ALTER TABLE `transport_sales` ADD CONSTRAINT `transport_sales_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `transport_sales` ADD CONSTRAINT `transport_sales_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `transport_sales` ADD CONSTRAINT `transport_sales_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `transport_sale_items` ADD CONSTRAINT `transport_sale_items_sale_id_fkey` FOREIGN KEY (`sale_id`) REFERENCES `transport_sales`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `transport_sale_items` ADD CONSTRAINT `transport_sale_items_transport_service_id_fkey` FOREIGN KEY (`transport_service_id`) REFERENCES `transport_services`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `transport_invoices` ADD CONSTRAINT `transport_invoices_sale_id_fkey` FOREIGN KEY (`sale_id`) REFERENCES `transport_sales`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `room_charges` ADD CONSTRAINT `room_charges_transport_sale_id_fkey` FOREIGN KEY (`transport_sale_id`) REFERENCES `transport_sales`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO `transport_services` (`id`, `name`, `description`, `default_price`, `is_active`, `sort_order`, `created_at`, `updated_at`) VALUES
('trn_svc_airport_pickup', 'Airport Pickup', 'Hotel to airport or airport to hotel', 1500, true, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
('trn_svc_airport_drop', 'Airport Drop-off', 'Drop-off service to airport', 1500, true, 2, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
('trn_svc_city_transfer', 'City Transfer', 'Point-to-point city transfer', 800, true, 3, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
('trn_svc_half_day', 'Half Day Hire', 'Half day vehicle hire', 3500, true, 4, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
('trn_svc_full_day', 'Full Day Hire', 'Full day vehicle hire', 6000, true, 5, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
