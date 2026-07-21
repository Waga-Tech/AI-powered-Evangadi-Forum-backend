import { body, param, query } from "express-validator";
import { validationErrorHandler } from "../../../middleware/validation-handler.js";

export const createQuestionValidation = [
  body("title")
    .notEmpty().withMessage("Title is required").bail()
    .isString().withMessage("Title must be a string").bail()
    .trim()
    .isLength({ min: 5, max: 255 }).withMessage("Title must be between 5 and 255 characters"),

  body("content")
    .notEmpty().withMessage("Content is required").bail()
    .isString().withMessage("Content must be a string").bail()
    .trim()
    .isLength({ min: 10, max: 10000 }).withMessage("Content must be between 10 and 10,000 characters"),

  // Optional flag to bypass the forum-wide similar-question check ("post anyway").
  body("force")
    .optional()
    .isBoolean().withMessage("force must be a boolean")
    .toBoolean(),

  validationErrorHandler,
];

export const draftCoachValidation = [
  body("title")
    .notEmpty().withMessage("Title is required").bail()
    .isString().withMessage("Title must be a string").bail()
    .trim()
    .isLength({ min: 5, max: 255 }).withMessage("Title must be between 5 and 255 characters"),

  body("content")
    .notEmpty().withMessage("Content is required").bail()
    .isString().withMessage("Content must be a string").bail()
    .trim()
    .isLength({ min: 10, max: 10000 }).withMessage("Content must be between 10 and 10,000 characters"),

  validationErrorHandler,
];

export const getQuestionsValidation = [
  query("search").optional().isString().withMessage("Search must be a string").trim(),
  query("mine").optional().isBoolean().withMessage("Mine must be a boolean").toBoolean(),
  validationErrorHandler,
];

export const searchQuestionsValidation = [
  query("query")
    .notEmpty().withMessage("Query is required").bail()
    .isString().withMessage("Query must be a string").bail()
    .trim()
    .isLength({ min: 5 }).withMessage("Query must be at least 5 characters"),

  query("k")
    .optional()
    .isInt({ min: 1, max: 20 }).withMessage("k must be an integer between 1 and 20")
    .toInt(),

  query("threshold")
    .optional()
    .isFloat({ min: 0, max: 1 }).withMessage("threshold must be a number between 0 and 1")
    .toFloat(),

  validationErrorHandler,
];

export const getSimilarQuestionsValidation = [
  param("questionHash")
    .notEmpty().withMessage("Question hash is required").bail()
    .isString().withMessage("Question hash must be a string").bail()
    .matches(/^[a-f0-9]{16}$/).withMessage("Question hash must be a 16-character lowercase hex string"),

  query("k")
    .optional()
    .isInt({ min: 1, max: 20 }).withMessage("k must be an integer between 1 and 20")
    .toInt(),

  query("threshold")
    .optional()
    .isFloat({ min: 0, max: 1 }).withMessage("threshold must be a number between 0 and 1")
    .toFloat(),

  validationErrorHandler,
];

export const getSingleQuestionValidation = [
  param("questionHash")
    .notEmpty().withMessage("Question hash is required").bail()
    .isString().withMessage("Question hash must be a string").bail()
    .matches(/^[a-f0-9]{16}$/).withMessage("Question hash must be a 16-character lowercase hex string"),

  validationErrorHandler,
];
