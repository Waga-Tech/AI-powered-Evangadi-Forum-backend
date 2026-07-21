-- Migration 002 — UP
-- Adds the changelog / release notes feature.
--
-- Notes:
--   - ALTER TABLE statements must only be run once. MySQL does not support
--     ADD COLUMN IF NOT EXISTS (that is MariaDB-only syntax). Running again
--     will error with "Duplicate column name", which is safe to ignore.
--   - CREATE TABLE IF NOT EXISTS is fully idempotent.
-- Never drops or truncates anything.

SET FOREIGN_KEY_CHECKS = 0;

-- -------------------------------------------------------------------------
-- releases
-- One row per published release. `highlights` is a JSON array of
-- { category: 'new'|'improved'|'fixed', text: string } entries so the UI can
-- render categorized bullet points. Pattern mirrors question_vectors.embedding
-- and learning_hint_cache.response_json which already use JSON columns.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `releases` (
    `release_id`   BIGINT AUTO_INCREMENT PRIMARY KEY,
    `version`      VARCHAR(20)  NOT NULL UNIQUE,
    `title`        VARCHAR(150) NOT NULL,
    `highlights`   JSON NOT NULL,
    `is_published` TINYINT(1) NOT NULL DEFAULT 1,
    `published_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `created_at`   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_releases_published` (`is_published`, `release_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- users: track which release each user has seen (run once only)
-- "Unseen" = published releases with release_id > COALESCE(last_seen_release_id, 0)
-- -------------------------------------------------------------------------
ALTER TABLE `users`
  ADD COLUMN `last_seen_release_id` BIGINT NULL
  AFTER `role`;

-- -------------------------------------------------------------------------
-- Seed the changelog with the project's release history.
-- Inserted oldest-first so release_id increases with the release date.
-- Dates are anchored to when each milestone landed in git history.
-- -------------------------------------------------------------------------
INSERT INTO `releases` (`version`, `title`, `highlights`, `published_at`, `is_published`) VALUES
(
  '0.1.0',
  'Forum foundation',
  CAST('[
    {"category":"new","text":"Sign up and log in, with email confirmation and password recovery."},
    {"category":"new","text":"Ask questions and post answers in a threaded discussion view."},
    {"category":"new","text":"Personal dashboard and a Your topics page to track your own questions."}
  ]' AS JSON),
  '2026-06-14 12:00:00',
  1
),
(
  '0.2.0',
  'Semantic search',
  CAST('[
    {"category":"new","text":"Search finds questions by meaning, not just exact keywords."},
    {"category":"new","text":"Each thread now suggests similar questions."}
  ]' AS JSON),
  '2026-06-16 12:00:00',
  1
),
(
  '0.3.0',
  'More reliable email',
  CAST('[
    {"category":"improved","text":"Transactional email now goes through Resend for reliable delivery."},
    {"category":"fixed","text":"Author names now render correctly on every answer."}
  ]' AS JSON),
  '2026-06-18 12:00:00',
  1
),
(
  '0.4.0',
  'AI Search & sharing',
  CAST('[
    {"category":"new","text":"AI Search returns a written answer alongside matching threads."},
    {"category":"new","text":"Share any question with a one-click copy link."},
    {"category":"improved","text":"Faster search thanks to an in-memory embedding cache."},
    {"category":"fixed","text":"Search falls back to keyword results instead of failing when AI is unavailable."}
  ]' AS JSON),
  '2026-06-20 12:00:00',
  1
),
(
  '0.5.0',
  'Community & reputation',
  CAST('[
    {"category":"new","text":"Upvote the answers you find most helpful."},
    {"category":"new","text":"Earn a trust score as your contributions get upvoted."},
    {"category":"new","text":"Monthly and all-time leaderboards for top contributors."},
    {"category":"new","text":"Public user profiles with badges and contribution stats."}
  ]' AS JSON),
  '2026-06-21 12:00:00',
  1
),
(
  '1.0.0',
  'Admin panel',
  CAST('[
    {"category":"new","text":"Unified admin panel with a moderation queue, flag activity, and user management."},
    {"category":"new","text":"Role-based access control so only admins can moderate."}
  ]' AS JSON),
  '2026-06-22 09:00:00',
  1
),
(
  '1.1.0',
  'Smarter moderation & duplicate detection',
  CAST('[
    {"category":"new","text":"AI moderation now reviews every question and answer before it is published."},
    {"category":"new","text":"Off-topic posts get an instant explanation plus an option to ask the AI directly."},
    {"category":"new","text":"Spam and harassment are automatically flagged for admin review."},
    {"category":"new","text":"Duplicate detection warns you when a very similar question already exists, with a Post anyway option."},
    {"category":"improved","text":"Posting a question now takes you straight to the published thread."},
    {"category":"fixed","text":"Admin Flag Activity filters (Pending / Approved / Removed) now load correctly."}
  ]' AS JSON),
  '2026-06-22 15:00:00',
  1
);

SET FOREIGN_KEY_CHECKS = 1;
