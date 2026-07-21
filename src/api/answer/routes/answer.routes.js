import express from "express";

import { authenticateUser as authenticate } from "../../../middleware/authentication.js";

import { createAnswerController } from "../controller/answer.controller.js";
import { addVoteController, removeVoteController } from "../controller/vote.controller.js";
import { createAnswerValidation } from "../validations/answer.validation.js";
import { voteParamValidation } from "../validations/vote.validation.js";

const router = express.Router();

router.use(authenticate);

// POST /api/answers
router.post("/", createAnswerValidation, createAnswerController);

// POST   /api/answers/:answerId/vote
// DELETE /api/answers/:answerId/vote
router.post("/:answerId/vote", voteParamValidation, addVoteController);
router.delete("/:answerId/vote", voteParamValidation, removeVoteController);

export default router;
