-- Cross-device password reset.
--
-- A reset can be requested on one device (for example a desktop browser) and
-- verified from the email on another (for example a phone). The requesting
-- screen watches `password_reset_sessions`; clicking Verify in the email marks
-- the session verified and issues a one-time token the requesting screen uses
-- to set the new password.
--
-- Safe to run on an existing konek_db:
--   mysql -u root konek_db < database/migrations/2026-11-18_cross_device_password_reset.sql

USE `konek_db`;

CREATE TABLE IF NOT EXISTS `password_reset_sessions` (
    `id` CHAR(64) NOT NULL,
    `user_id` INT UNSIGNED NULL,
    `status` ENUM('pending', 'verified') NOT NULL DEFAULT 'pending',
    `desktop_token` CHAR(64) NULL,
    `expires_at` DATETIME NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `unique_desktop_token` (`desktop_token`),
    INDEX `idx_session_user` (`user_id`),
    INDEX `idx_session_expires` (`expires_at`),
    CONSTRAINT `fk_password_reset_session_user`
        FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `password_resets`
    ADD COLUMN `session_id` CHAR(64) NULL AFTER `token_hash`,
    ADD INDEX `idx_reset_session` (`session_id`),
    ADD CONSTRAINT `fk_password_reset_session`
        FOREIGN KEY (`session_id`) REFERENCES `password_reset_sessions`(`id`)
        ON DELETE CASCADE;
