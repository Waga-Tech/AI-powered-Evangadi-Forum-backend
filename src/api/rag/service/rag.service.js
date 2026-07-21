import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { safeExecute } from "../../../../db/config.js";
import { extractTextFromPDF } from "../../../utils/pdfParser.js";
import { chunkText } from "../../../utils/chunk.js";
import { NotFoundError, BadRequestError } from "../../../utils/errors/index.js";
import {
  toNumberOrFallback,
  parseEmbedding,
  cosineSimilarity,
} from "../../../utils/vectorUtils.js";
import {
  getDocumentEmbedding,
  getQueryEmbedding,
  answerFromRagChunksService,
} from "../../../utils/ragGemini.js";

// Backend root directory (.../backend), used to resolve relative storage paths.
// service dir = .../backend/src/api/rag/service → four levels up is backend/.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../../../../");

// Removes the PDF from disk. A missing file (ENOENT) is treated as success
// since the end state — file gone — is what we want. Other errors (e.g.
// permission denied) are surfaced so we don't drop the DB record while the
// file lingers on disk.
const removeFileFromDisk = async (storagePath) => {
  if (!storagePath) {
    return;
  }
  const absolutePath = path.isAbsolute(storagePath)
    ? storagePath
    : path.resolve(BACKEND_ROOT, storagePath);
  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return; // Already gone — nothing to do.
    }
    throw error;
  }
};

export const deleteDocumentService = async ({ documentId, userId }) => {
  // Look up the document first so we can return a clean 404 when the id
  // doesn't exist, rather than silently deleting nothing.
  const documents = await safeExecute(
    `
      SELECT document_id, user_id, storage_path
      FROM documents
      WHERE document_id = ?
      LIMIT 1
    `,
    [documentId],
  );

  if (!documents || documents.length === 0) {
    throw new NotFoundError("Document not found");
  }

  const document = documents[0];

  // A document may only be deleted by its owner. Respond with 404 (not 403)
  // for someone else's document so the endpoint doesn't reveal that an id
  // belonging to another user exists.
  if (Number(document.user_id) !== Number(userId)) {
    throw new NotFoundError("Document not found");
  }

  // Remove the PDF from disk before deleting the DB row, so a failure here
  // doesn't leave an orphaned file with no record pointing at it.
  await removeFileFromDisk(document.storage_path);

  // Delete the record. ON DELETE CASCADE on document_chunks (and in turn
  // document_chunk_vectors) removes all chunks and embeddings automatically.
  await safeExecute(
    `
      DELETE FROM documents
      WHERE document_id = ?
      LIMIT 1
    `,
    [documentId],
  );

  return { id: documentId };
};

export const getDocumentMetaService = async (documentId, userId) => {
  const sql = `
    SELECT
      d.document_id AS documentId,
      d.title,
      d.mime_type AS mimeType,
      d.byte_size AS byteSize,
      d.status,
      d.error_message AS errorMessage,
      d.created_at AS createdAt,
      d.updated_at AS updatedAt
    FROM documents d
    WHERE d.document_id = ? AND d.user_id = ?
    LIMIT 1
  `;

  const rows = await safeExecute(sql, [documentId, userId]);

  if (!rows || rows.length === 0) {
    throw new NotFoundError(`Document with id ${documentId} not found.`);
  }

  return rows[0];
};

