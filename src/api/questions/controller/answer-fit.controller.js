import {
  getQuestionByHash,
  evaluateAnswerFit,
} from "../service/answer-fit.service.js";
import { NotFoundError } from "../../../utils/errors/index.js";

const answerFitController = async (req, res, next) => {
  try {
    const { questionHash } = req.params;
    const { draftAnswer } = req.body;

    const question = await getQuestionByHash(questionHash);
    if (!question) {
      throw new NotFoundError("Question not found");
    }

    const { score, feedback } = await evaluateAnswerFit(
      question.title,
      question.content,
      draftAnswer,
    );

    return res.status(200).json({ success: true, data: { score, feedback } });
  } catch (error) {
    next(error);
  }
};

export default answerFitController;
