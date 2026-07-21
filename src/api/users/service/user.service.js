import { safeExecute } from "../../../../db/config.js";
import { NotFoundError } from "../../../utils/errors/index.js";

export const getUserProfileService = async (userId) => {
  const users = await safeExecute(
    `SELECT
       u.user_id    AS userId,
       u.first_name AS firstName,
       u.last_name  AS lastName,
       u.trust_score AS trustScore,
       u.created_at AS joinedAt
     FROM users u
     LEFT JOIN user_moderation_status ums ON ums.user_id = u.user_id
     WHERE u.user_id = ?
       AND (ums.status IS NULL OR ums.status NOT IN ('blocked', 'removed'))
     LIMIT 1`,
    [userId]
  );

  if (!users || users.length === 0) {
    throw new NotFoundError("User not found", "USER_NOT_FOUND");
  }

  const user = users[0];

  const [stats, badges] = await Promise.all([
    safeExecute(
      `SELECT
         COUNT(DISTINCT a.answer_id)  AS totalAnswers,
         COUNT(av.answer_id)          AS totalVotesReceived
       FROM answers a
       LEFT JOIN answer_votes av ON av.answer_id = a.answer_id
       WHERE a.user_id = ?`,
      [userId]
    ),
    safeExecute(
      `SELECT badge_name, earned_at
       FROM user_badges
       WHERE user_id = ?
         AND badge_name != 'Quick Responder Credit'
       ORDER BY earned_at ASC`,
      [userId]
    ),
  ]);

  const monthlyChampionCount = badges.filter(
    b => b.badge_name === 'Monthly Champion'
  ).length;

  return {
    userId:     user.userId,
    firstName:  user.firstName,
    lastName:   user.lastName,
    trustScore: user.trustScore,
    joinedAt:   user.joinedAt,
    badges: badges.map(b => ({
      name:     b.badge_name,
      earnedAt: b.earned_at,
    })),
    stats: {
      totalAnswers:         Number(stats[0].totalAnswers),
      totalVotesReceived:   Number(stats[0].totalVotesReceived),
      monthlyChampionCount,
    },
  };
};
