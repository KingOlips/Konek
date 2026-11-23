-- Password reset verification codes.
--
-- New reset requests store a six-digit code as an Argon2id hash. The plain
-- code exists only in the email. Verification attempts are limited to five.
--
-- Run after 2026-11-18_cross_device_password_reset.sql on existing databases:
--   mysql -u root konek_db < database/migrations/2026-11-22_password_reset_codes.sql

USE `konek_db`;

ALTER TABLE `password_reset_sessions`
    ADD COLUMN `verification_code_hash` VARCHAR(255) NULL AFTER `status`,
    ADD COLUMN `verification_attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0
        AFTER `verification_code_hash`;
