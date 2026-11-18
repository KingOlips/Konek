-- Konek Database Migration
-- Adds Google account linkage for Google Sign-In.
--
-- Run against an existing database:
--   mysql -u root konek_db < database/migrations/2026-11-17_add_google_id.sql

ALTER TABLE `users`
    ADD COLUMN `google_id` VARCHAR(255) DEFAULT NULL AFTER `password_hash`,
    ADD UNIQUE KEY `unique_google_id` (`google_id`);