export const listDocumentsForUserService = async ({ userId }) => {
  if (!userId) {
    throw new BadRequestError('User is required');
  }

  const normalizedLimit = 100;

  const sql = `
    SELECT
      document_id AS documentId,
      title,
      mime_type AS mimeType,
      byte_size AS byteSize,
      status,
      error_message AS errorMessage,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM documents
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ${normalizedLimit}
  `;

  const rows = await safeExecute(sql, [userId]);

  return rows;

};
export const searchInDocumentService = async ({
  documentId,
  userId,
  query,
  k,
}) => {
  const normalizedQuery = typeof query === "string" ? query.trim() : "";

  if (!normalizedQuery) {
    throw new BadRequestError("Query is required");
  }

  const limit = Math.max(1, Math.min(20, toNumberOrFallback(k, 5)));

  // Step 1 - Verify document ownership and status
  const docSql = `
    SELECT document_id, status
    FROM documents
    WHERE document_id = ? AND user_id = ?
    LIMIT 1
  `;

  const docRows = await safeExecute(docSql, [documentId, userId]);

  if (docRows.length === 0) {
    throw new NotFoundError("Document not found");
  }

  if (docRows[0].status !== "ready") {
    throw new BadRequestError(
      "Document is not ready for search. Please wait for processing to complete.",
    );
  }

  // Step 2 - Embed the search query with the SAME model + dimensionality as the
  // stored chunk vectors. getQueryEmbedding uses the same embedder as the chunks
  // (the model's default dimensionality), so cosine similarity is valid. The query
  // and chunk embeddings MUST share a dimensionality; previously the query used a
  // smaller-dimension embedding, so the length mismatch made every score 0.
  const queryEmbedding = await getQueryEmbedding(normalizedQuery);

  // Step 3 - Fetch all chunk vectors for this document
  const vectorsSql = `
    SELECT
      dcv.chunk_id AS chunkId,
      dcv.embedding,
      dc.chunk_index AS chunkIndex
    FROM document_chunk_vectors dcv
    JOIN document_chunks dc ON dc.chunk_id = dcv.chunk_id
    WHERE dc.document_id = ? AND dcv.status = 'ready'
  `;

  const vectorRows = await safeExecute(vectorsSql, [documentId]);

  if (vectorRows.length === 0) {
    return {
      query: normalizedQuery,
      results: [],
    };
  }
  // Step 4 - Compute cosine similarity and keep only top-k (O(n log k))
  const heap = [];

  const heapPush = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (heap[parent].score <= heap[i].score) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };

  const heapPop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      while (true) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        let smallest = i;
        if (left < heap.length && heap[left].score < heap[smallest].score)
          smallest = left;
        if (right < heap.length && heap[right].score < heap[smallest].score)
          smallest = right;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  };

  for (const row of vectorRows) {
    const vector = parseEmbedding(row.embedding);
    if (!Array.isArray(vector) || vector.length === 0) continue;

    const score = cosineSimilarity(queryEmbedding, vector);
    if (heap.length < limit) {
      heapPush({ chunkId: row.chunkId, chunkIndex: row.chunkIndex, score });
    } else if (score > heap[0].score) {
      heapPop();
      heapPush({ chunkId: row.chunkId, chunkIndex: row.chunkIndex, score });
    }
  }

  // Step 5 - Extract top-k in descending order
  const top = heap.sort((a, b) => b.score - a.score);

  if (top.length === 0) {
    return {
      query: normalizedQuery,
      results: [],
    };
  }

  // Step 6 - Hydrate with actual text content
  const chunkIds = top.map((item) => item.chunkId);
  const placeholders = chunkIds.map(() => "?").join(", ");

  const chunksSql = `
    SELECT
      chunk_id AS chunkId,
      content AS excerpt
    FROM document_chunks
    WHERE chunk_id IN (${placeholders})
  `;

  const chunkRows = await safeExecute(chunksSql, chunkIds);
  const chunksById = new Map(chunkRows.map((row) => [row.chunkId, row]));

  const results = top
    .map((item) => {
      const chunk = chunksById.get(item.chunkId);
      if (!chunk) return null;
      return {
        chunkId: item.chunkId,
        chunkIndex: item.chunkIndex,
        score: item.score,
        excerpt: chunk.excerpt,
      };
    })
    .filter(Boolean);

  return {
    query: normalizedQuery,
    results,
  };
};


const MAX_CHUNKS_PER_UPLOAD = 50;


