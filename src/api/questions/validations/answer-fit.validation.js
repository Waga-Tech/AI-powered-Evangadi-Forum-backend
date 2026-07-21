import { body } from "express-validator";
import { validationErrorHandler } from "../../../middleware/validation-handler.js";

const answerFitValidation = [
  body("draftAnswer")
    .notEmpty()
    .withMessage("Draft answer is required")
    .isString()
    .withMessage("Draft answer must be a string")
    .trim()
    .isLength({ min: 10, max: 10000 })
    .withMessage("Draft answer must be between 10 and 10,000 characters"),
  validationErrorHandler,
];

export default answerFitValidation;
