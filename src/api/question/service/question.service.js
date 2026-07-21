import crypto from "crypto";
import { safeExecute } from "../../../../db/config.js";
import { BadRequestError, ForbiddenError, NotFoundError, ConflictError } from "../../../utils/errors/index.js";
import {
  moderateContent,
  checkUserModerationStatus,
  persistModerationFlag,
} from "../../moderation/service/contentModerator.service.js";
import {
  generateQuestionEmbedding,
  generateAIAnswer,
  normalizeQuestionText,
  storeQuestionVector,
} from "./vector.service.js";
import {
  toNumberOrFallback,
  parseEmbedding,
  cosineSimilarity,
} from "../../../utils/vectorUtils.js";

const generateQuestionHash = () => {
  return crypto.randomBytes(8).toString("hex");
};

export const createQuestionWithVectorService = async ({ userId, title, content, force = false }) => {
  if (!userId) {
    throw new BadRequestError("User is required");
  }

  const userStatus = await checkUserModerationStatus(userId);
  if (!userStatus.allowed) {
    throw new ForbiddenError(userStatus.reason, 'USER_POSTING_RESTRICTED');
  }

  const modDecision = await moderateContent({ postType: 'question', title, content });

  if (modDecision.action === 'reject') {
    const err = new BadRequestError(
      modDecision.reason || 'Your question does not fit the scope of this forum.',
      'CONTENT_MODERATION_REJECTED',
    );
    err.guidance = modDecision.guidance;
    throw err;
  }

  // ── Duplicate detection ────────────────────────────────────────────────────
  // Generate embedding early so we can compare against the user's own history.
  const sourceText = normalizeQuestionText({ title, content });
  let newEmbedding = null;

  try {
    const { embedding } = await generateQuestionEmbedding(sourceText, { taskType: 'RETRIEVAL_DOCUMENT' });
    newEmbedding = embedding;
  } catch {
    // Embedding unavailable — skip duplicate check, don't block the post.
  }

  if (newEmbedding) {
    const existingRows = await safeExecute(
      `SELECT qv.question_id, qv.embedding, q.question_hash, q.title
       FROM question_vectors qv
       JOIN questions q ON q.question_id = qv.question_id
       WHERE q.user_id = ? AND qv.status = 'ready'`,
      [userId],
    );

    const SIMILARITY_THRESHOLD = 0.85;
    const similarQuestions = existingRows.filter(row => {
      const emb = parseEmbedding(row.embedding);
      return emb && cosineSimilarity(newEmbedding, emb) >= SIMILARITY_THRESHOLD;
    });

    if (similarQuestions.length >= 3) {
      // 3+ near-identical posts is suspected spam — flag for admin review.
      // Still insert the question so the content is visible to the admin.
      const questionHash = generateQuestionHash();
      const insertResult = await safeExecute(
        `INSERT INTO questions (question_hash, user_id, title, content) VALUES (?, ?, ?, ?)`,
        [questionHash, userId, title, content],
      );
      const questionId = insertResult.insertId;
      persistModerationFlag({
        postType: 'question',
        postId: questionId,
        authorId: userId,
        category: 'spam',
        score: 1,
        reason: `User posted ${similarQuestions.length} near-identical questions (duplicate spam).`,
      }).catch(e => console.error('[duplicate] Flag persist failed:', e.message));
      storeQuestionVector({ questionId, sourceText, embedding: newEmbedding, status: 'ready' })
        .catch(e => console.error('[vector] Store failed:', e.message));
      return {
        question: { id: questionId, questionHash, title, content, userId },
        flagged: true,
        moderation: { category: 'spam', guidance: 'Your question has been flagged for review due to repeated similar submissions.' },
      };
    }

    if (similarQuestions.length >= 1) {
      const match = similarQuestions[0];
      const err = new ConflictError(
        'You already have a very similar question posted.',
        'DUPLICATE_QUESTION',
      );
      err.existingQuestionHash = match.question_hash;
      err.existingQuestionTitle = match.title;
      throw err;
    }
  }
  // ── End duplicate detection ────────────────────────────────────────────────

  // ── Forum-wide similar question suggestion ────────────────────────────────
  // Warn the submitter if a very similar question already exists from any user.
  // Skipped when force=true (user explicitly chose to post anyway).
  if (newEmbedding && !force) {
    const FORUM_SIMILARITY_THRESHOLD = 0.88;
    const forumRows = await safeExecute(
      `SELECT qv.question_id, qv.embedding, q.question_hash, q.title
       FROM question_vectors qv
       JOIN questions q ON q.question_id = qv.question_id
       LEFT JOIN moderation_flags mf ON mf.post_type = 'question'
         AND mf.post_id = q.question_id AND mf.queue_status = 'pending'
       WHERE q.user_id != ? AND qv.status = 'ready' AND mf.flag_id IS NULL
       ORDER BY q.created_at DESC
       LIMIT 500`,
      [userId],
    );

    let bestSim = 0;
    let bestMatch = null;
    for (const row of forumRows) {
      const emb = parseEmbedding(row.embedding);
      if (!emb) continue;
      const sim = cosineSimilarity(newEmbedding, emb);
      if (sim > bestSim) { bestSim = sim; bestMatch = row; }
    }

    if (bestSim >= FORUM_SIMILARITY_THRESHOLD && bestMatch) {
      const err = new ConflictError(
        'A very similar question already exists in the forum.',
        'SIMILAR_QUESTION_EXISTS',
      );
      err.similarQuestionHash  = bestMatch.question_hash;
      err.similarQuestionTitle = bestMatch.title;
      throw err;
    }
  }
  // ── End forum-wide check ──────────────────────────────────────────────────

  const questionHash = generateQuestionHash();

  const insertResult = await safeExecute(
    `INSERT INTO questions (question_hash, user_id, title, content) VALUES (?, ?, ?, ?)`,
    [questionHash, userId, title, content],
  );

  const questionId = insertResult.insertId;

  if (modDecision.action === 'flag') {
    persistModerationFlag({
      postType: 'question',
      postId: questionId,
      authorId: userId,
      category: modDecision.category,
      score: modDecision.score,
      reason: modDecision.reason,
    }).catch(e => console.error('[moderation] Flag persist failed for question:', e.message));
  }

  // Embedding was already generated above for duplicate check — reuse it.
  if (newEmbedding) {
    await storeQuestionVector({ questionId, sourceText, embedding: newEmbedding, status: "ready" });
  } else {
    try {
      const { embedding } = await generateQuestionEmbedding(sourceText, { taskType: "RETRIEVAL_DOCUMENT" });
      await storeQuestionVector({ questionId, sourceText, embedding, status: "ready" });
    } catch (err) {
      console.warn(`[vector] Embedding failed for question ${questionId}:`, err.message);
      await storeQuestionVector({ questionId, sourceText, embedding: [], status: "failed" });
    }
  }

  return {
    question: { id: questionId, questionHash, title, content, userId },
    flagged: modDecision.action === 'flag',
    moderation: modDecision.action === 'flag'
      ? { category: modDecision.category, guidance: modDecision.guidance }
      : null,
  };
};

