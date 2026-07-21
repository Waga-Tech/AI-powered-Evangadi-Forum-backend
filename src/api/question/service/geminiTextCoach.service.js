import { GoogleGenAI } from '@google/genai';
import { ServiceUnavailableError } from '../../../utils/errors/index.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash-lite';

const hasConfiguredGeminiKey =
  typeof GEMINI_API_KEY === 'string' &&
  GEMINI_API_KEY.trim().length > 0 &&
  !['replace_with_your_gemini_api_key', 'your_gemini_api_key_here'].includes(
    GEMINI_API_KEY.trim(),
  );

const gemini = hasConfiguredGeminiKey
  ? new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  : null;

const buildDraftCoachPrompt = ({ title, content }) => {
  return [
    'You are a programming forum draft coach.',
    'Review the question draft and provide concise, actionable feedback.',
    'Focus on clarity, reproducibility, formatting, and completeness.',
    'Return STRICT JSON using this shape:',
    '{"feedback":"string","suggestions":["string"]}',
    '',
    `Title: ${title || '(not provided)'}`,
    '',
    'Content:',
    content,
  ].join('\n');
};

const parseDraftCoachResponse = rawText => {
  if (!rawText || typeof rawText !== 'string') {
    return {
      feedback: 'No feedback generated.',
      suggestions: [],
    };
  }

  // Try direct JSON first.
  try {
    const parsed = JSON.parse(rawText);
    const suggestions = Array.isArray(parsed?.suggestions)
      ? parsed.suggestions.filter(item => typeof item === 'string')
      : [];

    return {
      feedback:
        typeof parsed?.feedback === 'string'
          ? parsed.feedback
          : 'Review generated successfully.',
      suggestions,
    };
  } catch {
    // Continue with fenced JSON parsing.
  }

  const fencedMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    try {
      const parsed = JSON.parse(fencedMatch[1]);
      const suggestions = Array.isArray(parsed?.suggestions)
        ? parsed.suggestions.filter(item => typeof item === 'string')
        : [];

      return {
        feedback:
          typeof parsed?.feedback === 'string'
            ? parsed.feedback
            : 'Review generated successfully.',
        suggestions,
      };
    } catch {
      // Fall through to text fallback.
    }
  }

  const lines = rawText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  return {
    feedback: lines[0] || 'Review generated successfully.',
    suggestions: lines.slice(1, 6),
  };
};

/**
 * Generates draft coaching feedback for a forum question.
 */
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const generateQuestionDraftCoachService = async ({ title, content }) => {
  if (!gemini) {
    throw new ServiceUnavailableError(
      'Draft coach service is not configured. Set a valid GEMINI_API_KEY in backend/.env.',
    );
  }

  const prompt = buildDraftCoachPrompt({ title, content });

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await gemini.models.generateContent({
        model: GEMINI_TEXT_MODEL,
        contents: prompt,
      });
      return parseDraftCoachResponse(response?.text || '');
    } catch (error) {
      const msg = String(error?.message || '').toLowerCase();

      if (msg.includes('api key') || msg.includes('permission') || msg.includes('unauthorized')) {
        throw new ServiceUnavailableError(
          'Draft coach service is not configured correctly. Check GEMINI_API_KEY in backend/.env.',
        );
      }

      const retryable = error.status === 503 || msg.includes('high demand');
      if (attempt === 1 && retryable) {
        await sleep(2500);
        continue;
      }
      break;
    }
  }

  throw new ServiceUnavailableError('Draft coach service is temporarily unavailable.');
};
