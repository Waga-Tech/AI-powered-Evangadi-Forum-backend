import { StatusCodes } from "http-status-codes";
import {
  createQuestionWithVectorService,
  getQuestionsService,
  getSingleQuestionService,
  searchQuestionsSemanticService,
  getSimilarQuestionsService,
} from "../service/question.service.js";
import { generateQuestionDraftCoachService } from "../service/geminiTextCoach.service.js";
import { generateAIContextService } from "../service/aiSearch.service.js";

export const getQuestionsController = async (req, res, next) => {
  try {
    const filters = {
      search: req.query.search,
      mine: req.query.mine === "true",
      userId: req.user?.id,
    };

    const result = await getQuestionsService(filters);

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Questions fetched successfully.",
      questions: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getSingleQuestionController = async (req, res, next) => {
  try {
    const { questionHash } = req.params;

    const result = await getSingleQuestionService({ questionHash, viewerId: req.user?.id ?? null });

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Question fetched successfully.",
      question: result,
    });
  } catch (error) {
    next(error);
  }
};

export const createQuestionController = async (req, res, next) => {
  try {
    const { title, content, force } = req.body;

    const result = await createQuestionWithVectorService({
      userId: req.user.id,
      title,
      content,
      force: force === true,
    });

    if (result.flagged) {
      return res.status(202).json({
        success: true,
        flagged: true,
        message: "Your question has been submitted and is under review. It will be visible once approved.",
        data: result.question,
        moderation: result.moderation,
      });
    }

    res.status(StatusCodes.CREATED).json({
      success: true,
      flagged: false,
      message: "Question created successfully",
      data: result.question,
    });
  } catch (error) {
    next(error);
  }
};

export const searchQuestionsSemanticController = async (req, res, next) => {
  try {
    const { query, k, threshold } = req.query;

    const result = await searchQuestionsSemanticService({ query, k, threshold });

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Semantic search completed successfully.",
      data: result.data,
      aiAnswer: result.aiAnswer ?? null,
      meta: { ...result.meta, query, questionHash: null },
    });
  } catch (error) {
    next(error);
  }
};

export const getSimilarQuestionsController = async (req, res, next) => {
  try {
    const { questionHash } = req.params;
    const { k, threshold } = req.query;

    const result = await getSimilarQuestionsService({ questionHash, k, threshold });

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Similar questions fetched successfully.",
      data: result.data,
      meta: { ...result.meta, query: null, questionHash },
    });
  } catch (error) {
    next(error);
  }
};

export const generateAIContextController = async (req, res, next) => {
  try {
    const { title, content } = req.body;
    const result = await generateAIContextService({ title, content });
    res.status(StatusCodes.OK).json({ success: true, answer: result.answer });
  } catch (error) {
    next(error);
  }
};

export const generateQuestionDraftCoachController = async (req, res, next) => {
  try {
    const { title, content } = req.body;

    const result = await generateQuestionDraftCoachService({ title, content });

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Draft coach feedback generated successfully.",
      feedback: result.feedback,
      tips: result.suggestions || [],
      suggestions: result.suggestions || [],
    });
  } catch (error) {
    next(error);
  }
};
