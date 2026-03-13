import http from 'node:http';
import { Bot } from 'grammy';
import { createBot } from './bot';
import { getDb, getKV, setKV } from './db';
import { CONFIG } from './config';
import { logger } from './logger';

async function notifyDeploy(bot: Bot): Promise<void> {
  const lastVersion = getKV('deployed_version');
  if (lastVersion === CONFIG.version) return;

  const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

  const text = [
    `🚀 <b>Hunter ${CONFIG.version}</b>`,
    `<i>${date}</i>`,
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    ...CONFIG.deployNotes,
  ].join('\n');

  try {
    await bot.api.sendMessage(CONFIG.adminTelegramId, text, { parse_mode: 'HTML' });
    logger.info('deploy', `Deploy notification sent: ${CONFIG.version}`);
  } catch (e) {
    logger.warn('deploy', 'Failed to send deploy notification', { error: String(e) });
  }

  setKV('deployed_version', CONFIG.version);
}

async function main() {
  logger.info('main', `Hunter v${CONFIG.version} starting...`);

  // Init DB
  getDb();

  // Create bot
  const bot = createBot();

  // Set bot commands (replaces paperclip with menu)
  await bot.api.setMyCommands([
    { command: 'start', description: '\u041D\u0430\u0447\u0430\u0442\u044C / \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C' },
    { command: 'search', description: '\u041D\u0430\u0439\u0442\u0438 \u0432\u0430\u043A\u0430\u043D\u0441\u0438\u0438' },
    { command: 'digest', description: '\u0414\u0430\u0439\u0434\u0436\u0435\u0441\u0442 \u0432\u0430\u043A\u0430\u043D\u0441\u0438\u0439' },
    { command: 'profile', description: '\u041C\u043E\u0439 \u043F\u0440\u043E\u0444\u0438\u043B\u044C' },
    { command: 'stats', description: '\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430' },
  ]);

  // Health check HTTP server (for Railway)
  const port = parseInt(process.env.PORT ?? '3000', 10);
  http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: CONFIG.version }));
  }).listen(port, () => {
    logger.info('main', `Health check listening on :${port}`);
  });

  // Graceful shutdown — stop polling before Railway kills the process
  const shutdown = () => {
    logger.info('main', 'Shutting down gracefully...');
    bot.stop();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  // Start polling
  await bot.start({
    onStart: async () => {
      logger.info('main', 'Bot is running. Polling started.');
      await notifyDeploy(bot);
    },
  });
}

main().catch((err) => {
  logger.error('main', 'Fatal error', { error: String(err) });
  process.exit(1);
});
