import express from "express";
import { authenticateUser } from "../../../middleware/authentication.js";
import { getDocumentFileController } from "../controller/rag-file.controller.js";
import { getDocumentFileValidation } from "../validations/rag-file.validation.js";

const router = express.Router();

router.get(
  "/:documentId/file",
  authenticateUser,
  getDocumentFileValidation,
  getDocumentFileController,
);

export default router;
