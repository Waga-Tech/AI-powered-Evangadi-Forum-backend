import { param } from "express-validator";
import { validationErrorHandler } from "../../../middleware/validation-handler.js";

export const getDocumentFileValidation = [
  param("documentId")
    .notEmpty()
    .withMessage("Document id is required")
    .bail()
    .isInt({ min: 1 })
    .withMessage("Document id must be a positive integer")
    .toInt(),
  validationErrorHandler,
];
