import { addVoteService, removeVoteService } from "../service/vote.service.js";

export const addVoteController = async (req, res, next) => {
  try {
    const answerId = Number(req.params.answerId);
    const userId = req.user.id;

    const data = await addVoteService({ answerId, userId });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const removeVoteController = async (req, res, next) => {
  try {
    const answerId = Number(req.params.answerId);
    const userId = req.user.id;

    const data = await removeVoteService({ answerId, userId });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};
