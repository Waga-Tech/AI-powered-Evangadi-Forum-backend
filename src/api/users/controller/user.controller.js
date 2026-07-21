import { getUserProfileService } from "../service/user.service.js";

export const getUserProfileController = async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    const data = await getUserProfileService(userId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};
