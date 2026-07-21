import { GoogleGenAI } from '@google/genai';
import { safeExecute } from '../../../../db/config.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash-lite';
const MODERATION_TIMEOUT_MS = 8000;

const hasConfiguredGeminiKey =
  typeof GEMINI_API_KEY === 'string' &&
  GEMINI_API_KEY.trim().length > 0 &&
  !['replace_with_your_gemini_api_key', 'your_gemini_api_key_here'].includes(
    GEMINI_API_KEY.trim(),
  );

const gemini = hasConfiguredGeminiKey
  ? new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  : null;

// ── Prompt builder ────────────────────────────────────────────────────────────

const buildModerationPrompt = ({ postType, title, content, questionContext }) => {
  const post = postType === 'question'
    ? `Title: ${(title || '').slice(0, 120)}\nContent: ${(content || '').slice(0, 300)}`
    : `Question: ${(questionContext || '').slice(0, 150)}\nAnswer: ${(content || '').slice(0, 300)}`;

  return [
    'Tech Q&A forum moderator. Return JSON only, no extra text.',
    '{"action":"allow"|"reject"|"flag","category":"spam"|"harassment"|"off_topic"|"low_quality"|null,"score":0.0-1.0,"reason":"one sentence","guidance":"one sentence"}',
    'Rules: allow=tech/fine, reject=non-tech/off-topic, flag=spam/hate/harassment. Default to allow when unsure.',
    '',
    post,
  ].join('\n');
};

// ── Response parser ───────────────────────────────────────────────────────────

const VALID_ACTIONS = ['allow', 'reject', 'flag'];
const VALID_CATEGORIES = ['spam', 'harassment', 'off_topic', 'low_quality', null];

const parseModerationResponse = rawText => {
  const tryParse = text => {
    try { return JSON.parse(text); } catch { return null; }
  };

  let parsed =
    tryParse(rawText) ||
    tryParse((rawText.match(/```json\s*([\s\S]*?)\s*```/i) || [])[1]);

  if (!parsed) {
    return { action: 'allow', category: null, score: 0, reason: 'Parse failed — defaulting to allow.', guidance: '' };
  }

  const action = VALID_ACTIONS.includes(parsed.action) ? parsed.action : 'allow';
  const category = VALID_CATEGORIES.includes(parsed.category) ? parsed.category : null;
  const score = typeof parsed.score === 'number'
    ? Math.max(0, Math.min(1, parsed.score))
    : 0;

  return {
    action,
    category: action === 'allow' ? null : category,
    score,
    reason:   typeof parsed.reason   === 'string' ? parsed.reason.trim()   : '',
    guidance: typeof parsed.guidance === 'string' ? parsed.guidance.trim() : '',
  };
};

// ── Keyword fallback (runs when Gemini is unavailable) ───────────────────────
// Only reject when the content has multiple obvious non-tech signals AND no
// tech signals. One keyword match is treated as uncertain → allow.

const TECH_SIGNALS = [
  'code', 'error', 'bug', 'function', 'api', 'database', 'server', 'query',
  'npm', 'git', 'react', 'node', 'python', 'java', 'sql', 'css', 'html',
  'javascript', 'typescript', 'frontend', 'backend', 'deploy', 'docker',
  'aws', 'github', 'webpack', 'express', 'async', 'callback', 'promise',
  'component', 'hook', 'state', 'props', 'endpoint', 'request', 'response',
  'import', 'module', 'class', 'object', 'array', 'loop', 'variable',
];

const OFF_TOPIC_SIGNALS = [
  'marathon', 'running plan', 'training plan', 'cardio', 'bodybuilding',
  'weight loss', 'lose weight', 'losing weight', 'diet plan', 'calories', 'calorie deficit',
  'workout', 'gym routine', 'miles per week', 'intermittent fasting', 'keto diet',
  'recipe', 'cooking', 'baking', 'ingredients', 'meal prep',
  'vacation', 'travel tips', 'hotel', 'tourism', 'flight booking',
  'movie review', 'netflix series', 'music playlist',
  'dating advice', 'relationship advice',
  'football game', 'soccer match', 'basketball score',
  'stock market tips', 'crypto trading', 'forex',
];

// Spam/harassment signals → flag (goes to mod queue, not outright rejected)
const SPAM_SIGNALS = [
  'click here', 'buy now', 'buy cheap', 'buy followers', 'get followers',
  'cheap followers', 'promo code', 'discount code', 'limited offer', 'limited time offer',
  'act now', 'dm us', 'dm me', 'message us', 'whatsapp us',
  'earn money fast', 'make money online', 'work from home opportunity',
  'free trial', 'sign up now', 'guaranteed results',
  'best prices', 'lowest prices', 'cheapest',
];

const HARASSMENT_SIGNALS = [
  'kill yourself', 'kys', 'you are stupid', "you're stupid", 'idiot', 'moron',
  'go to hell', 'shut up', 'worthless', 'loser',
];

