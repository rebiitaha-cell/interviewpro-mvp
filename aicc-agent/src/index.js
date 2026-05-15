'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { runAgent } = require('./agent');
const { sendRawTelegramMessage } = require('./tools/telegram');

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3010', 10);

// In-memory audit store (MVP — replace with postgres for persistence)
const audits = new Map();

// ---------------------------------------------------------------------------
// POST /agent/start
// Body: { mission: string, project_slug?: string }
// Returns immediately with audit_id; agent runs in background.
// ---------------------------------------------------------------------------
app.post('/agent/start', async (req, res) => {
  const { mission, project_slug = 'interviewpro' } = req.body;

  if (!mission || typeof mission !== 'string' || !mission.trim()) {
    return res.status(400).json({ error: 'mission is required and must be a non-empty string' });
  }

  const auditId = uuidv4().slice(0, 8).toUpperCase();
  const audit = {
    id: auditId,
    project_slug,
    mission: mission.trim(),
    status: 'pending',
    started_at: new Date().toISOString(),
    cost: null,
    duration_sec: null,
    iterations: null,
    error: null,
  };

  audits.set(auditId, audit);

  // Respond immediately
  res.json({ audit_id: auditId, status: 'started' });

  // Run agent in background (do not await)
  setImmediate(async () => {
    try {
      const result = await runAgent({
        auditId,
        mission: mission.trim(),
        projectSlug: project_slug,
        onUpdate: ({ status, message }) => {
          if (audits.has(auditId)) {
            audits.get(auditId).status = status;
          }
          console.log(`[${auditId}] ${message}`);
        },
      });

      if (audits.has(auditId)) {
        const a = audits.get(auditId);
        a.status = result.success ? 'done' : 'error';
        a.cost = result.cost?.toFixed(4);
        a.duration_sec = (result.durationMs / 1000).toFixed(1);
        a.iterations = result.iterations;
        a.error = result.error || null;
        a.finished_at = new Date().toISOString();
      }
    } catch (err) {
      console.error(`[${auditId}] Unhandled agent error:`, err.message);
      if (audits.has(auditId)) {
        audits.get(auditId).status = 'error';
        audits.get(auditId).error = err.message;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// GET /agent/status/:id
// ---------------------------------------------------------------------------
app.get('/agent/status/:id', (req, res) => {
  const audit = audits.get(req.params.id);
  if (!audit) {
    return res.status(404).json({ error: `Audit ${req.params.id} not found` });
  }
  res.json(audit);
});

// ---------------------------------------------------------------------------
// GET /agent/list  — last 20 audits
// ---------------------------------------------------------------------------
app.get('/agent/list', (_req, res) => {
  const list = Array.from(audits.values())
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, 20);
  res.json(list);
});

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[AICC] Agent server running on port ${PORT}`);
  console.log(`[AICC] PROJECT_ROOT = ${process.env.PROJECT_ROOT || '/var/www/interviewpro-v2'}`);
  console.log(`[AICC] Model = claude-sonnet-4-6`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[AICC] WARNING: ANTHROPIC_API_KEY not set');
  }
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.warn('[AICC] WARNING: TELEGRAM_BOT_TOKEN not set — Telegram reporting disabled');
  }
});

module.exports = app;
