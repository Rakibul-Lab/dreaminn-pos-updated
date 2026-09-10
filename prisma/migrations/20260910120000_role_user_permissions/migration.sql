-- Role / user page-access permissions (Roles & Permissions menu)
CREATE TABLE IF NOT EXISTS `role_permissions` (
  `id` VARCHAR(191) NOT NULL,
  `role` ENUM('ADMIN', 'HOTEL_STAFF', 'HOTEL_FD', 'RESTAURANT_STAFF', 'HOUSEKEEPER') NOT NULL,
  `permission_key` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `role_permissions_role_permission_key_key` (`role`, `permission_key`),
  INDEX `role_permissions_role_idx` (`role`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_permissions` (
  `id` VARCHAR(191) NOT NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `permission_key` VARCHAR(191) NOT NULL,
  `granted` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `user_permissions_user_id_permission_key_key` (`user_id`, `permission_key`),
  INDEX `user_permissions_user_id_idx` (`user_id`),
  CONSTRAINT `user_permissions_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
