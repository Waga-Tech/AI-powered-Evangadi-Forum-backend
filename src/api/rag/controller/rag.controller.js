import { deleteDocumentService } from "../service/rag.service.js";
import { StatusCodes } from 'http-status-codes';
import { BadRequestError } from "../../../utils/errors/index.js";
import {
  getDocumentMetaService,
  listDocumentsForUserService,
  searchInDocumentService,
  createDocumentFromUploadService,
  queryDocumentService,
} from "../service/rag.service.js";

export const deleteDocumentController = async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const userId = req.user.id;

    const data = await deleteDocumentService({ documentId, userId });

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Document deleted successfully.",
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getDocumentMetaController = async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const userId = req.user.id;
    const document = await getDocumentMetaService(documentId, userId);

    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Document fetched successfully.',
      data: document,
    });
  } catch (error) {
    next(error);
  }
};

export const listDocumentsController = async (req, res, next) => {
  try {
    const documents = await listDocumentsForUserService({
      userId: req.user.id,
    });

    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Documents fetched successfully.',
      data: documents,
    });
  } catch (error) {
    next(error);
  }
};

export const searchInDocumentController = async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const { query, k } = req.query;

    const result = await searchInDocumentService({
      documentId: Number(documentId),
      userId: req.user.id,
      query,
      k,
    });

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Ranked chunk excerpts",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const createDocumentController = async (req, res, next) => {
  try {
    if (!req.file) {
      throw new BadRequestError("PDF file required");
    }

    const result = await createDocumentFromUploadService(req.file, req.user.id);

    res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Document uploaded and processed.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const queryDocumentController = async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const { query } = req.body;
    const userId = req.user.id;

    const result = await queryDocumentService({ documentId, query, userId });

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Answer and citations",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
