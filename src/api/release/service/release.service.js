import { safeExecute } from "../../../../db/config.js";

// mysql2 may return JSON columns already parsed (object) or as a string,
// depending on driver/version. Normalize to an array either way.
// Mirrors the defensive parse pattern in question/service/vector.service.js.
const parseHighlights = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const mapRelease = (row) => ({
  releaseId:   row.release_id,
  version:     row.version,
  title:       row.title,
  highlights:  parseHighlights(row.highlights),
  publishedAt: row.published_at,
});

// ── GET /api/releases/unseen ──────────────────────────────────────────────────
// Published releases the user has not seen yet (newest first).
export const getUnseenReleasesService = async ({ userId }) => {
  const rows = await safeExecute(
    `SELECT r.release_id, r.version, r.title, r.highlights, r.published_at
       FROM releases r
       JOIN users u ON u.user_id = ?
      WHERE r.is_published = 1
        AND r.release_id > COALESCE(u.last_seen_release_id, 0)
      ORDER BY r.release_id DESC`,
    [userId],
  );

  const data = rows.map(mapRelease);
  return { data, count: data.length };
};

// ── POST /api/releases/seen ───────────────────────────────────────────────────
// Marks every currently-published release as seen for this user.
export const markReleasesSeenService = async ({ userId }) => {
  await safeExecute(
    `UPDATE users
        SET last_seen_release_id = (
          SELECT MAX(release_id) FROM releases WHERE is_published = 1
        )
      WHERE user_id = ?`,
    [userId],
  );
  return { success: true };
};

// ── GET /api/releases ─────────────────────────────────────────────────────────
// Recent published releases, for the navbar bell "reopen" view.
export const getRecentReleasesService = async ({ limit = 10 } = {}) => {
  const safeLimit = Math.min(50, Math.max(1, parseInt(limit) || 10));
  const rows = await safeExecute(
    `SELECT release_id, version, title, highlights, published_at
       FROM releases
      WHERE is_published = 1
      ORDER BY release_id DESC
      LIMIT ${safeLimit}`,
    [],
  );
  return { data: rows.map(mapRelease) };
};
