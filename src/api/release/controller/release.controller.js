import { StatusCodes } from "http-status-codes";
import {
  getUnseenReleasesService,
  markReleasesSeenService,
  getRecentReleasesService,
} from "../service/release.service.js";

export const getUnseenReleasesController = async (req, res, next) => {
  try {
    const result = await getUnseenReleasesService({ userId: req.user.id });
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const markReleasesSeenController = async (req, res, next) => {
  try {
    const result = await markReleasesSeenService({ userId: req.user.id });
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const getRecentReleasesController = async (req, res, next) => {
  try {
    const result = await getRecentReleasesService({ limit: req.query.limit });
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};
