import express from "express";
import authRoutes from "./auth/routes/auth.routes.js";
import answerRoutes from "./answer/routes/answer.routes.js";
import questionRoutes from "./question/routes/question.routes.js";
import answerFitRoutes from "./questions/routes/answer-fit.routes.js";
import ragRoutes from "./rag/routes/rag.routes.js";
import ragFileRoutes from "./rag/routes/rag-file.routes.js";
import leaderboardRoutes from "./leaderboard/routes/leaderboard.routes.js";
import userRoutes from "./users/routes/user.routes.js";
import adminRoutes from "./admin/routes/admin.routes.js";
import releaseRoutes from "./release/routes/release.routes.js";

export const mainRouter = express.Router();

// Authentication routes
mainRouter.use("/auth", authRoutes);

// Answer routes
mainRouter.use("/answers", answerRoutes);

//  /api/questions
mainRouter.use("/questions", questionRoutes);
mainRouter.use("/questions", answerFitRoutes);
// /api/rag
mainRouter.use("/rag", ragRoutes);

// /api/rag/documents/:documentId/file (PDF preview streaming)
mainRouter.use("/rag/documents", ragFileRoutes);

// Leaderboard routes
mainRouter.use("/leaderboard", leaderboardRoutes);
// User profile routes
mainRouter.use("/users", userRoutes);
// Admin routes
mainRouter.use("/admin", adminRoutes);
// Release / changelog routes
mainRouter.use("/releases", releaseRoutes);
