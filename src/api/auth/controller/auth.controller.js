import { StatusCodes } from 'http-status-codes'; // Importing HTTP status codes for standardized response statuses.
// Importing service functions that contain the business logic for authentication operations.
import {
  registerService, // Service function to handle user registration logic.
  loginService, // Service function to handle user login logic and token generation.
  confirmEmailService, // Service function to handle email confirmation logic using a token.
  forgotPasswordService, // Service function to handle forgot password logic and token generation.
  resetPasswordService, // Service function to handle password reset logic using a token.
} from '../service/auth.service.js';

/**
 * Handles user registration requests.
 */
export const registerController = async (req, res, next) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    const registerResult = await registerService({
      firstName,
      lastName,
      email,
      password,
    });

    res.status(StatusCodes.CREATED).json({
      success: true,
      message: registerResult.confirmationMessage,
      welcomeMessage: registerResult.welcomeMessage,
      user: registerResult.user,
      confirmationUrl: registerResult.confirmationUrl,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Handles user login requests.
 */
export const loginController = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const authResult = await loginService({ email, password });

    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Login successful.',
      user: authResult.user,
      token: authResult.token,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Handles email confirmation requests.
 */
export const confirmEmailController = async (req, res, next) => {
  try {
    const { token } = req.body; // The token is expected to be sent in the request body for email confirmation.
    const result = await confirmEmailService({ token }); // Call the service function to confirm the email using the provided token.
    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Email confirmed successfully.',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
/** * Handles forgot password requests.
 */
export const forgotPasswordController = async (req, res, next) => {
  try {
    const { email } = req.body;
    await forgotPasswordService({ email });

    res.status(StatusCodes.OK).json({
      success: true,
      message:
        'If an account exists for this email, password recovery instructions were sent.',
    });
  } catch (error) {
    next(error);
  }
};
/** * Handles fetching questions list with optional filters.
 */
export const resetPasswordController = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    const result = await resetPasswordService({ token, newPassword });

    res.status(StatusCodes.OK).json({
      success: true,
      message:
        'Password reset successful. You can now sign in with your new password.',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
