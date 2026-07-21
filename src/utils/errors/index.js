import { StatusCodes } from 'http-status-codes';

class CustomAPIError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || null;
  }
}

export class BadRequestError extends CustomAPIError {
  constructor(message, code) {
    super(message, code);
    this.statusCode = StatusCodes.BAD_REQUEST; // 400
  }
}

export class NotFoundError extends CustomAPIError {
  constructor(message, code) {
    super(message, code);
    this.statusCode = StatusCodes.NOT_FOUND; // 404
  }
}

export class UnauthenticatedError extends CustomAPIError {
  constructor(message, code) {
    super(message, code);
    this.statusCode = StatusCodes.UNAUTHORIZED; // 401
  }
}

export class ForbiddenError extends CustomAPIError {
  constructor(message, code) {
    super(message, code);
    this.statusCode = StatusCodes.FORBIDDEN; // 403
  }
}

export class ConflictError extends CustomAPIError {
  constructor(message, code) {
    super(message, code);
    this.statusCode = StatusCodes.CONFLICT; // 409
  }
}

export class ServiceUnavailableError extends CustomAPIError {
  constructor(message, code) {
    super(message, code);
    this.statusCode = StatusCodes.SERVICE_UNAVAILABLE; // 503
  }
}

export default CustomAPIError;
