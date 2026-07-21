import { safeExecute } from "../../db/config.js";
import { ForbiddenError } from "../utils/errors/index.js";

// Checks the role column live from the DB so a role change takes effect
// without requiring the user to log out and back in.
export const requireAdmin = async (req, res, next) => {
  try {
    const rows = await safeExecute(
      `SELECT role FROM users WHERE user_id = ? LIMIT 1`,
      [req.user.id]
    );

    if (!rows.length || rows[0].role !== 'admin') {
      throw new ForbiddenError(
        "This action requires admin privileges.",
        "ADMIN_ACCESS_REQUIRED"
      );
    }

    next();
  } catch (err) {
    next(err);
  }
};
