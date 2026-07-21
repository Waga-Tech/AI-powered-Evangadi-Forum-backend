// dotenv must be configured before any other import reads process.env.
import dotenv from "dotenv";
dotenv.config();

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { db } from './db/config.js';
import { mainRouter } from './src/api/routes.js';
import { errorHandler } from './src/middleware/error-handler.js';
import { initAuthTables } from './src/api/auth/service/auth.service.js';

const app = express();
const port = process.env.PORT || 5004;

// ---------------------------------------------------------------------------
// Startup env validation — fail fast rather than crash mid-request.
// ---------------------------------------------------------------------------
const validateEnv = () => {
  const required = ['JWT_SECRET', 'DB_HOST', 'DB_USER'];
  for (const env of required) {
    if (!process.env[env]) {
      throw new Error(`Missing required environment variable: ${env}`);
    }
  }

  if (!process.env.DB_PASSWORD && !process.env.DB_PASS) {
    throw new Error('Missing required environment variable: DB_PASSWORD or DB_PASS');
  }
};

validateEnv();

// ---------------------------------------------------------------------------
// Security headers (helmet)
// Sets Content-Security-Policy, X-Frame-Options, X-Content-Type-Options,
// Strict-Transport-Security, Referrer-Policy, and more.
// ---------------------------------------------------------------------------
app.use(helmet());

// ---------------------------------------------------------------------------
// CORS — only allow the configured frontend origin.
// Set FRONTEND_URL in .env (e.g. http://localhost:5001 for dev,
// https://your-domain.com for production).
// ---------------------------------------------------------------------------
const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:5001';
app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));

// ---------------------------------------------------------------------------
// Body parsing — explicit size limits to prevent abuse on AI endpoints.
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

// ---------------------------------------------------------------------------
// Global rate limiter — broad protection across all /api/* routes.
// Auth-specific limiters (tighter) are applied per-route in auth.routes.js.
// ---------------------------------------------------------------------------
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { msg: 'Too many requests. Please try again in 15 minutes.' },
});

app.use('/api', globalLimiter);

// ---------------------------------------------------------------------------
// Health check — no timestamp to avoid leaking server state.
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api', mainRouter);

// errorHandler must be registered last so it catches errors from all routes.
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------
let server;

const startServer = async () => {
  try {
    const connection = await db.getConnection();
    console.log('Database connection established successfully.');
    connection.release();

    // Run one-time table migrations before accepting traffic.
    await initAuthTables();
    server = app.listen(port, err => {
      if (err) {
        console.error('Failed to start the server:', err.message);
        process.exit(1);
      }
      console.log(`Server running on http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Failed to connect to the database. Server not started.', error.message);
    process.exit(1);
  }
};

startServer();

// ---------------------------------------------------------------------------
// Graceful shutdown — drain connections before exiting.
// ---------------------------------------------------------------------------
const gracefulShutdown = async () => {
  console.log('Received shutdown signal. Closing server and database connections...');
  await new Promise((resolve) => server.close(resolve));
  await db.end();
  console.log('Database connections closed. Exiting process.');
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
