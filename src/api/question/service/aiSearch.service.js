import { GoogleGenAI } from '@google/genai';
import { ServiceUnavailableError } from '../../../utils/errors/index.js';

const GEMINI_API_KEY  = process.env.GEMINI_API_KEY;
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';

const hasKey =
  typeof GEMINI_API_KEY === 'string' &&
  GEMINI_API_KEY.trim().length > 0 &&
  !['replace_with_your_gemini_api_key', 'your_gemini_api_key_here'].includes(GEMINI_API_KEY.trim());

const gemini = hasKey ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const buildPrompt = ({ title, content }) => [
  'You are a helpful AI assistant.',
  'A user asked the following question on a software development forum, but it was outside the forum\'s tech scope.',
  'Give them a concise, helpful answer (3-5 sentences) or point them to the right kind of resource.',
  'Be friendly and informative. Do not mention the forum or why the question was rejected.',
  '',
  `Question: ${title}`,
  `Details: ${content}`,
].join('\n');

/**
 * Generates a general-purpose AI answer for a question that was rejected
 * as off-topic from the tech forum. No topic restriction.
 */
export const generateAIContextService = async ({ title, content }) => {
  if (!gemini) {
    throw new ServiceUnavailableError('AI search is not configured.');
  }

  const prompt = buildPrompt({ title, content });

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await gemini.models.generateContent({
        model: GEMINI_TEXT_MODEL,
        contents: prompt,
      });
      const answer = response?.text?.trim() || null;
      if (!answer) throw new Error('Empty response');
      return { answer };
    } catch (err) {
      const retryable = err.status === 503 || String(err.message).toLowerCase().includes('high demand');
      if (attempt === 1 && retryable) {
        await sleep(2500);
        continue;
      }
      break;
    }
  }

  throw new ServiceUnavailableError('AI search is temporarily unavailable. Please try again shortly.');
};
