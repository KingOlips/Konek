-- Konek Database Schema
-- MySQL 8.0+ compatible

CREATE DATABASE IF NOT EXISTS `konek_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `konek_db`;

-- Users table
CREATE TABLE `users` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL UNIQUE,
    `password_hash` VARCHAR(255) NOT NULL,
    `auth_token` VARCHAR(64) DEFAULT NULL UNIQUE,
    `active_status` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
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

-- Sample data for testing (optional)
-- INSERT INTO `squads` (`squad_name`, `join_code`) VALUES ('Demo Squad', 'KONEK123');