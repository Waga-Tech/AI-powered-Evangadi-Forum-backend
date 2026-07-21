/**
 * One-time script: re-embeds all existing questions using title + content.
 * Run: node scripts/reembed-questions.js
 *
 * Safe to run multiple times — uses ON DUPLICATE KEY UPDATE in storeQuestionVector.
 */
import { safeExecute } from '../db/config.js';
import {
  generateQuestionEmbedding,
  normalizeQuestionText,
  storeQuestionVector,
} from '../src/api/question/service/vector.service.js';

const DELAY_MS = 500; // pause between Gemini calls to avoid rate limiting

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const run = async () => {
  console.log('Fetching all questions...');

  const questions = await safeExecute(
    `SELECT question_id AS id, title, content FROM questions ORDER BY question_id ASC`,
    [],
  );

  console.log(`Found ${questions.length} question(s). Starting re-embed...\n`);

  let success = 0;
  let failed = 0;

  for (const q of questions) {
    const sourceText = normalizeQuestionText({ title: q.title, content: q.content });

    try {
      const { embedding } = await generateQuestionEmbedding(sourceText, {
        taskType: 'RETRIEVAL_DOCUMENT',
      });

      await storeQuestionVector({
        questionId: q.id,
        sourceText,
        embedding,
        status: 'ready',
      });

      console.log(`  ✓ [${q.id}] ${q.title.slice(0, 60)}`);
      success++;
    } catch (err) {
      console.error(`  ✗ [${q.id}] ${q.title.slice(0, 60)} — ${err.message}`);

      await storeQuestionVector({
        questionId: q.id,
        sourceText,
        embedding: [],
        status: 'failed',
      });

      failed++;
    }

    if (questions.indexOf(q) < questions.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\nDone. ${success} succeeded, ${failed} failed.`);
  process.exit(0);
};

run().catch((err) => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
