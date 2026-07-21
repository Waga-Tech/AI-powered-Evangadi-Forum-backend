import { param } from "express-validator";
import { validationErrorHandler } from "../../../middleware/validation-handler.js";

export const voteParamValidation = [
  param("answerId")
    .isInt({ min: 1 })
    .withMessage("answerId must be a positive integer")
    .toInt(),
  validationErrorHandler,
];
