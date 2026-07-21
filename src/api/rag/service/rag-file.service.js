import fs from "fs";
import { safeExecute } from "../../../../db/config.js";
import { NotFoundError } from "../../../utils/errors/index.js";

export const getDocumentFileService = async ({ documentId, userId }) => {
  const sql = `
    SELECT document_id AS id, user_id AS userId, title, mime_type AS mimeType, storage_path AS storagePath
    FROM documents
    WHERE document_id = ?
  `;

  const rows = await safeExecute(sql, [documentId]);

  if (rows.length === 0) {
    throw new NotFoundError("Document not found");
  }

  const document = rows[0];

  if (document.userId !== userId) {
    throw new NotFoundError("Document not found");
  }

  try {
    await fs.promises.access(document.storagePath, fs.constants.R_OK);
  } catch {
    throw new NotFoundError("Document file not found");
  }

  return document;
};
