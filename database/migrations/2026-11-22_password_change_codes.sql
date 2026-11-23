-- Password change verification codes.
--
-- Password reset and password change both use six-digit codes stored as
-- Argon2id hashes. The `purpose` column keeps the two flows separate so a code
-- requested from Settings cannot be replayed through the unauthenticated
-- forgot-password endpoint, and vice versa.
--
-- Run after 2026-11-22_password_reset_codes.sql on existing databases:
--   mysql -u root konek_db < database/migrations/2026-11-22_password_change_codes.sql

USE `konek_db`;

ALTER TABLE `password_reset_sessions`
    ADD COLUMN `purpose` ENUM('reset', 'change_password') NOT NULL DEFAULT 'reset'
        AFTER `status`,
    ADD INDEX `idx_session_purpose_user` (`purpose`, `user_id`);