const buildQuestionFilters = (filters) => {
  // Always exclude pending-flagged questions, unless the viewer is the author.
  const conditions = ["(mf_pending.flag_id IS NULL OR q.user_id = ?)"];
  const params = [filters.userId ?? null];

  if (filters.search) {
    conditions.push("(q.title LIKE ? OR q.content LIKE ?)");
    const searchTerm = `%${filters.search}%`;
    params.push(searchTerm, searchTerm);
  }

  if (filters.mine && filters.userId) {
    conditions.push("q.user_id = ?");
    params.push(filters.userId);
  }

  return { whereClause: `WHERE ${conditions.join(" AND ")}`, params };
};

const fetchQuestionDetailsByIds = async (ids) => {
  if (!ids || ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => "?").join(", ");
  const detailsSql = `
    SELECT
      q.question_id AS id,
      q.question_hash AS questionHash,
      q.title,
      q.content,
      q.created_at AS createdAt,
      q.updated_at AS updatedAt,
      u.user_id AS userId,
      u.first_name AS firstName,
      u.last_name AS lastName,
      COUNT(DISTINCT a.answer_id) AS answerCount
    FROM questions q
    JOIN users u
      ON u.user_id = q.user_id
    LEFT JOIN answers a
      ON a.question_id = q.question_id
    WHERE q.question_id IN (${placeholders})
    GROUP BY
      q.question_id,
      q.question_hash,
      q.title,
      q.content,
      q.created_at,
      q.updated_at,
      u.user_id,
      u.first_name,
      u.last_name
  `;

  return safeExecute(detailsSql, ids);
};

const toQuestionWithAuthor = (question) => {
  if (!question) {
    return question;
  }

  const { userId, firstName, lastName, ...rest } = question;

  return {
    ...rest,
    author: {
      id: userId,
      firstName,
      lastName,
    },
  };
};

const searchQuestionsLexicalFallback = async ({ query, limit }) => {
  return getQuestionsService({ search: query }).then((rows) =>
    rows.slice(0, limit),
  );
};

