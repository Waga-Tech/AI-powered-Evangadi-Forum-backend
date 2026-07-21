import { StatusCodes } from "http-status-codes";

// Stable, client-facing error codes derived from the HTTP status so we never
// leak raw driver codes (e.g. MySQL `ER_*`) to the client.
const STATUS_CODE_NAMES = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE_ENTITY",
  429: "TOO_MANY_REQUESTS",
  500: "INTERNAL_SERVER_ERROR",
  503: "SERVICE_UNAVAILABLE",
};

// An application error code is one we set deliberately: UPPER_SNAKE_CASE and
// NOT a driver code (those start with `ER_`/`ECONN`/etc.). Anything else is
// treated as untrusted and replaced with the status-derived default.
const isAppCode = (code) =>
  typeof code === "string" &&
  /^[A-Z][A-Z0-9_]*$/.test(code) &&
  !code.startsWith("ER_") &&
  !code.startsWith("ECONN") &&
  !code.startsWith("ENOTFOUND");

export const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || StatusCodes.INTERNAL_SERVER_ERROR;
  // MySQL duplicate-key — always a client mistake, remap to 409.
  if (err?.code === "ER_DUP_ENTRY") {
    statusCode = StatusCodes.CONFLICT;
  }

  const defaultCode = STATUS_CODE_NAMES[statusCode] || "INTERNAL_SERVER_ERROR";
  // Only surface a code we deliberately set; never echo raw driver codes.
  let code = isAppCode(err?.code) ? err.code : defaultCode;

  // Don't leak internal/driver error text on 5xx — use a safe generic message.
  let message =
    statusCode >= 500
      ? "Something went wrong, please try again later"
      : err.message || "Request could not be completed";

  if (err?.code === "ER_DUP_ENTRY") {
    code = "CONFLICT";
    message = "Duplicate value entered for a unique field";
  }

  // Canonical envelope plus optional moderation / duplicate-detection metadata.
  const body = { code, message };
  if (err.guidance)              body.guidance = err.guidance;
  if (err.existingQuestionHash)  body.existingQuestionHash  = err.existingQuestionHash;
  if (err.existingQuestionTitle) body.existingQuestionTitle = err.existingQuestionTitle;
  if (err.similarQuestionHash)   body.similarQuestionHash   = err.similarQuestionHash;
  if (err.similarQuestionTitle)  body.similarQuestionTitle  = err.similarQuestionTitle;

  // `error` is the canonical shape; `msg` kept for backward-compatible clients.
  return res.status(statusCode).json({ error: body, msg: message });
};
