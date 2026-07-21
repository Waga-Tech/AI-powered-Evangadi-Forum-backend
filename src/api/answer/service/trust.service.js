import { safeExecute } from "../../../../db/config.js";

const POINTS = {
  WELCOME_BONUS: 5,
  QUICK_RESPONDER: 3,
  WEEKLY_CONSISTENCY: 10,
};

const QUICK_RESPONDER_THRESHOLD = 5;

const addTrustScore = (userId, points) =>
  safeExecute(
    `UPDATE users SET trust_score = trust_score + ? WHERE user_id = ?`,
    [points, userId]
  );

// INSERT IGNORE + the UNIQUE KEY on (user_id, badge_name, period) makes this the
// idempotency primitive: affectedRows === 1 only when the row is newly inserted,
// 0 when it already existed. Callers gate point awards on that result so that
// re-running this handler for the same answer never double-counts trust score.
const awardBadge = (userId, badgeName, period = "") =>
  safeExecute(
    `INSERT IGNORE INTO user_badges (user_id, badge_name, period) VALUES (?, ?, ?)`,
    [userId, badgeName, period]
  );

export const applyAnswerCreationTrust = async ({
  userId,
  answerId,
  questionId,
  questionCreatedAt,
}) => {
  // ── 1. Welcome bonus (+5) — once, on the user's first answer ever ─────────
  const prevAnswers = await safeExecute(
    `SELECT COUNT(*) AS total FROM answers WHERE user_id = ? AND answer_id != ?`,
    [userId, answerId]
  );

  if (Number(prevAnswers[0].total) === 0) {
    // Award the badge first and only add points when it was actually inserted,
    // so a duplicate invocation (retry / double controller run) can't re-award.
    const firstAnswer = await awardBadge(userId, "First Answer");
    if (firstAnswer.affectedRows === 1) {
      await addTrustScore(userId, POINTS.WELCOME_BONUS);
    }
  }

  // ── 2. Quick responder (+3) — first answer on a <24h-old question ─────────
  const ageMs = Date.now() - new Date(questionCreatedAt).getTime();
  const within24h = ageMs < 24 * 60 * 60 * 1000;

  if (within24h) {
    const otherAnswers = await safeExecute(
      `SELECT COUNT(*) AS total FROM answers WHERE question_id = ? AND answer_id != ?`,
      [questionId, answerId]
    );

    if (Number(otherAnswers[0].total) === 0) {
      // Record the per-answer credit first (period = answerId keeps it unique).
      // Points are added only when the credit row was newly inserted.
      const credit = await awardBadge(
        userId,
        "Quick Responder Credit",
        String(answerId)
      );

      if (credit.affectedRows === 1) {
        await addTrustScore(userId, POINTS.QUICK_RESPONDER);

        // Count credits AFTER inserting so the threshold reflects this one.
        const credits = await safeExecute(
          `SELECT COUNT(*) AS total FROM user_badges
           WHERE user_id = ? AND badge_name = 'Quick Responder Credit'`,
          [userId]
        );

        if (Number(credits[0].total) >= QUICK_RESPONDER_THRESHOLD) {
          await awardBadge(userId, "Quick Responder");
        }
      }
    }
  }

  // ── 3. Weekly consistency (+10) — once per ISO week, at 3+ answers ────────
  const weekAnswers = await safeExecute(
    `SELECT COUNT(*) AS total FROM answers
     WHERE user_id = ? AND YEARWEEK(created_at, 1) = YEARWEEK(NOW(), 1)`,
    [userId]
  );

  if (Number(weekAnswers[0].total) >= 3) {
    // Idempotency record keyed by ISO week, so the bonus fires at most once per
    // week even if the weekly count dips below 3 and climbs back (delete/mod).
    const weekRow = await safeExecute(`SELECT YEARWEEK(NOW(), 1) AS wk`);
    const period = `W${weekRow[0].wk}`;
    const weekly = await awardBadge(userId, "Weekly Consistency", period);
    if (weekly.affectedRows === 1) {
      await addTrustScore(userId, POINTS.WEEKLY_CONSISTENCY);
    }
  }
};
