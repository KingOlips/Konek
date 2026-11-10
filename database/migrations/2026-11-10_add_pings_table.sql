-- Migration: add the pings table used for recipient-side notifications.
-- Run against an existing `konek_db` database:
--   mysql -u root konek_db < database/migrations/2026-11-10_add_pings_table.sql

CREATE TABLE IF NOT EXISTS `pings` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `squad_id` INT UNSIGNED DEFAULT NULL,
    `from_user_id` INT UNSIGNED NOT NULL,
    `target_user_id` INT UNSIGNED NOT NULL,
    `ping_type` VARCHAR(32) NOT NULL,
    `message` VARCHAR(120) DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `read_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    FOREIGN KEY (`squad_id`) REFERENCES `squads`(`id`) ON DELETE SET NULL,
    FOREIGN KEY (`from_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
    INDEX `idx_ping_target_unread` (`target_user_id`, `read_at`, `created_at`),
    INDEX `idx_ping_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
