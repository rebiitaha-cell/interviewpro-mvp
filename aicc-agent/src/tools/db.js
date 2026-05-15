'use strict';

const { Pool } = require('pg');

// Lazy-initialize pool so the module can be imported without crashing
// when DB env vars aren't present.
let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.POSTGRES_HOST || 'postgres',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      database: process.env.POSTGRES_DB || 'aicc_db',
      user: process.env.POSTGRES_USER || 'aicc',
      password: process.env.POSTGRES_PASSWORD || 'aicc_password',
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

// Patterns that are never allowed (hard block)
const BLOCKED_SQL_PATTERNS = [
  /^\s*DROP\s+(TABLE|DATABASE|SCHEMA|INDEX)/i,
  /^\s*TRUNCATE/i,
  /^\s*DELETE\s+FROM/i,
  /^\s*INSERT\s+INTO/i,
  /^\s*UPDATE\s+\w+\s+SET/i,
  /^\s*ALTER\s+TABLE/i,
  /^\s*CREATE\s+TABLE/i,
  /^\s*GRANT\s/i,
  /^\s*REVOKE\s/i,
];

// Pattern for allowed read-only queries
const READONLY_PATTERN = /^\s*SELECT\s/i;

/**
 * db_query tool — execute a read-only SQL query.
 * @param {{ query: string, database?: string }} params
 * @returns {Promise<string>}
 */
async function dbQuery({ query, database }) {
  if (!query) {
    return 'Error: query parameter is required';
  }

  const trimmedQuery = query.trim();

  // Hard block destructive operations
  for (const pattern of BLOCKED_SQL_PATTERNS) {
    if (pattern.test(trimmedQuery)) {
      return `BLOCKED: Query matches a forbidden destructive pattern. Only SELECT queries are allowed.\nQuery: ${trimmedQuery}`;
    }
  }

  // Enforce read-only: only SELECT statements
  if (!READONLY_PATTERN.test(trimmedQuery)) {
    return `BLOCKED: Only SELECT queries are permitted. Received: ${trimmedQuery.substring(0, 100)}`;
  }

  // If a specific database is requested but doesn't match configured DB, warn
  if (database && database !== process.env.POSTGRES_DB) {
    return `BLOCKED: Cross-database queries are not supported. Configured database: ${process.env.POSTGRES_DB || 'aicc_db'}`;
  }

  let client;
  try {
    client = await getPool().connect();

    // Set statement timeout to 10 seconds for safety
    await client.query('SET statement_timeout = 10000');

    const result = await client.query(trimmedQuery);

    const rows = result.rows;
    const rowCount = result.rowCount;

    if (rows.length === 0) {
      return `Query returned 0 rows.\n\nColumns: ${result.fields.map((f) => f.name).join(', ')}`;
    }

    // Format output as a readable table (limited to 50 rows for safety)
    const displayRows = rows.slice(0, 50);
    const columns = result.fields.map((f) => f.name);
    const header = columns.join(' | ');
    const separator = columns.map((c) => '-'.repeat(c.length)).join('-+-');
    const rowLines = displayRows.map((row) =>
      columns.map((col) => String(row[col] ?? 'NULL')).join(' | ')
    );

    let output = `Query OK — ${rowCount} row(s) returned`;
    if (rows.length > 50) {
      output += ` (showing first 50)`;
    }
    output += `\n\n${header}\n${separator}\n${rowLines.join('\n')}`;

    return output;
  } catch (err) {
    return `Database error: ${err.message}`;
  } finally {
    if (client) {
      client.release();
    }
  }
}

module.exports = { dbQuery };
