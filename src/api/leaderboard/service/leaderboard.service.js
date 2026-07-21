import { safeExecute } from "../../../../db/config.js";

// Fetch display badges for a set of user IDs in one query.
// Excludes internal tracking entries (Quick Responder Credit).
const fetchBadgesForUsers = async (userIds) => {
  if (userIds.length === 0) return {};

  const placeholders = userIds.map(() => '?').join(', ');
  const rows = await safeExecute(
    `SELECT user_id, badge_name
     FROM user_badges
     WHERE user_id IN (${placeholders})
       AND badge_name != 'Quick Responder Credit'
     ORDER BY earned_at ASC`,
    userIds
  );

  // Group into { [userId]: string[] }
  return rows.reduce((acc, row) => {
    if (!acc[row.user_id]) acc[row.user_id] = [];
    acc[row.user_id].push(row.badge_name);
    return acc;
  }, {});
};

// Monthly leaderboard — top 3 by upvotes received this calendar month × 5.
// Only upvote points are measurable per-month without a ledger. Other trust
// events (welcome bonus, quick responder, weekly consistency) are included
// in the all-time trust_score but cannot be isolated to a specific month.
// Tie-breaker 1: most answers posted this month.
// Tie-breaker 2: earliest user_id (longest-standing member wins).
// Only active users are included (limited/blocked/removed are excluded).
// The month window is a half-open range on a UTC start-of-month so the SQL can
// use a created_at index and stays consistent with the UTC `period` below.
export const getMonthlyLeaderboardService = async () => {
  const rows = await safeExecute(
    `SELECT
       u.user_id    AS userId,
       u.first_name AS firstName,
       u.last_name  AS lastName,
       u.trust_score AS trustScore,
       COALESCE(mv.vote_count * 5, 0)  AS pointsThisPeriod,
       COALESCE(ma.answer_count, 0)    AS answerCount
     FROM users u
     LEFT JOIN (
       SELECT a.user_id, COUNT(*) AS vote_count
       FROM answer_votes av
       INNER JOIN answers a ON a.answer_id = av.answer_id
       WHERE av.created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')
         AND av.created_at <  DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01') + INTERVAL 1 MONTH
       GROUP BY a.user_id
     ) mv ON mv.user_id = u.user_id
     LEFT JOIN (
       SELECT user_id, COUNT(*) AS answer_count
       FROM answers
       WHERE created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')
         AND created_at <  DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01') + INTERVAL 1 MONTH
       GROUP BY user_id
     ) ma ON ma.user_id = u.user_id
     LEFT JOIN user_moderation_status ums ON ums.user_id = u.user_id
     WHERE (ums.status IS NULL OR ums.status = 'active')
       AND COALESCE(mv.vote_count, 0) > 0
     ORDER BY pointsThisPeriod DESC, answerCount DESC, u.user_id ASC
     LIMIT 3`,
    []
  );

  const userIds = rows.map(r => r.userId);
  const badgeMap = await fetchBadgesForUsers(userIds);

  // Compute the period label in UTC so it matches the UTC month window above.
  const now = new Date();
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  return {
    period,
    data: rows.map((row, i) => ({
      rank:             i + 1,
      userId:           row.userId,
      firstName:        row.firstName,
      lastName:         row.lastName,
      trustScore:       row.trustScore,
      pointsThisPeriod: row.pointsThisPeriod,
      answerCount:      row.answerCount,
      badges:           badgeMap[row.userId] || [],
    })),
  };
};

// All-time leaderboard — top 3 by cumulative trust_score.
// Tie-breaker 1: most total answers posted.
// Tie-breaker 2: earliest user_id (stable, deterministic ordering).
// Only active users are included (limited/blocked/removed are excluded).
export const getAllTimeLeaderboardService = async () => {
  const rows = await safeExecute(
    `SELECT
       u.user_id    AS userId,
       u.first_name AS firstName,
       u.last_name  AS lastName,
       u.trust_score AS trustScore,
       COALESCE(ac.total, 0) AS answerCount
     FROM users u
     LEFT JOIN (
       SELECT user_id, COUNT(*) AS total
       FROM answers
       GROUP BY user_id
     ) ac ON ac.user_id = u.user_id
     LEFT JOIN user_moderation_status ums ON ums.user_id = u.user_id
     WHERE (ums.status IS NULL OR ums.status = 'active')
       AND u.trust_score > 0
     ORDER BY u.trust_score DESC, answerCount DESC, u.user_id ASC
     LIMIT 3`,
    []
  );

  const userIds = rows.map(r => r.userId);
  const badgeMap = await fetchBadgesForUsers(userIds);

  return {
    data: rows.map((row, i) => ({
      rank:             i + 1,
      userId:           row.userId,
      firstName:        row.firstName,
      lastName:         row.lastName,
      trustScore:       row.trustScore,
      pointsThisPeriod: row.trustScore,
      answerCount:      row.answerCount,
      badges:           badgeMap[row.userId] || [],
    })),
  };
};
