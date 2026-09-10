-- =============================================================================
-- DreamInn production MySQL — Roles & Permissions (run once on cPanel / phpMyAdmin)
-- Safe to re-run: uses IF NOT EXISTS / conditional ALTER
-- Order: run this entire script in one go
-- =============================================================================

-- 1) Legacy role / user permission tables
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
  INDEX `user_permissions_user_id_idx` (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- FK for user_permissions (skip if already present)
SET @dbname = DATABASE();
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = 'user_permissions'
      AND CONSTRAINT_NAME = 'user_permissions_user_id_fkey'
  ) > 0,
  'SELECT 1',
  'ALTER TABLE `user_permissions` ADD CONSTRAINT `user_permissions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) Custom access roles + permission matrix
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
  INDEX `access_role_permissions_access_role_id_idx` (`access_role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = 'access_role_permissions'
      AND CONSTRAINT_NAME = 'access_role_permissions_access_role_id_fkey'
  ) > 0,
  'SELECT 1',
  'ALTER TABLE `access_role_permissions` ADD CONSTRAINT `access_role_permissions_access_role_id_fkey` FOREIGN KEY (`access_role_id`) REFERENCES `access_roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3) Link users → access_roles
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'access_role_id'
  ) > 0,
  'SELECT 1',
  'ALTER TABLE `users` ADD COLUMN `access_role_id` VARCHAR(191) NULL, ADD INDEX `users_access_role_id_idx` (`access_role_id`)'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = 'users'
      AND CONSTRAINT_NAME = 'users_access_role_id_fkey'
  ) > 0,
  'SELECT 1',
  'ALTER TABLE `users` ADD CONSTRAINT `users_access_role_id_fkey` FOREIGN KEY (`access_role_id`) REFERENCES `access_roles` (`id`) ON DELETE SET NULL ON UPDATE CASCADE'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Done. After deploy, open System → Roles & Permissions once (as Admin)
-- so system roles and default permission keys are seeded automatically.
