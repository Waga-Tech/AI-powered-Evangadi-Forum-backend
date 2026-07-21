-- Migration 001 — DOWN
-- Reverses 001_community_trust_foundation_up.sql
--
-- Drops in reverse dependency order (child tables before parent columns).
-- WARNING: This removes data permanently. Only run in development or staging.

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `learning_hint_cache`;
DROP TABLE IF EXISTS `user_badges`;
DROP TABLE IF EXISTS `user_moderation_status`;
DROP TABLE IF EXISTS `moderation_flags`;
DROP TABLE IF EXISTS `answer_votes`;

ALTER TABLE `users` DROP COLUMN `role`;
ALTER TABLE `users` DROP COLUMN `trust_score`;

SET FOREIGN_KEY_CHECKS = 1;
