import jwt from 'jsonwebtoken';
import { UnauthenticatedError } from '../utils/errors/index.js';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

export const authenticateUser = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthenticatedError('Authentication invalid');
    }
    const token = authHeader.split(' ')[1];
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: payload.id,
      firstName: payload.firstName,
      lastName: payload.lastName,
    
    };
    next();
  } catch (error) {
    // jwt.verify throws TokenExpiredError / JsonWebTokenError / NotBeforeError.
    // These are authentication failures (an expired or tampered token), NOT
    // server errors — they carry no statusCode, so passing them through lands
    // in the 500 branch of the error handler and the user sees a misleading
    // "Something went wrong". Map them to a clean 401 so the client clears the
    // stale session and redirects to login.
    if (
      error.name === 'TokenExpiredError' ||
      error.name === 'JsonWebTokenError' ||
      error.name === 'NotBeforeError'
    ) {
      return next(new UnauthenticatedError('Session expired or invalid. Please log in again.'));
    }
    next(error);
  }
};
