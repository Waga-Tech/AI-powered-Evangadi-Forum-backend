import { safeExecute } from "../../../../db/config.js";
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from "../../../utils/errors/index.js";

const TRUST_SCORE_PER_UPVOTE = 5;

const getVoteCount = async (answerId) => {
  const rows = await safeExecute(
    `SELECT COUNT(*) AS voteCount FROM answer_votes WHERE answer_id = ?`,
    [answerId]
  );
  return Number(rows[0].voteCount);
};

export const addVoteService = async ({ answerId, userId }) => {
  const answers = await safeExecute(
    `SELECT answer_id, user_id FROM answers WHERE answer_id = ? LIMIT 1`,
    [answerId]
  );

  if (!answers || answers.length === 0) {
    throw new NotFoundError("Answer not found", "ANSWER_NOT_FOUND");
  }

  const answer = answers[0];

  if (Number(answer.user_id) === Number(userId)) {
    throw new ForbiddenError("You cannot upvote your own answer", "SELF_VOTE_NOT_ALLOWED");
  }

  try {
    await safeExecute(
      `INSERT INTO answer_votes (answer_id, user_id) VALUES (?, ?)`,
      [answerId, userId]
    );
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      throw new ConflictError("You have already upvoted this answer", "VOTE_ALREADY_EXISTS");
    }
    throw err;
  }

  await safeExecute(
    `UPDATE users SET trust_score = trust_score + ? WHERE user_id = ?`,
    [TRUST_SCORE_PER_UPVOTE, answer.user_id]
  );

  return { answerId: Number(answerId), voteCount: await getVoteCount(answerId) };
};

export const removeVoteService = async ({ answerId, userId }) => {
  const answers = await safeExecute(
    `SELECT answer_id FROM answers WHERE answer_id = ? LIMIT 1`,
    [answerId]
  );

  if (!answers || answers.length === 0) {
    throw new NotFoundError("Answer not found", "ANSWER_NOT_FOUND");
  }

  const result = await safeExecute(
    `DELETE FROM answer_votes WHERE answer_id = ? AND user_id = ?`,
    [answerId, userId]
  );

  if (result.affectedRows === 0) {
    throw new NotFoundError("You have not voted on this answer", "VOTE_NOT_FOUND");
  }

  // Trust score is not decremented on vote removal — score only grows per policy.

  return { answerId: Number(answerId), voteCount: await getVoteCount(answerId) };
};
