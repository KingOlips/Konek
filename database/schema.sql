-- Konek Database Schema
-- MySQL 8.0+ compatible

CREATE DATABASE IF NOT EXISTS `konek_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `konek_db`;

-- Users table
CREATE TABLE `users` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL UNIQUE,
    `email` VARCHAR(255) DEFAULT NULL,
    `contact_number` VARCHAR(20) DEFAULT NULL,
    `profile_picture` VARCHAR(255) DEFAULT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `google_id` VARCHAR(255) DEFAULT NULL,
    `password_set` TINYINT(1) NOT NULL DEFAULT 1,
    `terms_accepted_at` DATETIME DEFAULT NULL,
    `auth_token` VARCHAR(64) DEFAULT NULL UNIQUE,
    `active_status` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `unique_email` (`email`),
    UNIQUE KEY `unique_google_id` (`google_id`),
    INDEX `idx_username` (`username`),
    INDEX `idx_auth_token` (`auth_token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Squads table
CREATE TABLE `squads` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `squad_name` VARCHAR(100) NOT NULL,
    `join_code` VARCHAR(10) NOT NULL UNIQUE,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_join_code` (`join_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Squad members junction table
CREATE TABLE `squad_members` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `squad_id` INT UNSIGNED NOT NULL,
    `user_id` INT UNSIGNED NOT NULL,
    `joined_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `role` ENUM('member', 'admin') NOT NULL DEFAULT 'member',
    `relationship` ENUM('dad', 'mom', 'son', 'daughter', 'child', 'grandparent', 'partner', 'friend', 'other') NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `unique_squad_user` (`squad_id`, `user_id`),
    FOREIGN KEY (`squad_id`) REFERENCES `squads`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
    INDEX `idx_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Locations table
CREATE TABLE `locations` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT UNSIGNED NOT NULL,
    `latitude` DECIMAL(10, 8) NOT NULL,
    `longitude` DECIMAL(11, 8) NOT NULL,
    `accuracy` DECIMAL(10, 2) DEFAULT NULL,
    `altitude` DECIMAL(10, 2) DEFAULT NULL,
    `speed` DECIMAL(10, 2) DEFAULT NULL,
    `heading` DECIMAL(5, 2) DEFAULT NULL,
    `battery_level` TINYINT UNSIGNED DEFAULT NULL,
    `is_charging` TINYINT(1) DEFAULT NULL,
    `timestamp` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
    INDEX `idx_user_timestamp` (`user_id`, `timestamp`),
    INDEX `idx_timestamp` (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration for existing databases created before battery reporting:
-- ALTER TABLE `locations`
--     ADD COLUMN `battery_level` TINYINT UNSIGNED DEFAULT NULL AFTER `heading`,
--     ADD COLUMN `is_charging` TINYINT(1) DEFAULT NULL AFTER `battery_level`;

-- Geofences table (for future geofencing features)
CREATE TABLE `geofences` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `squad_id` INT UNSIGNED NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `latitude` DECIMAL(10, 8) NOT NULL,
    `longitude` DECIMAL(11, 8) NOT NULL,
    `radius_meters` INT UNSIGNED NOT NULL,
    `created_by` INT UNSIGNED NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    FOREIGN KEY (`squad_id`) REFERENCES `squads`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Squad pings
-- One row per ping. `read_at` is set when the recipient's app displays it.
-- Safe to run this CREATE on existing databases (it only creates the table).
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

-- Password reset tokens
-- Only a SHA-256 hash of the emailed token is stored, so a database leak cannot
-- be used to reset passwords. Each row expires 30 minutes after creation.
CREATE TABLE IF NOT EXISTS `password_resets` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT UNSIGNED NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `unique_token_hash` (`token_hash`),
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
    INDEX `idx_reset_user` (`user_id`),
    INDEX `idx_reset_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- In-app notification inbox
-- One row per notification addressed to a user. `read_at` is set when the
-- notification is opened. Email delivery (welcome, password reset) is
-- separate and never blocks the inbox.
CREATE TABLE IF NOT EXISTS `notifications` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT UNSIGNED NOT NULL,
    `type` VARCHAR(32) NOT NULL DEFAULT 'system',
    `title` VARCHAR(160) NOT NULL,
    `message` TEXT DEFAULT NULL,
    `data` TEXT DEFAULT NULL,
    `read_at` TIMESTAMP NULL DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
    INDEX `idx_notification_user_read` (`user_id`, `read_at`, `created_at`),
    INDEX `idx_notification_user_created` (`user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sample data for testing (optional)
-- INSERT INTO `squads` (`squad_name`, `join_code`) VALUES ('Demo Squad', 'KONEK123');