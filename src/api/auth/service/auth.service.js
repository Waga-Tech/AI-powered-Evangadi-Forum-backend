import bcrypt from 'bcryptjs'; // For password hashing
import { StatusCodes } from 'http-status-codes'; // For standardized HTTP status codes
import jwt from 'jsonwebtoken'; // For token generation and verification
import { safeExecute } from '../../../../db/config.js';// For executing database queries safely
import {
  BadRequestError,
  NotFoundError,
  UnauthenticatedError,
} from '../../../utils/errors/index.js'; // Custom error classes for consistent error handling
import {
  sendConfirmationEmail,
  sendPasswordResetEmail,
} from '../../../utils/mailer.js'; // Utility functions for sending emails

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

const normalizeEmail = email => email.trim().toLowerCase();

const signFlowToken = (payload, expiresIn) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

const verifyFlowToken = (token, { invalidCode, expiredCode }) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new BadRequestError('This link has expired. Please request a new one.', expiredCode);
    }
    throw new BadRequestError('This link is invalid or has already been used.', invalidCode);
  }
};

// Called once at startup (from initAuthTables) — not per-request.
const ensureEmailVerificationTable = async () => {
  await safeExecute(
    `
      CREATE TABLE IF NOT EXISTS user_email_verifications (
        user_id INT PRIMARY KEY,
        is_verified TINYINT(1) NOT NULL DEFAULT 0,
        verified_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_email_verifications_verified (is_verified)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
    [],
  );
};

// Export so index.js can call this once after DB connects.
export const initAuthTables = async () => {
  await ensureEmailVerificationTable();
};

/**
 * Checks if a user exists by email.
 *
 * @param {string} email - The email to check.
 * @returns {Promise<boolean>} True if the user exists, false otherwise.
 */
export const checkUserExists = async email => {
  const normalizedEmail = normalizeEmail(email);
  const sql = 'SELECT user_id FROM users WHERE email = ? LIMIT 1';
  const rows = await safeExecute(sql, [normalizedEmail]);
  return rows.length > 0;
};

/**
 * Registers a new user in the database.
 *
 * @param {Object} userData - The user data.
 * @param {string} userData.firstName - The first name.
 * @param {string} userData.lastName - The last name.
 * @param {string} userData.email - The email address.
 * @param {string} userData.password - The plain text password.
 * @returns {Promise<Object>} The created user object (without password).
 */
export const registerService = async ({
  firstName,
  lastName,
  email,
  password,
}) => {

  const normalizedEmail = normalizeEmail(email);
  const userExists = await checkUserExists(normalizedEmail);
  if (userExists) {
    throw new BadRequestError('An account with this email address already exists.', 'EMAIL_ALREADY_REGISTERED');
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const sql =
    'INSERT INTO users (first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?)';

  let result;
  try {
    result = await safeExecute(sql, [
      firstName,
      lastName,
      normalizedEmail,
      hashedPassword,
    ]);
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      throw new BadRequestError('An account with this email address already exists.', 'EMAIL_ALREADY_REGISTERED');
    }
    throw error;
  }

  await safeExecute(
    `
      INSERT INTO user_email_verifications (user_id, is_verified)
      VALUES (?, 0)
      ON DUPLICATE KEY UPDATE is_verified = VALUES(is_verified), verified_at = NULL
    `,
    [result.insertId],
  );

  const confirmationToken = signFlowToken(
    {
      purpose: 'confirm-email',
      userId: result.insertId,
      email: normalizedEmail,
    },
    process.env.EMAIL_CONFIRM_EXPIRES_IN || '24h',
  );

  const confirmationUrl = `${process.env.FRONTEND_URL || 'http://localhost:5001'}/auth?confirmToken=${encodeURIComponent(confirmationToken)}`;
  if (process.env.NODE_ENV !== 'production') {
    console.info('[dev] Email confirmation link:', confirmationUrl);
  }

  let confirmationEmailSent = false;
  let confirmationEmailError = '';

  try {
    await sendConfirmationEmail({
      to: normalizedEmail,
      firstName,
      confirmationUrl,
    });
    confirmationEmailSent = true;
  } catch (err) {
    confirmationEmailError = err?.message || 'Unknown email delivery error';
    console.error('[mailer] Failed to send confirmation email:', confirmationEmailError);
  }

  const isDev = process.env.NODE_ENV !== 'production';

  let confirmationMessage =
    'A confirmation email has been sent. Click the link inside to activate your account.';

  if (!confirmationEmailSent && isDev) {
    const isResendSandboxRestriction = confirmationEmailError.includes(
      'You can only send testing emails to your own email address',
    );

    confirmationMessage = isResendSandboxRestriction
      ? 'Resend test mode blocked delivery to this recipient. Verify your domain in Resend to send to external users. Use the confirmation link below for local testing.'
      : 'Email delivery failed in development. Use the confirmation link below to verify your address.';
  }

  return {
    user: {
      id: result.insertId,
      firstName,
      lastName,
      email: normalizedEmail,
    },
    welcomeMessage: `Welcome ${firstName}! Your account was created successfully.`,
    confirmationMessage,
    confirmationUrl: isDev ? confirmationUrl : undefined,
  };
};

/**
 * Authenticates a user and generates a JWT token.
 *
 * @param {Object} credentials - The login credentials.
 * @param {string} credentials.email - The user's email.
 * @param {string} credentials.password - The user's plain text password.
 * @returns {Promise<Object>} An object containing the user and token.
 * @throws {UnauthenticatedError} If authentication fails.
 */
export const loginService = async ({ email, password }) => {

  const normalizedEmail = normalizeEmail(email);
  const sql =
    'SELECT user_id, first_name, last_name, email, password_hash, role FROM users WHERE email = ? LIMIT 1';
  const rows = await safeExecute(sql, [normalizedEmail]);

  if (rows.length === 0) {
    throw new UnauthenticatedError('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const user = rows[0];
  const isMatch = await bcrypt.compare(password, user.password_hash);

  if (!isMatch) {
    throw new UnauthenticatedError('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const verificationRows = await safeExecute(
    'SELECT is_verified FROM user_email_verifications WHERE user_id = ? LIMIT 1',
    [user.user_id],
  );

  if (!verificationRows.length) {
    // Backward compatibility: pre-existing accounts are considered verified.
    await safeExecute(
      'INSERT INTO user_email_verifications (user_id, is_verified, verified_at) VALUES (?, 1, CURRENT_TIMESTAMP)',
      [user.user_id],
    );
  } else if (!Number(verificationRows[0].is_verified)) {
    throw new UnauthenticatedError('Please confirm your email before signing in.', 'EMAIL_NOT_CONFIRMED');
  }

  const payload = {
    id: user.user_id,
    firstName: user.first_name,
    lastName: user.last_name,
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  return {
    user: {
      id: user.user_id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      role: user.role,
    },
    token,
  };
};

export const confirmEmailService = async ({ token }) => {

  const decoded = verifyFlowToken(token, {
    invalidCode: 'CONFIRM_TOKEN_INVALID',
    expiredCode: 'CONFIRM_TOKEN_EXPIRED',
  });

  if (decoded.purpose !== 'confirm-email') {
    throw new BadRequestError('This confirmation link is invalid or has already been used.', 'CONFIRM_TOKEN_INVALID');
  }

  const rows = await safeExecute(
    'SELECT user_id, email FROM users WHERE user_id = ? AND email = ? LIMIT 1',
    [decoded.userId, normalizeEmail(decoded.email)],
  );

  if (!rows.length) {
    throw new BadRequestError('This confirmation link is invalid or has already been used.', 'CONFIRM_TOKEN_INVALID');
  }

  await safeExecute(
    `
      INSERT INTO user_email_verifications (user_id, is_verified, verified_at)
      VALUES (?, 1, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE is_verified = 1, verified_at = CURRENT_TIMESTAMP
    `,
    [decoded.userId],
  );

  return {
    confirmed: true,
    userId: decoded.userId,
    email: normalizeEmail(decoded.email),
  };
};

export const forgotPasswordService = async ({ email }) => {
  const normalizedEmail = normalizeEmail(email);

  const rows = await safeExecute(
    'SELECT user_id, email FROM users WHERE email = ? LIMIT 1',
    [normalizedEmail],
  );

  if (!rows.length) {
    return {
      sent: true,
    };
  }

  const user = rows[0];
  const resetToken = signFlowToken(
    {
      purpose: 'reset-password',
      userId: user.user_id,
      email: user.email,
    },
    process.env.PASSWORD_RESET_EXPIRES_IN || '15m',
  );

  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5001'}/auth?resetToken=${encodeURIComponent(resetToken)}`;
  if (process.env.NODE_ENV !== 'production') {
    console.info('[dev] Password reset link:', resetUrl);
  }

  // Send reset email (no-op if EMAIL_HOST not configured)
  await sendPasswordResetEmail({
    to: user.email,
    firstName: user.first_name || user.email.split('@')[0],
    resetUrl,
  }).catch(err => {
    console.error('[mailer] Failed to send reset email:', err.message);
  });

  return {
    sent: true,
  };
};

export const resetPasswordService = async ({ token, newPassword }) => {
  const decoded = verifyFlowToken(token, {
    invalidCode: 'RESET_TOKEN_INVALID',
    expiredCode: 'RESET_TOKEN_EXPIRED',
  });

  if (decoded.purpose !== 'reset-password') {
    throw new BadRequestError('This password reset link is invalid or has already been used.', 'RESET_TOKEN_INVALID');
  }

  const normalizedEmail = normalizeEmail(decoded.email);
  const rows = await safeExecute(
    'SELECT user_id, email FROM users WHERE user_id = ? AND email = ? LIMIT 1',
    [decoded.userId, normalizedEmail],
  );

  if (!rows.length) {
    throw new BadRequestError('This password reset link is invalid or has already been used.', 'RESET_TOKEN_INVALID');
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  await safeExecute(
    'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
    [hashedPassword, decoded.userId],
  );

  return {
    reset: true,
  };
};
