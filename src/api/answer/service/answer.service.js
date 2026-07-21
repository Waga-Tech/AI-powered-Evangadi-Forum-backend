import { safeExecute } from "../../../../db/config.js";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from "../../../utils/errors/index.js";
import { applyAnswerCreationTrust } from "./trust.service.js";
import {
  moderateContent,
  checkUserModerationStatus,
  persistModerationFlag,
} from "../../moderation/service/contentModerator.service.js";

export const createAnswerService = async ({ questionId, content, userId }) => {
  const userStatus = await checkUserModerationStatus(userId);
  if (!userStatus.allowed) {
    throw new ForbiddenError(userStatus.reason, 'USER_POSTING_RESTRICTED');
  }

  // Verify question exists and fetch title+content for moderation context
  const questions = await safeExecute(
    `SELECT question_id, user_id, title, content, created_at
     FROM questions
     WHERE question_id = ?
     LIMIT 1`,
    [questionId],
  );

  if (!questions || questions.length === 0) {
    throw new NotFoundError("Question not found", "QUESTION_NOT_FOUND");
  }

  const question = questions[0];

  if (Number(question.user_id) === Number(userId)) {
    throw new BadRequestError("You cannot answer your own question", "SELF_ANSWER_NOT_ALLOWED");
  }

  const modDecision = await moderateContent({
    postType: 'answer',
    content,
    questionContext: `${question.title} — ${question.content}`,
  });

  if (modDecision.action === 'reject') {
    const err = new BadRequestError(
      modDecision.reason || 'Your answer does not appear to address the question.',
      'CONTENT_MODERATION_REJECTED',
    );
    err.guidance = modDecision.guidance;
    throw err;
  }

  // Insert answer — the UNIQUE KEY on (question_id, user_id) enforces
  // the one-answer-per-user constraint atomically at the DB level.
  let result;
  try {
    result = await safeExecute(
      `INSERT INTO answers (question_id, user_id, content, created_at, updated_at)
       VALUES (?, ?, ?, NOW(), NOW())`,
      [questionId, userId, content],
    );
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      throw new ConflictError("You have already answered this question", "ANSWER_ALREADY_EXISTS");
    }
    throw err;
  }

  const answerId = result.insertId;

  if (modDecision.action === 'flag') {
    persistModerationFlag({
      postType: 'answer',
      postId: answerId,
      authorId: userId,
      category: modDecision.category,
      score: modDecision.score,
      reason: modDecision.reason,
    }).catch(e => console.error('[moderation] Flag persist failed for answer:', e.message));
  }

  // Apply trust score events — fire-and-forget.
  applyAnswerCreationTrust({
    userId,
    answerId,
    questionId,
    questionCreatedAt: question.created_at,
  }).catch(err => {
    console.error('[trust] Failed to apply answer creation trust events:', err.message);
  });

  // Fetch created answer
  const rows = await safeExecute(
    `SELECT
       a.answer_id AS id,
       a.question_id AS questionId,
       a.content,
       a.created_at AS createdAt,
       a.updated_at AS updatedAt,
       u.user_id AS authorId,
       u.first_name AS authorFirstName,
       u.last_name AS authorLastName
     FROM answers a
     INNER JOIN users u ON a.user_id = u.user_id
     WHERE a.answer_id = ?
     LIMIT 1`,
    [answerId],
  );

  if (!rows || rows.length === 0) {
    throw new NotFoundError("Created answer not found");
  }

  const row = rows[0];
  return {
    id: row.id,
    questionId: row.questionId,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    flagged: modDecision.action === 'flag',
    moderation: modDecision.action === 'flag'
      ? { category: modDecision.category, guidance: modDecision.guidance }
      : null,
    user: {
      id: row.authorId,
      firstName: row.authorFirstName,
      lastName: row.authorLastName,
    },
  };
};
