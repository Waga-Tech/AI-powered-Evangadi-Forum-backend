/**
 * One-time script: re-embeds all existing RAG document chunks at the current
 * RAG_EMBEDDING_DIM (see backend/src/utils/ragGemini.js). Run this after changing
 * the RAG embedding dimensionality so the stored chunk vectors match newly-embedded
 * queries — otherwise cosine similarity returns 0 for the old (different-size) vectors.
 *
 * Run from the backend/ directory:  node scripts/reembed-rag-chunks.js
 * Safe to run multiple times.
 */
import { safeExecute } from "../db/config.js";
import { getDocumentEmbedding } from "../src/utils/ragGemini.js";

// Mark a chunk vector non-ready so the search/ask paths (which filter on
// status = 'ready') ignore it until a successful re-embed — never leave a stale,
// wrong-dimension vector marked 'ready'.
const markFailed = (chunkId) =>
  safeExecute(
    `UPDATE document_chunk_vectors SET status = 'failed' WHERE chunk_id = ?`,
    [chunkId]
  );

async function main() {
  const rows = await safeExecute(
    `SELECT dcv.chunk_id AS chunkId,
            COALESCE(dcv.source_text, dc.content) AS text
     FROM document_chunk_vectors dcv
     JOIN document_chunks dc ON dc.chunk_id = dcv.chunk_id
     ORDER BY dcv.chunk_id`,
    []
  );

  console.log(`Re-embedding ${rows.length} chunk(s)...`);
  let ok = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.text || !row.text.trim()) {
      await markFailed(row.chunkId);
      failed++;
      continue;
    }
    try {
      const embedding = await getDocumentEmbedding(row.text);
      await safeExecute(
        `UPDATE document_chunk_vectors SET embedding = ?, status = 'ready' WHERE chunk_id = ?`,
        [JSON.stringify(embedding), row.chunkId]
      );
      ok++;
      if (ok % 25 === 0) console.log(`  ...${ok} done`);
    } catch (err) {
      failed++;
      console.error(`  chunk ${row.chunkId} failed: ${err.message}`);
      // Don't leave a stale 'ready' vector behind on failure.
      await markFailed(row.chunkId).catch(() => {});
    }
  }

  console.log(
    `Done. Re-embedded ${ok} chunk(s)${failed ? `, ${failed} skipped/failed.` : "."}`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