const getSimilarQuestionsLexicalFallback = async ({
  sourceQuestionId,
  limit,
}) => {
  const sourceSql = `
    SELECT q.title, q.content
    FROM questions q
    WHERE q.question_id = ?
    LIMIT 1
  `;

  const sourceRows = await safeExecute(sourceSql, [sourceQuestionId]);
  const source = sourceRows[0] || {};
  const raw = `${source.title || ""} ${source.content || ""}`.toLowerCase();
  const tokens = Array.from(
    new Set(raw.split(/[^a-z0-9]+/).filter((token) => token.length >= 4)),
  ).slice(0, 6);

  const conditions = [];
  const params = [];

  for (const token of tokens) {
    conditions.push("(q.title LIKE ? OR q.content LIKE ?)");
    const like = `%${token}%`;
    params.push(like, like);
  }

  const whereSearch =
    conditions.length > 0 ? `AND (${conditions.join(" OR ")})` : "";

  const fallbackSql = `
    SELECT
      q.question_id AS id,
      q.question_hash AS questionHash,
      q.title,
      q.content,
      q.created_at AS createdAt,
      q.updated_at AS updatedAt,
      u.user_id AS userId,
      u.first_name AS firstName,
      u.last_name AS lastName,
      COUNT(DISTINCT a.answer_id) AS answerCount
    FROM questions q
    JOIN users u
      ON u.user_id = q.user_id
    LEFT JOIN answers a
      ON a.question_id = q.question_id
    WHERE q.question_id <> ?
    ${whereSearch}
    GROUP BY
      q.question_id,
      q.question_hash,
      q.title,
      q.content,
      q.created_at,
      q.updated_at,
      u.user_id,
      u.first_name,
      u.last_name
    ORDER BY q.created_at DESC
    LIMIT ${limit}
  `;

  const lexicalRows = await safeExecute(fallbackSql, [
    sourceQuestionId,
    ...params,
  ]);

  if (lexicalRows.length > 0 || conditions.length === 0) {
    return lexicalRows;
  }

  const broadFallbackSql = `
    SELECT
      q.question_id AS id,
      q.question_hash AS questionHash,
      q.title,
      q.content,
      q.created_at AS createdAt,
      q.updated_at AS updatedAt,
      u.user_id AS userId,
      u.first_name AS firstName,
      u.last_name AS lastName,
      COUNT(DISTINCT a.answer_id) AS answerCount
    FROM questions q
    JOIN users u
      ON u.user_id = q.user_id
    LEFT JOIN answers a
      ON a.question_id = q.question_id
    WHERE q.question_id <> ?
    GROUP BY
      q.question_id,
      q.question_hash,
      q.title,
      q.content,
      q.created_at,
      q.updated_at,
      u.user_id,
      u.first_name,
      u.last_name
    ORDER BY q.created_at DESC
    LIMIT ${limit}
  `;

  return safeExecute(broadFallbackSql, [sourceQuestionId]);
};
export const getQuestionsService = async (filters = {}) => {
  const normalizedLimit = 100;
  const sortColumn = "q.created_at";
  const normalizedSortOrder = "DESC";

  const { whereClause, params } = buildQuestionFilters(filters);

  const listSql = `
    SELECT
      q.question_id AS id,
      q.question_hash AS questionHash,
      q.title,
      q.content,
      q.created_at AS createdAt,
      q.updated_at AS updatedAt,
      u.user_id AS userId,
      u.first_name AS firstName,
      u.last_name AS lastName,
      COUNT(DISTINCT a.answer_id) AS answerCount
    FROM questions q
    JOIN users u
      ON u.user_id = q.user_id
    LEFT JOIN answers a
      ON a.question_id = q.question_id
    LEFT JOIN moderation_flags mf_pending
      ON mf_pending.post_type = 'question'
      AND mf_pending.post_id = q.question_id
      AND mf_pending.queue_status = 'pending'
    ${whereClause}
    GROUP BY
      q.question_id,
      q.question_hash,
      q.title,
      q.content,
      q.created_at,
      q.updated_at,
      u.user_id,
      u.first_name,
      u.last_name
    ORDER BY ${sortColumn} ${normalizedSortOrder}
    LIMIT ${normalizedLimit}
  `;

  return safeExecute(listSql, params);
};
export const getSingleQuestionService = async ({ questionHash, viewerId = null }) => {
  const normalizedAnswerLimit = 100;

  const questionSql = `
    SELECT
      q.question_id AS id,
      q.question_hash AS questionHash,
      q.title,
      q.content,
      q.created_at AS createdAt,
      q.updated_at AS updatedAt,
      u.user_id AS userId,
      u.first_name AS firstName,
      u.last_name AS lastName,
      COUNT(DISTINCT a.answer_id) AS answerCount
    FROM questions q
    JOIN users u
      ON u.user_id = q.user_id
    LEFT JOIN answers a
      ON a.question_id = q.question_id
    LEFT JOIN moderation_flags mf_pending
      ON mf_pending.post_type = 'question'
      AND mf_pending.post_id = q.question_id
      AND mf_pending.queue_status = 'pending'
    WHERE q.question_hash = ?
      AND (mf_pending.flag_id IS NULL OR q.user_id = ?)
    GROUP BY
      q.question_id,
      q.question_hash,
      q.title,
      q.content,
      q.created_at,
      q.updated_at,
      u.user_id,
      u.first_name,
      u.last_name
  `;

  // viewerId is the author guard: a pending-flagged question is hidden (404) from
  // everyone except its author, matching how pending answers are hidden below.
  const questionRows = await safeExecute(questionSql, [questionHash, viewerId]);

  if (questionRows.length === 0) {
    throw new NotFoundError("Question not found");
  }

  const question = questionRows[0];

  const answersSql = `
    SELECT
      a.answer_id AS id,
      a.content,
      a.created_at AS createdAt,
      a.updated_at AS updatedAt,
      au.user_id AS userId,
      au.first_name AS userFirstName,
      au.last_name AS userLastName,
      COUNT(DISTINCT av.user_id) AS voteCount,
      MAX(CASE WHEN av.user_id = ? THEN 1 ELSE 0 END) AS userHasVoted
    FROM answers a
    JOIN users au ON au.user_id = a.user_id
    LEFT JOIN answer_votes av ON av.answer_id = a.answer_id
    LEFT JOIN moderation_flags mf_pending
      ON mf_pending.post_type = 'answer'
      AND mf_pending.post_id = a.answer_id
      AND mf_pending.queue_status = 'pending'
    WHERE a.question_id = ?
      AND (mf_pending.flag_id IS NULL OR a.user_id = ?)
    GROUP BY a.answer_id, a.content, a.created_at, a.updated_at,
             au.user_id, au.first_name, au.last_name
    ORDER BY a.created_at DESC
    LIMIT ${normalizedAnswerLimit}
  `;

  const answerRows = await safeExecute(answersSql, [viewerId, question.id, viewerId]);
  const answers = answerRows.map((row) => ({
    id: row.id,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    voteCount: Number(row.voteCount),
    userHasVoted: Boolean(Number(row.userHasVoted)),
    user: {
      id: row.userId,
      firstName: row.userFirstName,
      lastName: row.userLastName,
    },
  }));

  return {
    ...question,
    answers,
  };
};

