import { body } from "express-validator";
import { validationErrorHandler } from "../../../middleware/validation-handler.js";

export const createAnswerValidation = [
  body("questionId")
    .notEmpty()
    .withMessage("questionId is required")
    .isInt({ min: 1 })
    .withMessage("questionId must be a positive integer")
    .toInt(),

  body("content")
    .notEmpty()
    .withMessage("content is required")
    .isString()
    .withMessage("content must be a string")
    .trim()
    .isLength({ min: 20, max: 10000 })
    .withMessage("content must be between 20 and 10,000 characters long"),

  validationErrorHandler,
];