const keywordFallback = ({ title = '', content = '' }) => {
  const text = `${title} ${content}`.toLowerCase();

  // Harassment — flag regardless of tech signals (hate speech overrides everything)
  const harassHits = HARASSMENT_SIGNALS.filter(k => text.includes(k));
  if (harassHits.length >= 1) {
    return {
      action: 'flag',
      category: 'harassment',
      score: 0.95,
      reason: 'This post contains language that may violate community guidelines.',
      guidance: 'Please keep all posts respectful and professional.',
    };
  }

  // Spam — flag when 2+ signals match, even if tech keywords present
  const spamHits = SPAM_SIGNALS.filter(k => text.includes(k));
  if (spamHits.length >= 2) {
    return {
      action: 'flag',
      category: 'spam',
      score: 0.9,
      reason: 'This post appears to contain promotional or spam content.',
      guidance: 'Posts must be genuine questions or answers related to software development.',
    };
  }

  // Off-topic — reject when 2+ signals and no tech signals
  if (!TECH_SIGNALS.some(k => text.includes(k))) {
    const offHits = OFF_TOPIC_SIGNALS.filter(k => text.includes(k));
    if (offHits.length >= 2) {
      return {
        action: 'reject',
        category: 'off_topic',
        score: 0.9,
        reason: 'This question does not appear to be related to software or technology.',
        guidance: 'This forum is for programming and software development questions. Rephrase to focus on a technical aspect.',
      };
    }
  }

  return { action: 'allow', category: null, score: 0, reason: '', guidance: '' };
};

// ── Core moderation call ──────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

const isRetryable = err =>
  err.status === 503 ||
  err.status === 429 ||
  String(err.message).toLowerCase().includes('high demand') ||
  String(err.message).toLowerCase().includes('quota');

const callGemini = async ({ postType, title, content, questionContext }) => {
  const prompt = buildModerationPrompt({ postType, title, content, questionContext });

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const call = gemini.models.generateContent({
        model: GEMINI_TEXT_MODEL,
        contents: prompt,
      });
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), MODERATION_TIMEOUT_MS)
      );
      return await Promise.race([call, timeout]);
    } catch (err) {
      if (attempt === 1 && isRetryable(err)) {
        await sleep(2500);
        continue;
      }
      throw err;
    }
  }
};

// ── Flag persistence ──────────────────────────────────────────────────────────

export const persistModerationFlag = async ({ postType, postId, authorId, category, score, reason }) => {
  await safeExecute(
    `INSERT INTO moderation_flags
       (post_type, post_id, author_id, category, moderation_score, ai_reason, queue_status, flagged_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW())`,
    [postType, postId, authorId, category, score, reason],
  );
};

// ── User moderation status check ──────────────────────────────────────────────

export const checkUserModerationStatus = async userId => {
  const rows = await safeExecute(
    `SELECT status, blocked_until FROM user_moderation_status WHERE user_id = ? LIMIT 1`,
    [userId],
  );
  if (!rows.length) return { allowed: true };

  const { status, blocked_until } = rows[0];

  if (status === 'removed') {
    return { allowed: false, reason: 'Your account has been removed.' };
  }

  if (status === 'blocked') {
    const until = blocked_until ? new Date(blocked_until) : null;
    if (!until || until > new Date()) {
      const untilStr = until ? until.toLocaleDateString() : 'further notice';
      return {
        allowed: false,
        reason: `Your account is temporarily blocked until ${untilStr}. Please review our community guidelines.`,
      };
    }
  }

  if (status === 'limited') {
    return {
      allowed: false,
      reason: 'Your posting is currently limited pending admin review of a previous post.',
    };
  }

  return { allowed: true };
};

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Moderate a post before it is persisted.
 * Returns { action, category, score, reason, guidance }.
 * Fails open: if Gemini is unavailable or times out, returns 'allow'.
 */
export const moderateContent = async ({ postType, title = '', content, questionContext = '' }) => {
  if (!gemini) {
    return keywordFallback({ title, content });
  }

  try {
    const response = await callGemini({ postType, title, content, questionContext });
    return parseModerationResponse(response?.text || '');
  } catch (err) {
    const isUnavailable =
      isRetryable(err) ||
      String(err.message).toLowerCase().includes('timeout') ||
      String(err.message).toLowerCase().includes('503');

    if (isUnavailable) {
      // Gemini is down — use keyword fallback for obvious off-topic, otherwise allow.
      console.warn('[moderation] Gemini unavailable, using keyword fallback.');
      return keywordFallback({ title, content });
    }

    console.error('[moderation] Gemini call failed, defaulting to allow:', err.message);
    return { action: 'allow', category: null, score: 0, reason: 'Moderation unavailable.', guidance: '' };
  }
};
