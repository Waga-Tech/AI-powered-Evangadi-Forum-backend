import { GoogleGenAI } from "@google/genai";
import { safeExecute } from "../../../../db/config.js";
import { ServiceUnavailableError } from "../../../utils/errors/index.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

export const getQuestionByHash = async (questionHash) => {
  const sql = `
    SELECT title, content
    FROM questions
    WHERE question_hash = ?
  `;
  const rows = await safeExecute(sql, [questionHash]);
  return rows[0] || null;
};

export const evaluateAnswerFit = async (
  questionTitle,
  questionBody,
  draftAnswer,
) => {
  if (!ai) {
    throw new ServiceUnavailableError(
      "Answer fit service is not configured. Set GEMINI_API_KEY in backend/.env.",
    );
  }

  const prompt = `
You are an expert evaluator for a community Q&A forum.
A user has written a draft answer to the following question:

QUESTION TITLE: ${questionTitle}
QUESTION BODY: ${questionBody || "No additional description provided."}

DRAFT ANSWER:
${draftAnswer}

Evaluate how well the draft answer addresses the question. Respond ONLY in this exact JSON format with no extra text:
{
  "score": <number between 0 and 100>,
  "feedback": "<2-3 sentences of constructive feedback explaining the score>"
}

Scoring guide:
- 90-100: Directly and completely answers the question with clarity
- 70-89: Mostly answers the question but missing some details
- 50-69: Partially relevant but incomplete or slightly off-topic
- 30-49: Loosely related but does not clearly answer the question
- 0-29: Off-topic, unclear, or does not address the question at all
`;

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash-lite",
    contents: prompt,
  });

  const rawText = response.text?.trim();
  if (!rawText) {
    throw new ServiceUnavailableError("Gemini returned an empty response");
  }

  const cleaned = rawText.replace(/```json|```/g, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new ServiceUnavailableError("Gemini returned invalid JSON");
  }

  if (
    typeof parsed.score !== "number" ||
    parsed.score < 0 ||
    parsed.score > 100 ||
    typeof parsed.feedback !== "string" ||
    !parsed.feedback.trim()
  ) {
    throw new ServiceUnavailableError(
      "Gemini response missing valid score or feedback",
    );
  }

  return {
    score: parsed.score,
    feedback: parsed.feedback,
  };
};
