// src/api/answer/controllers/answer.controller.js

import { createAnswerService } from "../service/answer.service.js";

export const createAnswerController = async (req, res, next) => {
  try {
    const { questionId, content } = req.body;

    const userId = req.user.id;

    const answer = await createAnswerService({
      questionId,
      content,
      userId,
    });

    if (answer.flagged) {
      return res.status(202).json({
        success: true,
        message: "Your answer has been submitted and is under review. It will be visible once approved.",
        data: answer,
        moderation: answer.moderation,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Answer posted successfully",
      data: answer,
    });
  } catch (error) {
    next(error);
  }
};
