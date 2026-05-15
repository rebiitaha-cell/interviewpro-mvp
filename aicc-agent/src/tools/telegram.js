'use strict';

const axios = require('axios');

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * telegram_send tool — send a message to the configured Telegram chat.
 * @param {{ message: string, parse_mode?: string }} params
 * @returns {Promise<string>}
 */
async function telegramSend({ message, parse_mode }) {
  if (!message) {
    return 'Error: message parameter is required';
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken) {
    console.warn('[telegram_send] TELEGRAM_BOT_TOKEN not set — skipping send');
    return `[DRY RUN — TELEGRAM_BOT_TOKEN not configured] Would send:\n${message}`;
  }
  if (!chatId) {
    console.warn('[telegram_send] TELEGRAM_CHAT_ID not set — skipping send');
    return `[DRY RUN — TELEGRAM_CHAT_ID not configured] Would send:\n${message}`;
  }

  const validParseModes = ['Markdown', 'HTML', 'MarkdownV2'];
  const resolvedParseMode = validParseModes.includes(parse_mode) ? parse_mode : undefined;

  // Telegram has a 4096-character limit per message
  const MAX_LENGTH = 4096;
  const chunks = [];
  for (let i = 0; i < message.length; i += MAX_LENGTH) {
    chunks.push(message.slice(i, i + MAX_LENGTH));
  }

  const results = [];
  for (const chunk of chunks) {
    try {
      const payload = {
        chat_id: chatId,
        text: chunk,
        ...(resolvedParseMode ? { parse_mode: resolvedParseMode } : {}),
      };

      const response = await axios.post(
        `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`,
        payload,
        { timeout: 10000 }
      );

      if (response.data && response.data.ok) {
        results.push(`Message sent successfully (message_id: ${response.data.result.message_id})`);
      } else {
        results.push(`Telegram API error: ${JSON.stringify(response.data)}`);
      }
    } catch (err) {
      const errMsg = err.response
        ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
        : err.message;
      results.push(`Error sending to Telegram: ${errMsg}`);
    }
  }

  return results.join('\n');
}

/**
 * Standalone helper (not a tool) to send a raw message without going through the tool interface.
 * Used by index.js to send the initial confirmation.
 */
async function sendRawTelegramMessage(text, parseMode) {
  return telegramSend({ message: text, parse_mode: parseMode });
}

module.exports = { telegramSend, sendRawTelegramMessage };
