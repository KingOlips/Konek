-- Migration: add user profile fields (email, contact number, profile picture).
-- Run against an existing `konek_db` database:
--   mysql -u root konek_db < database/migrations/2026-11-16_add_user_profile_fields.sql

ALTER TABLE `users`
    ADD COLUMN `email` VARCHAR(255) DEFAULT NULL AFTER `username`,
    ADD COLUMN `contact_number` VARCHAR(20) DEFAULT NULL AFTER `email`,
    ADD COLUMN `profile_picture` VARCHAR(255) DEFAULT NULL AFTER `contact_number`,
    ADD UNIQUE KEY `unique_email` (`email`);
