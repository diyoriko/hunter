import cron from 'node-cron';
import type { Bot } from 'grammy';
import { CONFIG } from './config';
import { logger } from './logger';
import { runAllScrapers } from './scrapers/runner';
import { sendDigestToAdmin, sendScrapeNotification } from './bot';

/**
 * Schedule automatic scraping and daily digest.
 * All times in Moscow (UTC+3).
 */
export function startScheduler(bot: Bot): void {
  // Scrape 3 times a day: 09:00, 13:00, 17:00 MSK
  for (const time of CONFIG.scrapeIntervals) {
    const [hour, minute] = time.split(':');
    const cronExpr = `${minute} ${hour} * * *`;

    cron.schedule(cronExpr, async () => {
      logger.info('scheduler', `Scheduled scrape at ${time} MSK`);
      try {
        const results = await runAllScrapers();
        await sendScrapeNotification(bot, results);
      } catch (err) {
        logger.error('scheduler', 'Scheduled scrape failed', { error: String(err) });
      }
    }, { timezone: 'Europe/Moscow' });

    logger.info('scheduler', `Scrape scheduled at ${time} MSK`);
  }

  // Daily digest at 20:00 MSK
  const [dHour, dMinute] = CONFIG.digestTime.split(':');
  cron.schedule(`${dMinute} ${dHour} * * *`, async () => {
    logger.info('scheduler', 'Sending daily digest');
    try {
      await sendDigestToAdmin(bot);
    } catch (err) {
      logger.error('scheduler', 'Digest failed', { error: String(err) });
    }
  }, { timezone: 'Europe/Moscow' });

  logger.info('scheduler', `Digest scheduled at ${CONFIG.digestTime} MSK`);
}
