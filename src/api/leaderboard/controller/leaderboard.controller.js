import {
  getMonthlyLeaderboardService,
  getAllTimeLeaderboardService,
} from "../service/leaderboard.service.js";

export const getMonthlyLeaderboardController = async (req, res, next) => {
  try {
    const result = await getMonthlyLeaderboardService();
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const getAllTimeLeaderboardController = async (req, res, next) => {
  try {
    const result = await getAllTimeLeaderboardService();
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};
