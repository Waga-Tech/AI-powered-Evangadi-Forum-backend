import path from "path";
import { fileURLToPath } from "url";
import { safeExecute } from "../../../../db/config.js";

// Resolve uploads dir relative to *this file*, not the process CWD.
// This is safe regardless of which directory the server is started from.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// backend/uploads  (4 levels up: service -> rag -> api -> src -> backend)
export const UPLOADS_DIR = path.resolve(__dirname, "../../../../..", "uploads");

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Returns all documents owned by a user.
 * @param {number} userId
 */
export async function listDocumentsForUser(userId) {
  const rows = await safeExecute(
    `SELECT document_id, user_id, title, mime_type,
            byte_size, status, error_message, created_at, updated_at
     FROM documents
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [userId],
  );
  return rows;
}

/**
 * Inserts a new document row and returns the created record.
 */
export async function addDocument({
  user_id,
  originalName,
  mimeType,
  size,
  filePath,
}) {
  const result = await safeExecute(
    `INSERT INTO documents (user_id, title, mime_type, storage_path, byte_size, status)
     VALUES (?, ?, ?, ?, ?, 'processing')`,
    [user_id, originalName, mimeType || "application/pdf", filePath, size || 0],
  );

  const id = result.insertId;

  // Simulate async processing: mark ready after 1 second
  setTimeout(async () => {
    try {
      await safeExecute(
        `UPDATE documents SET status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE document_id = ?`,
        [id],
      );
    } catch (err) {
      console.error("Failed to mark document ready:", err.message);
    }
  }, 1000);

  const [doc] = await safeExecute(
    `SELECT document_id, user_id, title, mime_type,
            byte_size, status, error_message, created_at
     FROM documents WHERE document_id = ?`,
    [id],
  );
  return doc;
}

/**
 * Fetches a single document by ID (any user — ownership checked at controller layer).
 * @param {number|string} id
 */
export async function getDocumentById(id) {
  const rows = await safeExecute(
    `SELECT document_id, user_id, title, mime_type, storage_path,
            byte_size, status, error_message, created_at
     FROM documents WHERE document_id = ?`,
    [Number(id)],
  );
  return rows[0] || null;
}

/**
 * Deletes a document row. Returns true if a row was deleted, false if not found.
 * @param {number|string} id
 */
export async function deleteDocumentById(id) {
  const result = await safeExecute(
    `DELETE FROM documents WHERE document_id = ?`,
    [Number(id)],
  );
  return result.affectedRows > 0;
}

// Legacy export kept for compatibility.
export function uploadsDir() {
  return UPLOADS_DIR;
}
