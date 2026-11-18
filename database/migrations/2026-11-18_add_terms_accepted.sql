-- Terms of Service & Privacy Policy acceptance.
--
-- Every account must actively agree before it is created. The timestamp is
-- stored so the agreement can be shown later if it is ever questioned.
--
-- Safe to run on an existing konek_db:
--   mysql -u root konek_db < database/migrations/2026-11-18_add_terms_accepted.sql

ALTER TABLE `users`
    ADD COLUMN `terms_accepted_at` DATETIME NULL AFTER `password_set`;