export const searchQuestionsSemanticService = async ({
  query,
  k,
  threshold,
}) => {
  const normalizedQuery = typeof query === "string" ? query.trim() : "";

  if (!normalizedQuery) {
    throw new BadRequestError("Query is required");
  }

  const limit = Math.max(1, Math.min(20, toNumberOrFallback(k, 5)));
  const searchThreshold = Math.max(
    0,
    Math.min(1, toNumberOrFallback(threshold, 0.75)),
  );

  const normalizedText = normalizeQuestionText({ title: normalizedQuery });

  // Attempt vector embedding. On failure (rate limit, network error) fall back to
  // lexical search so the user still gets results instead of a 500.
  let queryEmbedding = null;
  try {
    const result = await generateQuestionEmbedding(normalizedText, { taskType: "RETRIEVAL_QUERY" });
    queryEmbedding = result.embedding;
  } catch (embeddingErr) {
    console.warn("[search] Embedding failed, using lexical fallback:", embeddingErr.message);
  }

  // Run AI answer and DB fetch in parallel (both are independent of each other).
  const vectorsSql = `
    SELECT qv.question_id AS questionId, qv.embedding
    FROM question_vectors qv
    WHERE qv.status = 'ready'
  `;

  const [vectorRows, aiAnswer] = await Promise.all([
    safeExecute(vectorsSql, []),
    generateAIAnswer(normalizedQuery),
  ]);

  // If embedding failed or no vectors stored, fall back to keyword search.
  if (!queryEmbedding || vectorRows.length === 0) {
    const fallbackData = await searchQuestionsLexicalFallback({ query: normalizedQuery, limit });

    return {
      data: fallbackData.map(toQuestionWithAuthor),
      aiAnswer,
      meta: { total: fallbackData.length, k: limit, threshold: searchThreshold },
    };
  }

  const scored = [];

  for (const row of vectorRows) {
    const vector = parseEmbedding(row.embedding);
    if (!Array.isArray(vector) || vector.length === 0) continue;
    scored.push({ questionId: row.questionId, score: cosineSimilarity(queryEmbedding, vector) });
  }

  const thresholdMatches = scored.filter((item) => item.score >= searchThreshold);
  // Strict threshold: if nothing passes, return empty so the AI answer card
  // explains why — never surface low-score results as "matches".
  if (thresholdMatches.length === 0) {
    return {
      data: [],
      aiAnswer,
      meta: { total: 0, k: limit, threshold: searchThreshold },
    };
  }

  const top = thresholdMatches.sort((a, b) => b.score - a.score).slice(0, limit);

  const ids = top.map((item) => item.questionId);
  const detailRows = await fetchQuestionDetailsByIds(ids);
  const detailsById = new Map(detailRows.map((row) => [row.id, row]));

  const data = top
    .map((item) => {
      const question = detailsById.get(item.questionId);
      if (!question) return null;
      return { ...toQuestionWithAuthor(question), score: item.score };
    })
    .filter(Boolean);

  return {
    data,
    aiAnswer,
    meta: { total: data.length, k: limit, threshold: searchThreshold },
  };
};


