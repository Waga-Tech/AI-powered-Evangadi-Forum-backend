-- Migration 001 — UP
-- Adds community trust foundation: voting, moderation, badges, and AI cache
--
-- Notes:
--   - ALTER TABLE statements must only be run once. MySQL does not support
--     ADD COLUMN IF NOT EXISTS (that is MariaDB-only syntax). Running again
--     will error with "Duplicate column name", which is safe to ignore.
--   - CREATE TABLE IF NOT EXISTS statements are fully idempotent.
-- Never drops or truncates anything.

SET FOREIGN_KEY_CHECKS = 0;

-- -------------------------------------------------------------------------
-- users: add trust_score and role columns (run once only)
-- -------------------------------------------------------------------------
ALTER TABLE `users`
  ADD COLUMN `trust_score` INT NOT NULL DEFAULT 0
  AFTER `password_hash`;

ALTER TABLE `users`
  ADD COLUMN `role` ENUM('user', 'admin') NOT NULL DEFAULT 'user'
  AFTER `trust_score`;

-- -------------------------------------------------------------------------
-- answer_votes
-- Upvote-only junction table. Composite PK enforces one vote per user per
-- answer at the database level (no application-layer race condition).
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `answer_votes` (
    `answer_id` INT NOT NULL,
    `user_id` INT NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`answer_id`, `user_id`),
    FOREIGN KEY (`answer_id`) REFERENCES `answers`(`answer_id`) ON DELETE CASCADE,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE,
    INDEX `idx_answer_votes_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- moderation_flags
-- Every Track B (offensive) post flagged by the AI lands here.
-- Admin queue reads rows where queue_status = 'pending'.
-- Post remains hidden from public until an admin actions it.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `moderation_flags` (
    `flag_id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `post_type` ENUM('question', 'answer') NOT NULL,
    `post_id` INT NOT NULL,
    `author_id` INT NOT NULL,
    `category` ENUM('spam', 'harassment', 'off_topic', 'low_quality') NOT NULL,
    `moderation_score` DECIMAL(4,3) NOT NULL,
    `ai_reason` TEXT NOT NULL,
    `queue_status` ENUM('pending', 'approved', 'removed') NOT NULL DEFAULT 'pending',
    `has_revision` TINYINT(1) NOT NULL DEFAULT 0,
    `flagged_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `reviewed_at` TIMESTAMP NULL,
    `reviewed_by` INT NULL,
    FOREIGN KEY (`author_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE,
    FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL,
    INDEX `idx_mf_queue` (`queue_status`, `flagged_at`),
    INDEX `idx_mf_author` (`author_id`),
    INDEX `idx_mf_post` (`post_type`, `post_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- user_moderation_status
-- One row per user who has received at least one moderation incident.
-- Row is created on first incident — not pre-seeded for all users.
-- Application handles the 60-day reset by updating incident_count and
-- last_reset_at when the clean window has elapsed.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_moderation_status` (
    `user_id` INT PRIMARY KEY,
    `incident_count` INT NOT NULL DEFAULT 0,
    `status` ENUM('active', 'limited', 'blocked', 'removed') NOT NULL DEFAULT 'active',
    `blocked_until` TIMESTAMP NULL,
    `last_incident_at` TIMESTAMP NULL,
    `last_reset_at` TIMESTAMP NULL,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE,
    INDEX `idx_ums_status` (`status`),
    INDEX `idx_ums_blocked_until` (`blocked_until`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- user_badges
-- period = '' for one-time badges (First Answer, Quick Responder, etc.)
-- period = 'YYYY-MM' for Monthly Champion entries so the same user can
-- win multiple months without violating the unique constraint.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_badges` (
    `badge_id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT NOT NULL,
    `badge_name` VARCHAR(50) NOT NULL,
    `period` VARCHAR(64) NOT NULL DEFAULT '',
    `earned_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE,
    UNIQUE KEY `uniq_user_badge_period` (`user_id`, `badge_name`, `period`),
    INDEX `idx_user_badges_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- learning_hint_cache
-- Keyed by SHA-256 of the normalised input so identical prompts hit cache
-- instead of calling Gemini again. Cleanup job deletes rows past expires_at.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `learning_hint_cache` (
    `cache_id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `cache_key` CHAR(64) NOT NULL,
    `hint_type` ENUM('scope_check', 'ai_context', 'draft_coach') NOT NULL,
    `response_json` JSON NOT NULL,
    `hit_count` INT NOT NULL DEFAULT 0,
    `expires_at` TIMESTAMP NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY `uniq_lhc_key` (`cache_key`),
    INDEX `idx_lhc_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
