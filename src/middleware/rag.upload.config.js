import fs from "fs";
import multer from "multer";
import path from "path";
import { BadRequestError } from "../utils/errors/index.js";

const UPLOAD_DIR = "uploads";
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const safeName = path
      .basename(file.originalname)
      .replace(/[^a-zA-Z0-9.-]/g, "_");
    const uniqueName = `${Date.now()}-${safeName}`;
    cb(null, uniqueName);
  },
});

const uploadPdf = multer({
  storage,
  limits: {
    // Limits file size to 10MB
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    // Basic PDF check using mimetype/extension (content is validated during processing)
    const isPdf =
      file.mimetype === "application/pdf" ||
      file.originalname.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return cb(new BadRequestError("Only PDF files are allowed."));
    }
    cb(null, true);
  },
}).single("file");

// Wrapper middleware to execute uploadPdf
export const handlePdfUpload = async (req, res, next) => {
  uploadPdf(req, res, (err) => {
    if (err) {
      return next(err); // Pass the error to the specific error handler
    }
    next();
  });
};

// Gracefully catch Multer errors as specified in the doc
export const createDocumentMulterErrorHandler = (err, req, res, next) => {
  if (!err) return next();
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    err.statusCode = 400;
    err.message = "File too large. Maximum size is 10MB.";
    return next(err);
  }
  // BadRequestError from fileFilter already has statusCode; default others to 400
  err.statusCode = err.statusCode || 400;
  return next(err);
};
