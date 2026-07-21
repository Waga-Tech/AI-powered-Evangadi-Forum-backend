import express from "express";
import { param } from "express-validator";
import { authenticateUser as authenticate } from "../../../middleware/authentication.js";
import { requireAdmin } from "../../../middleware/admin.js";
import { validationErrorHandler } from "../../../middleware/validation-handler.js";
import {
  getAdminQueueController,
  approvePostController,
  removePostController,
  escalatePostController,
  getUsersController,
  updateUserRoleController,
  deleteUserController,
  getFlagHistoryController,
} from "../controller/admin.controller.js";

const router = express.Router();

// All admin routes require a valid JWT and admin role.
router.use(authenticate, requireAdmin);

// These endpoints act on a moderation_flags.flag_id (a review record), not the
// underlying question/answer id — hence :flagId.
const flagIdValidation = [
  param("flagId")
    .isInt({ min: 1 })
    .withMessage("flagId must be a positive integer")
    .toInt(),
  validationErrorHandler,
];

// GET  /api/admin/queue
router.get("/queue", getAdminQueueController);

// POST /api/admin/queue/:flagId/approve
router.post("/queue/:flagId/approve", flagIdValidation, approvePostController);

// POST /api/admin/queue/:flagId/remove
router.post("/queue/:flagId/remove", flagIdValidation, removePostController);

// POST /api/admin/queue/:flagId/escalate
router.post("/queue/:flagId/escalate", flagIdValidation, escalatePostController);

// GET  /api/admin/users
router.get("/users", getUsersController);

// PATCH /api/admin/users/:userId/role
router.patch(
  "/users/:userId/role",
  [param("userId").isInt({ min: 1 }).toInt(), validationErrorHandler],
  updateUserRoleController
);

// DELETE /api/admin/users/:userId
router.delete(
  "/users/:userId",
  [param("userId").isInt({ min: 1 }).toInt(), validationErrorHandler],
  deleteUserController
);

// GET /api/admin/flags
router.get("/flags", getFlagHistoryController);

export default router;
