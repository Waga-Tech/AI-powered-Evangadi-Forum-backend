-- Migration 002 — DOWN
-- Reverses 002_changelog_releases_up.sql
--
-- Drops in reverse dependency order (column before table is irrelevant here,
-- but kept consistent with the 001 convention).
-- WARNING: This removes data permanently. Only run in development or staging.

SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE `users` DROP COLUMN `last_seen_release_id`;

DROP TABLE IF EXISTS `releases`;

SET FOREIGN_KEY_CHECKS = 1;
