import express from "express";
import { authenticateUser } from "../../../middleware/authentication.js";
import {
  createQuestionValidation,
  draftCoachValidation,
  getQuestionsValidation,
  searchQuestionsValidation,
  getSimilarQuestionsValidation,
  getSingleQuestionValidation,
} from "../validations/question.validation.js";
import {
  createQuestionController,
  generateQuestionDraftCoachController,
  generateAIContextController,
  getQuestionsController,
  searchQuestionsSemanticController,
  getSimilarQuestionsController,
  getSingleQuestionController,
} from "../controller/question.controller.js";

const questionRoute = express.Router();

questionRoute.get("/", authenticateUser, getQuestionsValidation, getQuestionsController);

questionRoute.post("/", authenticateUser, createQuestionValidation, createQuestionController);

questionRoute.post("/draft-coach", authenticateUser, draftCoachValidation, generateQuestionDraftCoachController);

questionRoute.post("/ai-search", authenticateUser, draftCoachValidation, generateAIContextController);

questionRoute.get("/search", authenticateUser, searchQuestionsValidation, searchQuestionsSemanticController);

questionRoute.get("/:questionHash/similar", authenticateUser, getSimilarQuestionsValidation, getSimilarQuestionsController);

questionRoute.get("/:questionHash", authenticateUser, getSingleQuestionValidation, getSingleQuestionController);

export default questionRoute;
