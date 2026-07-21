// This module sets up the MySQL database connection pool and provides a safe wrapper for executing SQL queries with parameter validation to prevent SQL injection.
import 'dotenv/config';
import mysql from 'mysql2/promise';

// A pool is used instead of a single connection so multiple requests can
// run queries concurrently without waiting for each other.
export const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  // DB_PASS is a fallback alias kept for local dev convenience.
  password: process.env.DB_PASSWORD || process.env.DB_PASS || "",
  database: process.env.DB_NAME || "evangadi_forum",
  ssl: {
    ca: process.env.DB_CA_CERT.replace(/\\n/g, "\n"),
  },
});

// Guards against calling db.execute with undefined/null params, which would cause a runtime error. Also ensures params is an array or object, which is what mysql2 expects.
const ensureParams = (params) => {
  if (params === undefined || params === null) {
    throw new Error('SQL parameters are required');
  }
  const isArray = Array.isArray(params);
  const isObject = !isArray && typeof params === 'object';
  if (!isArray && !isObject) {
    throw new Error('SQL parameters must be an array or object');
  }
};

// All DB writes/reads go through this wrapper so param validation is never
// skipped and callers get a consistent throw on bad input.
export const safeExecute = async (sql, params) => {
  if (typeof sql !== 'string' || sql.trim().length === 0) {
    throw new Error('SQL query must be a non-empty string');
  }
  ensureParams(params);
  const [result] = await db.execute(sql, params);
  return result;
};
