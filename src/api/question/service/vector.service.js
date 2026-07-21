import { GoogleGenAI } from "@google/genai";
import { safeExecute } from "../../../../db/config.js";
import "dotenv/config";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const GEMINI_TEXT_MODEL =
  process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash-lite";

// ---------------------------------------------------------------------------
// Embedding cache
//
// Module-level Map avoids hitting the DB and running JSON.parse on every
// search request. Invalidated when a new embedding is written so results
// stay consistent. Float32Array halves memory vs plain number[] for 768-dim
// vectors (4 bytes vs 8 bytes per element).
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const embeddingCache = {
  vectors: new Map(), // questionId (number) -> Float32Array
  loadedAt: 0,
};

const isCacheWarm = () =>
  Date.now() - embeddingCache.loadedAt < CACHE_TTL_MS;

const loadEmbeddingCache = async () => {
  const rows = await safeExecute(
    `SELECT question_id, embedding FROM question_vectors WHERE status = 'ready'`,
    [],
  );

  embeddingCache.vectors.clear();

  for (const row of rows) {
    try {
      const arr =
        typeof row.embedding === "string"
          ? JSON.parse(row.embedding)
          : row.embedding;
      embeddingCache.vectors.set(row.question_id, new Float32Array(arr));
    } catch {
      // Skip malformed rows — they stay in DB but won't affect search results.
    }
  }

  embeddingCache.loadedAt = Date.now();
};

// Called after a successful storeQuestionVector so the next search reloads.
export const invalidateEmbeddingCache = () => {
  embeddingCache.loadedAt = 0;
};

export const getEmbeddingCache = async () => {
  if (!isCacheWarm()) await loadEmbeddingCache();
  return embeddingCache.vectors;
};

// ---------------------------------------------------------------------------
// Text normalization
// ---------------------------------------------------------------------------

const normalizeWhiteSpaces = (value) => value.replace(/\s+/g, " ").trim();

export const normalizeQuestionText = ({ title, content }) => {
  const combined = `${title || ""} ${content || ""}`;
  return normalizeWhiteSpaces(combined.normalize("NFKC").toLowerCase());
};

// ---------------------------------------------------------------------------
// Gemini embedding
// ---------------------------------------------------------------------------

export const generateQuestionEmbedding = async (sourceText, options = {}) => {
  const { taskType = "RETRIEVAL_DOCUMENT" } = options;

  const response = await ai.models.embedContent({
    model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
    contents: sourceText,
    config: { taskType, outputDimensionality: 768 },
  });

  const values = response.embeddings[0].values;

  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Gemini embedding response doesn't contain values");
  }

  return { embedding: values };
};

// ---------------------------------------------------------------------------
// Gemini AI fallback answer (used by question.service when no matches found)
// ---------------------------------------------------------------------------

export const generateAIAnswer = async (query) => {
  const prompt = [
    "You are an assistant for Evangadi Forum, a Q&A community focused exclusively on software development, programming, and technology.",
    "",
    "A user submitted this search query:",
    `"${query}"`,
    "",
    "First, decide if this query is related to software development, programming, or technology.",
    "",
    "If it is NOT related, respond with exactly this (fill in the blank):",
    '"This question is outside the scope of Evangadi Forum. Our community focuses on software development, programming, and technology topics. Try asking something related to coding, frameworks, databases, or dev tools."',
    "",
    "If it IS related, answer it concisely in 2-4 sentences. Be accurate. Do not make up facts.",
  ].join("\n");

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: prompt,
    });
    return response?.text?.trim() || null;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Store / upsert vector
// ---------------------------------------------------------------------------

const validateEmbedding = (embedding) => {
  if (!Array.isArray(embedding)) throw new Error("Embedding must be array");
  if (embedding.length === 0) throw new Error("Embedding can't be empty");
  if (!embedding.every((v) => typeof v === "number" && !isNaN(v))) {
    throw new Error("Embedding must contain only valid numbers");
  }
};

export const storeQuestionVector = async ({
  questionId,
  sourceText,
  embedding = [],
  status = "ready",
}) => {
  const isFailed = status === "failed" || !embedding || embedding.length === 0;

  if (!isFailed) validateEmbedding(embedding);

  const sql = `
    INSERT INTO question_vectors (question_id, source_text, embedding, status)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      source_text = VALUES(source_text),
      embedding   = VALUES(embedding),
      status      = VALUES(status),
      updated_at  = CURRENT_TIMESTAMP
  `;

  await safeExecute(sql, [
    questionId,
    sourceText,
    isFailed ? JSON.stringify([]) : JSON.stringify(embedding),
    isFailed ? "failed" : status,
  ]);

  // Invalidate so the next search picks up the new vector.
  if (!isFailed) invalidateEmbeddingCache();
};
