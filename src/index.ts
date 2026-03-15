import http from 'node:http';
import fs from 'node:fs';
import { Bot } from 'grammy';
import { createBot } from './bot';
import { getDb, getKV, setKV, getGlobalStats, getApprovedProposals, deleteProposals, saveProposal } from './db';
import { CONFIG } from './config';
import { logger } from './logger';
import { startScheduler, stopScheduler } from './scheduler';

async function notifyDeploy(bot: Bot): Promise<void> {
  const lastVersion = getKV('deployed_version');
  if (lastVersion === CONFIG.version) return;

  const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

  const m = getGlobalStats();

  const text = [
    `🚀 <b>Hunter ${CONFIG.version}</b>`,
    `<i>${date}</i>`,
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    ...CONFIG.deployNotes,
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    '<b>📊 Метрики</b>',
    `  Юзеров: ${m.totalUsers}`,
    `  Pro: ${m.proUsers}`,
    `  Вакансий: ${m.totalVacancies}`,
    `  Писем: ${m.totalCoverLetters}`,
    `  Средний скор: ${m.avgScore}`,
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
    { command: 'start', description: 'Начать / перезапустить' },
    { command: 'digest', description: 'Дайджест вакансий' },
    { command: 'profile', description: 'Мой профиль' },
    { command: 'stats', description: 'Статистика' },
    { command: 'subscribe', description: 'Тарифы и подписка' },
  ]);

  // HTTP server (health check + backup)
  const port = parseInt(process.env.PORT ?? '3000', 10);
  http.createServer((req, res) => {
    // GET / — health check
    if (req.url === '/' || req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ status: 'ok', version: CONFIG.version }));
      return;
    }

    // GET /backup — download SQLite database (auth required)
    if (req.url === '/backup' && req.method === 'GET') {
      const token = req.headers['x-admin-token'];
      if (token !== CONFIG.telegramBotToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const dbPath = CONFIG.dbPath;
      if (!fs.existsSync(dbPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'database not found' }));
        return;
      }
      // Checkpoint WAL to ensure backup includes all committed data
      try { getDb().pragma('wal_checkpoint(TRUNCATE)'); } catch {}
      const stat = fs.statSync(dbPath);
      const date = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="jobs-backup-${date}.db"`,
        'Content-Length': stat.size,
      });
      fs.createReadStream(dbPath).pipe(res);
      return;
    }

    // GET /stats — global metrics (auth required)
    if (req.url === '/stats' && req.method === 'GET') {
      const token = req.headers['x-admin-token'];
      if (token !== CONFIG.telegramBotToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const stats = getGlobalStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
      return;
    }

    // POST /proposal — save a new proposal (auth required)
    if (req.url === '/proposal' && req.method === 'POST') {
      const token = req.headers['x-admin-token'];
      if (token !== CONFIG.telegramBotToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { task_text } = JSON.parse(body);
          if (!task_text) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'task_text required' }));
            return;
          }
          const id = saveProposal(task_text);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
        }
      });
      return;
    }

    // GET /proposals — fetch approved proposals and delete them (auth required)
    if (req.url === '/proposals' && req.method === 'GET') {
      const token = req.headers['x-admin-token'];
      if (token !== CONFIG.telegramBotToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const proposals = getApprovedProposals();
      // Delete fetched proposals so they're only consumed once
      if (proposals.length > 0) {
        deleteProposals(proposals.map(p => p.id));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ proposals }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  }).listen(port, () => {
    logger.info('main', `HTTP server on :${port} — /, /backup, /stats, /proposals`);
  });

  // Graceful shutdown — stop polling before Railway kills the process
  const shutdown = () => {
    logger.info('main', 'Shutting down gracefully...');
    stopScheduler();
    bot.stop();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  // Start polling
  await bot.start({
    onStart: async () => {
      logger.info('main', 'Bot is running. Polling started.');
      startScheduler(bot);
      await notifyDeploy(bot);
    },
  });
}

main().catch((err) => {
  logger.error('main', 'Fatal error', { error: String(err) });
  process.exit(1);
});
