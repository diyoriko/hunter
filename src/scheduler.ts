import cron from 'node-cron';
import type { Bot } from 'grammy';
import { runAllScrapers } from './scrapers/runner';
import { getAllUsers, getUnnotifiedHighScoreVacancies, markVacanciesNotified, getDigestSummary, setKV } from './db';
import { formatVacancyDetail, vacancyButtons } from './digest';
import { logger } from './logger';
import { CONFIG } from './config';

const tasks: cron.ScheduledTask[] = [];
let isRunning = false;

export function startScheduler(bot: Bot): void {
  if (!CONFIG.scheduler.enabled) {
    logger.info('scheduler', 'Scheduler disabled via SCHEDULER_ENABLED=false');
    return;
  }

  const { scrapeCron, digestCron, timezone } = CONFIG.scheduler;

  tasks.push(cron.schedule(scrapeCron, () => { runScheduledScrape(bot); }, { timezone }));
  tasks.push(cron.schedule(digestCron, () => { sendMorningDigest(bot); }, { timezone }));

  logger.info('scheduler', 'Scheduler started: scrape 09:00/13:00/17:00 MSK, digest 09:15 MSK');
}

export function stopScheduler(): void {
  for (const task of tasks) task.stop();
  tasks.length = 0;
  logger.info('scheduler', 'Scheduler stopped');
}

async function runScheduledScrape(bot: Bot): Promise<void> {
  if (isRunning) {
    logger.warn('scheduler', 'Scrape already running, skipping');
    return;
  }

  isRunning = true;
  const startTime = Date.now();

  try {
    logger.info('scheduler', 'Starting scheduled scrape');
    const results = await runAllScrapers();

    const totalNew = results.reduce((sum, r) => sum + r.new, 0);
    logger.info('scheduler', `Scheduled scrape complete: ${totalNew} new vacancies`, {
      duration: Date.now() - startTime,
    });

    await sendPushNotifications(bot);
    setKV('last_auto_scrape', new Date().toISOString());
  } catch (err) {
    logger.error('scheduler', 'Scheduled scrape failed', { error: String(err) });
    try {
      await bot.api.sendMessage(CONFIG.adminTelegramId, `Scheduler error: ${String(err)}`);
    } catch { /* silent */ }
  } finally {
    isRunning = false;
  }
}

async function sendPushNotifications(bot: Bot): Promise<void> {
  const users = getAllUsers();
  const { pushMinScore, pushMaxCards } = CONFIG.scheduler;
  let totalSent = 0;

  for (const user of users) {
    try {
      const vacancies = getUnnotifiedHighScoreVacancies(user.id, pushMinScore);
      if (vacancies.length === 0) continue;

      const toSend = vacancies.slice(0, pushMaxCards);

      await bot.api.sendMessage(
        user.telegramId,
        `<b>Новые вакансии</b> (${toSend.length} с высоким скором)`,
        { parse_mode: 'HTML' },
      );

      for (const v of toSend) {
        await bot.api.sendMessage(
          user.telegramId,
          formatVacancyDetail(v),
          {
            parse_mode: 'HTML',
            reply_markup: vacancyButtons(v.id),
            link_preview_options: { is_disabled: true },
          },
        );
        await sleep(100);
      }

      markVacanciesNotified(user.id, vacancies.map(v => v.id));
      totalSent += toSend.length;
    } catch (err) {
      logger.warn('scheduler', `Push failed for user ${user.telegramId}`, { error: String(err) });
    }
  }

  logger.info('scheduler', `Push notifications: ${totalSent} vacancies sent`);
}

async function sendMorningDigest(bot: Bot): Promise<void> {
  const users = getAllUsers();
  let sent = 0;

  for (const user of users) {
    try {
      const summary = getDigestSummary(user.id);
      if (summary.total === 0) continue;

      const text = [
        '<b>Утренний дайджест</b>',
        '',
        `Новых вакансий: ${summary.total}`,
        summary.highScore > 0 ? `Высокий скор (70+): ${summary.highScore}` : '',
        '',
        'Нажми <b>Дайджест</b>, чтобы посмотреть.',
      ].filter(Boolean).join('\n');

      await bot.api.sendMessage(user.telegramId, text, { parse_mode: 'HTML' });
      await sleep(100);
      sent++;
    } catch (err) {
      logger.warn('scheduler', `Digest failed for user ${user.telegramId}`, { error: String(err) });
    }
  }

  logger.info('scheduler', `Morning digest sent to ${sent} users`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
