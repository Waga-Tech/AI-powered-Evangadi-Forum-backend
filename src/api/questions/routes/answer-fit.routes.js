import express from 'express';
import answerFitController from '../controller/answer-fit.controller.js';
import answerFitValidation from '../validations/answer-fit.validation.js';
import { authenticateUser } from '../../../middleware/authentication.js';

const router = express.Router();

router.post(
  '/:questionHash/answer-fit',
  authenticateUser,
  answerFitValidation,
  answerFitController
);

export default router;