export const getSimilarQuestionsService = async ({
  questionHash,
  k,
  threshold,
}) => {
  const limit = Math.max(1, Math.min(20, toNumberOrFallback(k, 5)));
  const searchThreshold = Math.max(
    0,
    Math.min(1, toNumberOrFallback(threshold, 0.75)),
  );

  const baseQuestionSql = `
    SELECT q.question_id AS id
    FROM questions q
    WHERE q.question_hash = ?
    LIMIT 1
  `;

  const baseQuestionRows = await safeExecute(baseQuestionSql, [questionHash]);

  if (baseQuestionRows.length === 0) {
    throw new NotFoundError("Question not found");
  }

  const sourceQuestionId = baseQuestionRows[0].id;

  const sourceVectorSql = `
    SELECT qv.embedding
    FROM question_vectors qv
    WHERE qv.question_id = ? AND qv.status = 'ready'
    LIMIT 1
  `;

  const sourceVectorRows = await safeExecute(sourceVectorSql, [sourceQuestionId]);

  if (sourceVectorRows.length === 0) {
    const fallbackData = await getSimilarQuestionsLexicalFallback({
      sourceQuestionId,
      limit,
    });

    return {
      data: fallbackData.map(toQuestionWithAuthor),
      meta: { total: fallbackData.length, k: limit, threshold: searchThreshold },
    };
  }

  const sourceEmbedding = parseEmbedding(sourceVectorRows[0].embedding);

  if (!Array.isArray(sourceEmbedding) || sourceEmbedding.length === 0) {
    const fallbackData = await getSimilarQuestionsLexicalFallback({
      sourceQuestionId,
      limit,
    });

    return {
      data: fallbackData.map(toQuestionWithAuthor),
      meta: { total: fallbackData.length, k: limit, threshold: searchThreshold },
    };
  }

  const candidateSql = `
    SELECT qv.question_id AS questionId, qv.embedding
    FROM question_vectors qv
    WHERE qv.status = 'ready' AND qv.question_id <> ?
  `;

  const candidateRows = await safeExecute(candidateSql, [sourceQuestionId]);
  const scored = [];

  for (const row of candidateRows) {
    const vector = parseEmbedding(row.embedding);

    if (!Array.isArray(vector) || vector.length === 0) {
      continue;
    }

    const score = cosineSimilarity(sourceEmbedding, vector);
    scored.push({ questionId: row.questionId, score });
  }

  // Strict threshold: if nothing passes, return empty so the UI can
  // explain why — never surface low-score results as "similar".
  const thresholdMatches = scored.filter((item) => item.score >= searchThreshold);

  if (thresholdMatches.length === 0) {
    return { data: [], meta: { total: 0, k: limit, threshold: searchThreshold } };
  }

  const top = thresholdMatches.sort((a, b) => b.score - a.score).slice(0, limit);
  const ids = top.map((item) => item.questionId);
  const detailRows = await fetchQuestionDetailsByIds(ids);
  const detailsById = new Map(detailRows.map((row) => [row.id, row]));

  const data = top
    .map((item) => {
      const question = detailsById.get(item.questionId);

      if (!question) {
        return null;
      }

      return {
        ...toQuestionWithAuthor(question),
        score: item.score,
      };
    })
    .filter(Boolean);

  return {
    data,
    meta: {
      total: data.length,
      k: limit,
      threshold: searchThreshold,
    },
  };
};
