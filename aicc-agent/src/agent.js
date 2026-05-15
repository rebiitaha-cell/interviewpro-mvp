'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { buildSystemPrompt } = require('./system-prompt');
const { shellRead, shellExec } = require('./tools/shell');
const { gitOps } = require('./tools/git');
const { dbQuery } = require('./tools/db');
const { telegramSend } = require('./tools/telegram');

// ---------------------------------------------------------------------------
// Cost tracking (claude-sonnet-4-6 pricing as of 2025)
// Input:  $3.00 / 1M tokens
// Output: $15.00 / 1M tokens
// Cache read: $0.30 / 1M tokens
// Cache write: $3.75 / 1M tokens
// ---------------------------------------------------------------------------
const COST_PER_INPUT_TOKEN = 3.0 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 15.0 / 1_000_000;
const COST_PER_CACHE_READ_TOKEN = 0.3 / 1_000_000;
const COST_PER_CACHE_WRITE_TOKEN = 3.75 / 1_000_000;

const MAX_ITERATIONS = 15;
const MAX_BUDGET_USD = 2.0;
const MODEL = 'claude-sonnet-4-6';

// ---------------------------------------------------------------------------
// Tool definitions for the Anthropic API
// ---------------------------------------------------------------------------
const TOOL_DEFINITIONS = [
  {
    name: 'shell_read',
    description:
      'Read the contents of a file from the project directory (read-only, restricted to PROJECT_ROOT). ' +
      'If the path is a directory, returns a listing. File size is capped at 100KB.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Relative or absolute path to the file or directory. Absolute paths are resolved relative to PROJECT_ROOT.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'shell_exec',
    description:
      'Execute a shell command in the project directory with safety checks. ' +
      'Allowed commands: npm, npx, node, git, ls, cat, grep, find, diff, echo, curl, cp, mv, mkdir, touch, stat, du, df, head, tail, wc, sort, uniq, awk, sed, file, which, whoami, uname, date, pwd, test. ' +
      'Dangerous commands (rm -rf, DROP TABLE, etc.) are automatically blocked.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute.',
        },
        reason: {
          type: 'string',
          description: 'Explain why this command is needed (required for audit trail).',
        },
      },
      required: ['command', 'reason'],
    },
  },
  {
    name: 'git_ops',
    description:
      'Perform git operations on the project repository. NEVER commits or pushes to main or master. ' +
      'Always create a feature/ branch before making any modifications.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['branch', 'commit', 'push', 'status', 'diff', 'log'],
          description: 'The git action to perform.',
        },
        branch: {
          type: 'string',
          description: 'Branch name (required for action=branch). Will be prefixed with feature/ if not already scoped.',
        },
        message: {
          type: 'string',
          description: 'Commit message (required for action=commit).',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'db_query',
    description:
      'Execute a read-only SQL SELECT query against the configured PostgreSQL database. ' +
      'Only SELECT statements are permitted. Destructive queries (DROP, TRUNCATE, DELETE, INSERT, UPDATE) are blocked.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The SQL SELECT query to execute.',
        },
        database: {
          type: 'string',
          description: 'Database name to query (defaults to configured POSTGRES_DB).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'telegram_send',
    description:
      'Send a progress update or the final mission report to Telegram. ' +
      'Use this to send intermediate updates and the mandatory final report.',
    input_schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message text to send.',
        },
        parse_mode: {
          type: 'string',
          enum: ['Markdown', 'HTML', 'MarkdownV2'],
          description: 'Optional Telegram parse mode for formatting.',
        },
      },
      required: ['message'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------
async function dispatchTool(toolName, toolInput) {
  switch (toolName) {
    case 'shell_read':
      return shellRead(toolInput);
    case 'shell_exec':
      return shellExec(toolInput);
    case 'git_ops':
      return gitOps(toolInput);
    case 'db_query':
      return dbQuery(toolInput);
    case 'telegram_send':
      return telegramSend(toolInput);
    default:
      return `Error: Unknown tool "${toolName}"`;
  }
}

// ---------------------------------------------------------------------------
// Cost calculation
// ---------------------------------------------------------------------------
function calculateCost(usage) {
  if (!usage) return 0;
  const inputCost = (usage.input_tokens || 0) * COST_PER_INPUT_TOKEN;
  const outputCost = (usage.output_tokens || 0) * COST_PER_OUTPUT_TOKEN;
  const cacheReadCost = (usage.cache_read_input_tokens || 0) * COST_PER_CACHE_READ_TOKEN;
  const cacheWriteCost = (usage.cache_creation_input_tokens || 0) * COST_PER_CACHE_WRITE_TOKEN;
  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

// ---------------------------------------------------------------------------
// ReAct agent loop
// ---------------------------------------------------------------------------
/**
 * Run the AICC agent for a given mission.
 *
 * @param {object} params
 * @param {string} params.auditId       - Unique identifier for this mission
 * @param {string} params.mission       - The task description from Telegram
 * @param {string} params.projectSlug   - Project identifier (e.g. "interviewpro")
 * @param {function} params.onUpdate    - Callback for status updates: onUpdate({ status, message })
 * @returns {Promise<{ success: boolean, cost: number, iterations: number, durationMs: number }>}
 */
async function runAgent({ auditId, mission, projectSlug, onUpdate }) {
  const startTime = Date.now();
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const systemPrompt = buildSystemPrompt(auditId);
  const messages = [
    {
      role: 'user',
      content: `Mission: ${mission}\n\nProject: ${projectSlug}`,
    },
  ];

  let iterations = 0;
  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const log = (msg) => {
    console.log(`[AICC][${auditId}] ${msg}`);
    if (onUpdate) onUpdate({ status: 'running', message: msg });
  };

  log(`Starting mission: ${mission}`);

  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++;
      log(`Iteration ${iterations}/${MAX_ITERATIONS}`);

      // Budget check
      if (totalCost >= MAX_BUDGET_USD) {
        const budgetMsg = `Budget limit reached ($${totalCost.toFixed(4)} >= $${MAX_BUDGET_USD}). Stopping.`;
        log(budgetMsg);
        await telegramSend({
          message: `⚠️ AICC Audit #${auditId}: Budget limite atteinte ($${totalCost.toFixed(4)}). Mission interrompue.`,
        });
        break;
      }

      // Call Claude
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: TOOL_DEFINITIONS,
        messages,
      });

      // Track usage
      if (response.usage) {
        totalInputTokens += response.usage.input_tokens || 0;
        totalOutputTokens += response.usage.output_tokens || 0;
        totalCost += calculateCost(response.usage);
      }

      log(`Response stop_reason: ${response.stop_reason} | cost so far: $${totalCost.toFixed(4)}`);

      // Append assistant message
      messages.push({ role: 'assistant', content: response.content });

      // Check stop reason
      if (response.stop_reason === 'end_turn') {
        log('Agent completed (end_turn)');
        break;
      }

      if (response.stop_reason !== 'tool_use') {
        log(`Unexpected stop_reason: ${response.stop_reason}. Stopping.`);
        break;
      }

      // Collect all tool_use blocks
      const toolUseBlocks = response.content.filter((block) => block.type === 'tool_use');
      if (toolUseBlocks.length === 0) {
        log('No tool_use blocks despite stop_reason=tool_use. Stopping.');
        break;
      }

      // Execute all tool calls and collect results
      const toolResults = [];
      for (const toolBlock of toolUseBlocks) {
        const { id: toolUseId, name: toolName, input: toolInput } = toolBlock;
        log(`Calling tool: ${toolName} | input: ${JSON.stringify(toolInput).slice(0, 200)}`);

        let toolOutput;
        try {
          toolOutput = await dispatchTool(toolName, toolInput);
        } catch (err) {
          toolOutput = `Tool execution error: ${err.message}`;
        }

        log(`Tool ${toolName} result: ${String(toolOutput).slice(0, 200)}`);

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: String(toolOutput),
        });
      }

      // Append tool results as user message
      messages.push({ role: 'user', content: toolResults });
    }

    // If we hit max iterations without end_turn, send a summary
    if (iterations >= MAX_ITERATIONS) {
      log('Max iterations reached without completion');
      await telegramSend({
        message:
          `⚠️ AICC Audit #${auditId}: Nombre maximum d'itérations atteint (${MAX_ITERATIONS}). ` +
          `Mission interrompue.\n\n💰 Coût: $${totalCost.toFixed(4)}`,
      });
    }

    const durationMs = Date.now() - startTime;
    log(`Mission complete. Iterations: ${iterations}, Cost: $${totalCost.toFixed(4)}, Duration: ${durationMs}ms`);

    return {
      success: true,
      cost: totalCost,
      iterations,
      durationMs,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errMsg = `Agent fatal error: ${err.message}`;
    log(errMsg);

    // Try to notify via Telegram
    try {
      await telegramSend({
        message:
          `❌ AICC Audit #${auditId}: Erreur fatale durant la mission.\n` +
          `Erreur: ${err.message}\n\n💰 Coût: $${totalCost.toFixed(4)}`,
      });
    } catch (_) {
      // Ignore Telegram failure in error handler
    }

    return {
      success: false,
      error: err.message,
      cost: totalCost,
      iterations,
      durationMs,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    };
  }
}

module.exports = { runAgent };
