'use strict';

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const execAsync = promisify(exec);

const PROJECT_ROOT = process.env.PROJECT_ROOT || '/var/www/interviewpro-v2';

// Commands that are strictly blocked — no exceptions
const BLOCKED_PATTERNS = [
  /rm\s+-rf?\s*\/(?!var\/www\/interviewpro)/i,  // rm -rf targeting anything outside project
  /rm\s+-rf?\s*\//i,                             // rm -rf /anything
  /DROP\s+TABLE/i,
  /TRUNCATE\s+TABLE/i,
  />\s*\/etc\//i,
  />\s*\/root\//i,
  /cat\s+\/etc\/shadow/i,
  /cat\s+\/etc\/passwd/i,
  /chmod\s+777\s+\//i,
  /mkfs/i,
  /dd\s+if=/i,
  /format\s+[a-z]:/i,
];

// Commands that require a WARN/confirmation step (soft block)
const WARN_PATTERNS = [
  /DROP\s+DATABASE/i,
  /rm\s+-r/i,
  /git\s+reset\s+--hard/i,
  /DELETE\s+FROM\s+\w+\s*(?!.*WHERE)/i,  // DELETE without WHERE
  /TRUNCATE/i,
];

// Allowed command prefixes/patterns (whitelist)
const ALLOWED_COMMANDS = [
  /^npm\s/,
  /^npx\s/,
  /^node\s/,
  /^git\s/,
  /^ls(\s|$)/,
  /^cat\s/,
  /^grep\s/,
  /^find\s/,
  /^diff\s/,
  /^echo\s/,
  /^pwd(\s|$)/,
  /^which\s/,
  /^whoami(\s|$)/,
  /^uname(\s|$)/,
  /^date(\s|$)/,
  /^curl\s/,
  /^wc\s/,
  /^head\s/,
  /^tail\s/,
  /^sort\s/,
  /^uniq\s/,
  /^awk\s/,
  /^sed\s/,
  /^cp\s/,
  /^mv\s/,
  /^mkdir\s/,
  /^touch\s/,
  /^test\s/,
  /^stat\s/,
  /^file\s/,
  /^du\s/,
  /^df\s/,
];

/**
 * Check if a command is in the allowed whitelist.
 */
function isCommandAllowed(command) {
  const trimmed = command.trim();
  return ALLOWED_COMMANDS.some((pattern) => pattern.test(trimmed));
}

/**
 * Check if a command matches any blocked pattern.
 */
function isCommandBlocked(command) {
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(command));
}

/**
 * Check if a command matches any warn pattern.
 */
function isCommandWarn(command) {
  return WARN_PATTERNS.some((pattern) => pattern.test(command));
}

/**
 * Resolve and validate a file path stays within PROJECT_ROOT.
 */
function safePath(filePath) {
  const resolved = path.resolve(PROJECT_ROOT, filePath.replace(/^\//, ''));
  if (!resolved.startsWith(PROJECT_ROOT)) {
    throw new Error(`Path escapes project root: ${filePath}`);
  }
  return resolved;
}

/**
 * shell_read tool — read a file from the project directory.
 * @param {{ path: string }} params
 * @returns {Promise<string>}
 */
async function shellRead({ path: filePath }) {
  if (!filePath) {
    return 'Error: path parameter is required';
  }

  let resolvedPath;
  try {
    resolvedPath = safePath(filePath);
  } catch (err) {
    return `Error: ${err.message}`;
  }

  try {
    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(resolvedPath);
      return `Directory listing for ${resolvedPath}:\n${entries.join('\n')}`;
    }

    // Limit file size to 100KB
    if (stat.size > 100 * 1024) {
      return `Error: File too large (${stat.size} bytes). Use shell_exec with head/tail/grep to inspect parts.`;
    }

    const content = fs.readFileSync(resolvedPath, 'utf8');
    return content;
  } catch (err) {
    return `Error reading ${resolvedPath}: ${err.message}`;
  }
}

/**
 * shell_exec tool — execute a shell command with safety checks.
 * @param {{ command: string, reason: string }} params
 * @returns {Promise<string>}
 */
async function shellExec({ command, reason }) {
  if (!command) {
    return 'Error: command parameter is required';
  }
  if (!reason) {
    return 'Error: reason parameter is required — explain why this command is needed';
  }

  // Hard block
  if (isCommandBlocked(command)) {
    return `BLOCKED: Command "${command}" matches a forbidden pattern and cannot be executed. Reason attempted: ${reason}`;
  }

  // Soft warn — return a warning but still execute for non-destructive warns
  const warned = isCommandWarn(command);

  // Whitelist check
  if (!isCommandAllowed(command)) {
    return `BLOCKED: Command "${command}" is not in the allowed command whitelist. Allowed prefixes: npm, npx, node, git, ls, cat, grep, find, diff, echo, curl, cp, mv, mkdir, touch, stat, du, df, head, tail, wc, sort, uniq, awk, sed, file, which, whoami, uname, date, pwd, test`;
  }

  // Auto-backup before write operations
  const writeMatch = command.match(/>\s*([^\s|&;]+)/);
  if (writeMatch) {
    const targetFile = writeMatch[1];
    if (fs.existsSync(targetFile)) {
      const backupPath = `${targetFile}.bak.${Date.now()}`;
      try {
        fs.copyFileSync(targetFile, backupPath);
      } catch (_) {
        // Non-fatal — backup attempt only
      }
    }
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: 30000,
      maxBuffer: 1024 * 1024, // 1MB output limit
      cwd: PROJECT_ROOT,
    });

    let result = '';
    if (warned) {
      result += `⚠️  WARNING: This command matched a potentially dangerous pattern.\n\n`;
    }
    if (stdout) result += `STDOUT:\n${stdout}`;
    if (stderr) result += `STDERR:\n${stderr}`;
    if (!stdout && !stderr) result += '(no output)';

    return result.trim();
  } catch (err) {
    return `Error executing command: ${err.message}\n${err.stderr || ''}`.trim();
  }
}

module.exports = { shellRead, shellExec };