export const createDocumentFromUploadService= async (file, userId)=>{

    let documentId;
    

    try 
    {
        if (userId== null){
            throw new Error ("Authenticated user ID is missing.");
        }

        const storagePath = file.path ?? null;
        const title= file.originalname ?? null;
        const mimeType= file.mimetype ?? null;
        const byteSize= file.size ?? null;

        // 1 Initial DB Record: Insert document as 'processing'

        const insertResult= await safeExecute(
            ` INSERT INTO documents 
            (user_id, title, mime_type, byte_size, storage_path, status)
            VALUES (?, ?, ?, ?, ?, 'processing')`,

            [userId, title, mimeType, byteSize, storagePath]);

             documentId =  insertResult.insertId;

        
        //  2 Parse PDF: Extract text from PDF buffer
        const fileBuffer = await fs.readFile(file.path);

        // Quick signature check to avoid relying only on mimetype/extension.
        const magic = fileBuffer.subarray(0, 5).toString("utf8");
        if (magic !== "%PDF-") {
            const err = new Error("Uploaded file is not a valid PDF.");
            err.statusCode = 400;
            throw err;
        }

        const text = await extractTextFromPDF(fileBuffer);
        if (!text || text.trim().length === 0) {
            const err = new Error("No readable text found in PDF document.");
            err.statusCode = 400;
            throw err;
        }


        // 3 Chunking: split text into overlapping segments, sized via
        // RAG_CHUNK_CHARS / RAG_CHUNK_OVERLAP (defaults 900 / 120).
        const parsedChunkChars = Number.parseInt(process.env.RAG_CHUNK_CHARS, 10);
        const parsedChunkOverlap = Number.parseInt(process.env.RAG_CHUNK_OVERLAP, 10);
        const chunkChars =
          Number.isInteger(parsedChunkChars) && parsedChunkChars > 0 ? parsedChunkChars : 900;
        // chunkText() requires overlap < size; clamp so a misconfigured env
        // (or a small RAG_CHUNK_CHARS) can't throw and crash the upload.
        const requestedOverlap =
          Number.isInteger(parsedChunkOverlap) && parsedChunkOverlap >= 0 ? parsedChunkOverlap : 120;
        const chunkOverlap = Math.min(requestedOverlap, chunkChars - 1);
        const chunks = chunkText(text, chunkChars, chunkOverlap);
        if (chunks.length === 0) {
            const err = new Error("No text found in PDF");
            err.statusCode = 400;
            throw err;
        }
        if (chunks.length > MAX_CHUNKS_PER_UPLOAD) {
            const err = new Error(`Document is too large. Maximum allowed chunks is ${MAX_CHUNKS_PER_UPLOAD}.`);
            err.statusCode = 400;
            throw err;
        }

        // 4. Embedding: Loop through chunks properly
        for (let i=0; i<chunks.length; i++){
            const chunk= chunks[i];

            // Call Gemini API to get vector embedding for the chunk
            const embedding = await getDocumentEmbedding (chunk);
            if (embedding === undefined || embedding=== null){
                throw new Error ("Failed to generate embedding for PDF chunk.");
            }

            const embeddingJson= JSON.stringify(embedding);
            if (embeddingJson===undefined ){
                throw new Error ("Embedding could not be serialized for storage.");        
            }
            // Store Vector : save chunk to database
            const chunkResult= await safeExecute(
                `INSERT INTO document_chunks
                (document_id, chunk_index, content)
                VALUES(?,?,?)`,
                [documentId, i, chunk], );

            const chunkId = chunkResult.insertId;
            
            // Store Vector : save vector embeddings to database
            await safeExecute(
                `INSERT INTO document_chunk_vectors (chunk_id, source_text, embedding) VALUES (?, ?, ?)`,
                [chunkId, chunk, embeddingJson]
            );
        }

        // 5. Finalize: Update document status to ready
        await safeExecute(`UPDATE documents SET status='ready' WHERE document_id=?`, [documentId]);
        
        return {
            document_id: documentId,
            title: file.originalname,
            mime_type: file.mimetype,   
            byte_size: file.size,      
            storage_path: file.path,    
            status: "ready",
            error_message: null,        
            user_id: userId,
        };


    } catch (error) {
    // Finalize (Error Case): Update status to 'failed' and save error
    if (documentId) {
      // Clean up partial chunk/vector writes; vectors cascade on chunk delete.
      await safeExecute(`DELETE FROM document_chunks WHERE document_id=?`, [
        documentId,
      ]);
      await safeExecute(
        `UPDATE documents SET status='failed', error_message=? WHERE document_id=?`,
        [error.message, documentId],
      );
    }
    throw error;
  }
};
export const queryDocumentService = async ({ documentId, query, userId }) => {
  if (!userId) {
    throw new BadRequestError("Authenticated user ID is missing.");
  }

  // 1. Verify document ownership and readiness
  const documentRows = await safeExecute(
    `SELECT * FROM documents WHERE document_id = ? AND user_id = ?`,
    [documentId, userId],
  );
  if (documentRows.length === 0) {
    throw new NotFoundError("Document not found");
  }

  const document = documentRows[0];
  if (document.status !== "ready") {
    throw new BadRequestError("Document is not ready for querying");
  }

  // 2. Embed the query
  const queryEmbedding = await getQueryEmbedding(query);

  // 3. Fetch all chunk vectors for this document
  const chunkRows = await safeExecute(
    `SELECT dc.chunk_id AS chunkId, dc.chunk_index AS chunkIndex, dc.content, dcv.embedding
     FROM document_chunks dc
     INNER JOIN document_chunk_vectors dcv ON dc.chunk_id = dcv.chunk_id
     WHERE dc.document_id = ? AND dcv.status = 'ready'`,
    [documentId],
  );

  if (chunkRows.length === 0) {
    throw new BadRequestError("No processed chunks found for this document.");
  }

  // 4. Calculate similarities and score
  const scored = [];
  for (const row of chunkRows) {
    const vector = parseEmbedding(row.embedding);
    if (!Array.isArray(vector) || vector.length === 0) {
      continue;
    }
    const score = cosineSimilarity(queryEmbedding, vector);
    scored.push({
      chunkId: row.chunkId,
      chunkIndex: row.chunkIndex,
      content: row.content,
      score,
    });
  }

  // 5. Filter by threshold (RAG_SEARCH_THRESHOLD, default 0.55). Raised from 0.45
  // after moving to 768-dim embeddings: lower dimensions compress the cosine
  // range, so the irrelevant "floor" rose to ~0.5 — 0.55 keeps it above that.
  // Cosine similarity is bounded to [-1, 1], so a threshold > 1 would never match;
  // accept only a value in (0, 1], otherwise fall back to the 0.55 default.
  const parsedThreshold = parseFloat(process.env.RAG_SEARCH_THRESHOLD);
  const searchThreshold =
    Number.isFinite(parsedThreshold) && parsedThreshold > 0 && parsedThreshold <= 1
      ? parsedThreshold
      : 0.55;

  // Enforce the threshold: only chunks scoring >= it are eligible. If none qualify,
  // `ranked` is empty and the empty-check below returns "no relevant content" — we
  // deliberately do NOT fall back to all chunks, which would defeat the threshold
  // and let an off-topic query pull in irrelevant context.
  const ranked = scored
    .filter((item) => item.score >= searchThreshold)
    .sort((a, b) => b.score - a.score);

  // Take top k chunks
  const parsedk = process.env.RAG_SEARCH_K
    ? Number.parseInt(process.env.RAG_SEARCH_K, 10)
    : NaN;
  const limit = Number.isFinite(parsedk) && parsedk > 0 ? parsedk : 5;
  const topChunks = ranked.slice(0, limit);
  if (topChunks.length === 0) {
    throw new BadRequestError(
      "Could not retrieve relevant content to answer the query.",
    );
  }

  // 6. Generate answer using Gemini
  const responseData = await answerFromRagChunksService(query, topChunks);

  return responseData;
};
