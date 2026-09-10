-- Custom access roles + detailed permission matrices
CREATE TABLE IF NOT EXISTS `access_roles` (
  `id` VARCHAR(191) NOT NULL,
  `key` VARCHAR(191) NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `description` VARCHAR(191) NULL,
  `base_role` ENUM('ADMIN', 'HOTEL_STAFF', 'HOTEL_FD', 'RESTAURANT_STAFF', 'HOUSEKEEPER') NOT NULL,
  `is_system` BOOLEAN NOT NULL DEFAULT false,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `sort_order` INT NOT NULL DEFAULT 100,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `access_roles_key_key` (`key`),
  INDEX `access_roles_base_role_idx` (`base_role`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `access_role_permissions` (
  `id` VARCHAR(191) NOT NULL,
  `access_role_id` VARCHAR(191) NOT NULL,
  `permission_key` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `access_role_permissions_access_role_id_permission_key_key` (`access_role_id`, `permission_key`),
  INDEX `access_role_permissions_access_role_id_idx` (`access_role_id`),
  CONSTRAINT `access_role_permissions_access_role_id_fkey`
    FOREIGN KEY (`access_role_id`) REFERENCES `access_roles` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Link users to an access role (optional; falls back to RoleType mapping)
SET @dbname = DATABASE();
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'access_role_id'
  ) > 0,
  'SELECT 1',
  'ALTER TABLE `users` ADD COLUMN `access_role_id` VARCHAR(191) NULL, ADD INDEX `users_access_role_id_idx` (`access_role_id`)'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
