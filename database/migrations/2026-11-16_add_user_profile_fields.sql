-- Migration: add user profile fields (email, contact number, profile picture).
-- Run against an existing `konek_db` database:
--   mysql -u root konek_db < database/migrations/2026-11-16_add_user_profile_fields.sql
--
-- Safe to re-run: each step checks information_schema first, so it works on
-- databases where `email` was added manually and on both MySQL 8 and MariaDB.

SET @db_name := DATABASE();

-- email ---------------------------------------------------------------------
SET @sql := IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'email') = 0,
    'ALTER TABLE `users` ADD COLUMN `email` VARCHAR(255) DEFAULT NULL AFTER `username`',
    'SELECT ''email column already exists'' AS note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- contact_number ------------------------------------------------------------
SET @sql := IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'contact_number') = 0,
    'ALTER TABLE `users` ADD COLUMN `contact_number` VARCHAR(20) DEFAULT NULL AFTER `email`',
    'SELECT ''contact_number column already exists'' AS note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- profile_picture -----------------------------------------------------------
SET @sql := IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'profile_picture') = 0,
    'ALTER TABLE `users` ADD COLUMN `profile_picture` VARCHAR(255) DEFAULT NULL AFTER `contact_number`',
    'SELECT ''profile_picture column already exists'' AS note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- unique email index --------------------------------------------------------
SET @sql := IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'email' AND NON_UNIQUE = 0) = 0,
    'ALTER TABLE `users` ADD UNIQUE KEY `unique_email` (`email`)',
    'SELECT ''unique email index already exists'' AS note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
