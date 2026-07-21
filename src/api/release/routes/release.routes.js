import express from "express";
import { authenticateUser } from "../../../middleware/authentication.js";
import {
  getUnseenReleasesController,
  markReleasesSeenController,
  getRecentReleasesController,
} from "../controller/release.controller.js";

const router = express.Router();

// All release routes require a valid JWT.
router.use(authenticateUser);

// GET  /api/releases/unseen — releases this user hasn't seen yet
router.get("/unseen", getUnseenReleasesController);

// POST /api/releases/seen — mark all published releases as seen
router.post("/seen", markReleasesSeenController);

// GET  /api/releases — recent published releases (bell reopen view)
router.get("/", getRecentReleasesController);

export default router;
