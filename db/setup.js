/**
 * Full database setup: applies schema.sql then all UP migration files in order.
 * Run once on a fresh database, or to upgrade an existing one.
 *
 * Safe to re-run:
 *  - schema.sql uses DROP TABLE IF EXISTS + CREATE TABLE (idempotent, but destructive on existing data)
 *  - migration ALTER TABLEs that add already-present columns emit a warning and continue
 *  - CREATE TABLE IF NOT EXISTS is always idempotent
 *
 * Usage: node db/setup.js
 */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { db } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IGNORED_MYSQL_ERRORS = new Set([
  1060, // ER_DUP_FIELDNAME  — duplicate column name (column already added)
  1061, // ER_DUP_KEYNAME    — duplicate key name (index already added)
  1050, // ER_TABLE_EXISTS_ERROR — table already exists (covered by IF NOT EXISTS but just in case)
]);

function splitStatements(sql) {
  // Strip single-line comments first so semicolons inside comments don't
  // become false statement boundaries.
  const stripped = sql.replace(/--[^\n]*/g, '');
  return stripped
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

async function runFile(conn, filePath, label) {
  const sql = readFileSync(filePath, 'utf8');
  const statements = splitStatements(sql);
  let skipped = 0;

  for (const stmt of statements) {
    try {
      await conn.query(stmt);
    } catch (err) {
      if (IGNORED_MYSQL_ERRORS.has(err.errno)) {
        skipped++;
        continue;
      }
      console.error(`\n❌ Error in ${label}:\n   ${stmt.slice(0, 120)}...\n   ${err.message}`);
      throw err;
    }
  }

  if (skipped > 0) {
    console.log(`   (${skipped} statement(s) skipped — columns/tables already exist)`);
  }
}

async function setup() {
  const conn = await db.getConnection();

  try {
    // 1. Base schema (drops and recreates all core tables)
    const schemaPath = path.join(__dirname, 'schema.sql');
    console.log('▶ Applying schema.sql …');
    await runFile(conn, schemaPath, 'schema.sql');
    console.log('✅ schema.sql done');

    // 2. UP migration files in alphabetical order
    const migrationsDir = path.join(__dirname, 'migrations');
    const upFiles = readdirSync(migrationsDir)
      .filter(f => f.endsWith('_up.sql'))
      .sort();

    for (const file of upFiles) {
      const filePath = path.join(migrationsDir, file);
      console.log(`▶ Applying ${file} …`);
      await runFile(conn, filePath, file);
      console.log(`✅ ${file} done`);
    }

    console.log('\n🎉 Database setup complete.');
  } finally {
    conn.release();
    await db.end();
  }
}

setup().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
