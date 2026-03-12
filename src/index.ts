import { createBot } from './bot';
import { startScheduler } from './scheduler';
import { getDb } from './db';
import { logger } from './logger';

async function main() {
  logger.info('main', 'Hunter v0.1.0 starting...');

  // Init DB (creates tables if needed)
  getDb();

  // Create bot
  const bot = createBot();

  // Start scheduler
  startScheduler(bot);

  // Start polling
  await bot.start({
    onStart: () => {
      logger.info('main', 'Bot is running. Polling started.');
    },
  });
}

main().catch((err) => {
  logger.error('main', 'Fatal error', { error: String(err) });
  process.exit(1);
});
