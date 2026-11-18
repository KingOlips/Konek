-- Konek Database Migration
-- Adds password_set so the app knows whether an account has a real password.
--
--   password_set = 0 -> account was created through Google Sign-In and has not
--                       completed the mandatory profile step yet.
--   password_set = 1 -> normal password login is available.
--
-- Run against an existing database:
--   mysql -u root konek_db < database/migrations/2026-11-17_add_password_set.sql

ALTER TABLE `users`
    ADD COLUMN `password_set` TINYINT(1) NOT NULL DEFAULT 1 AFTER `google_id`;
