import { Bot, Context } from 'grammy';
import { CONFIG } from './config';
import { logger } from './logger';
import { getVacancyById, updateVacancyStatus, getTopVacancies } from './db';
import { runAllScrapers } from './scrapers/runner';
import { buildDigest, buildTop, buildStatsMessage } from './digest';
import { getCoverLetter, generateCoverLetter } from './cover-letter';

export function createBot(): Bot {
  const bot = new Bot(CONFIG.telegramBotToken);
  const adminOnly = (ctx: Context, next: () => Promise<void>) => {
    if (ctx.from?.id !== CONFIG.adminUserId) return;
    return next();
  };

  // --- Commands ---

  bot.command('start', adminOnly, async (ctx) => {
    await ctx.reply(
      '<b>Hunter Bot</b>\n\n' +
      'Умный агрегатор вакансий.\n\n' +
      '/scrape — запустить сбор\n' +
      '/digest — дайджест за сегодня\n' +
      '/top30 — топ-30 вакансий\n' +
      '/stats — статистика\n' +
      '/liked — лайкнутые вакансии\n' +
      '/cover_N — сопроводительное письмо для вакансии N',
      { parse_mode: 'HTML' }
    );
  });

  bot.command('scrape', adminOnly, async (ctx) => {
    await ctx.reply('Запускаю сбор вакансий...');

    try {
      const results = await runAllScrapers();
      const summary = results
        .map(r => `${r.source}: найдено ${r.found}, новых ${r.new}, топ-скор ${r.topScore}`)
        .join('\n');

      await ctx.reply(
        `<b>Сбор завершён</b>\n\n${summary}`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      logger.error('bot', 'Scrape failed', { error: String(err) });
      await ctx.reply(`Ошибка сбора: ${String(err)}`);
    }
  });

  bot.command('digest', adminOnly, async (ctx) => {
    const { text, count } = buildDigest();
    await sendLongMessage(ctx, text);
  });

  bot.command('top30', adminOnly, async (ctx) => {
    const text = buildTop(30);
    await sendLongMessage(ctx, text);
  });

  bot.command('stats', adminOnly, async (ctx) => {
    await ctx.reply(buildStatsMessage(), { parse_mode: 'HTML' });
  });

  bot.command('liked', adminOnly, async (ctx) => {
    const liked = getTopVacancies(50, 'liked');
    if (liked.length === 0) {
      await ctx.reply('Лайкнутых вакансий пока нет.');
      return;
    }

    const lines = liked.map((v, i) =>
      `${i + 1}. <b>${escapeHtml(v.title)}</b> — ${escapeHtml(v.company)} (${v.score}/100)\n   <a href="${v.url}">Открыть</a> · /applied_${v.id}`
    );

    await sendLongMessage(ctx, `<b>Лайкнутые вакансии (${liked.length})</b>\n\n${lines.join('\n\n')}`);
  });

  // --- Inline actions: /like_123, /reject_123, /applied_123 ---

  bot.on('message:text', adminOnly, async (ctx) => {
    const text = ctx.message.text;

    const likeMatch = text.match(/^\/like_(\d+)$/);
    if (likeMatch) {
      const id = parseInt(likeMatch[1], 10);
      const vacancy = getVacancyById(id);
      if (!vacancy) {
        await ctx.reply('Вакансия не найдена.');
        return;
      }
      updateVacancyStatus(id, 'liked');
      await ctx.reply(
        `Лайкнуто: <b>${escapeHtml(vacancy.title)}</b> — ${escapeHtml(vacancy.company)}\n\n<a href="${vacancy.url}">Открыть и откликнуться</a>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const rejectMatch = text.match(/^\/reject_(\d+)$/);
    if (rejectMatch) {
      const id = parseInt(rejectMatch[1], 10);
      updateVacancyStatus(id, 'rejected');
      await ctx.reply('Отклонено.');
      return;
    }

    const appliedMatch = text.match(/^\/applied_(\d+)$/);
    if (appliedMatch) {
      const id = parseInt(appliedMatch[1], 10);
      const vacancy = getVacancyById(id);
      if (!vacancy) {
        await ctx.reply('Вакансия не найдена.');
        return;
      }
      updateVacancyStatus(id, 'applied');
      await ctx.reply(`Отмечено как "откликнулся": <b>${escapeHtml(vacancy.title)}</b>`, { parse_mode: 'HTML' });
      return;
    }

    const coverMatch = text.match(/^\/cover_(\d+)$/);
    if (coverMatch) {
      const id = parseInt(coverMatch[1], 10);
      const vacancy = getVacancyById(id);
      if (!vacancy) {
        await ctx.reply('Вакансия не найдена.');
        return;
      }

      // Check if already generated
      let letter = getCoverLetter(id);
      if (!letter) {
        await ctx.reply('Генерирую письмо...');
        try {
          letter = await generateCoverLetter(vacancy);
        } catch (err) {
          logger.error('bot', 'Cover letter generation failed', { error: String(err) });
          await ctx.reply(`Ошибка генерации: ${String(err)}`);
          return;
        }
      }

      await ctx.reply(
        `<b>Сопроводительное для:</b> ${escapeHtml(vacancy.title)} — ${escapeHtml(vacancy.company)}\n\n` +
        `<code>${escapeHtml(letter)}</code>\n\n` +
        `<a href="${vacancy.url}">Открыть вакансию</a> · /like_${id}`,
        { parse_mode: 'HTML' }
      );
      return;
    }
  });

  // Error handler
  bot.catch((err) => {
    logger.error('bot', 'Unhandled error', { error: String(err.error) });
  });

  return bot;
}

/** Send digest as admin DM */
export async function sendDigestToAdmin(bot: Bot): Promise<void> {
  const { text, count } = buildDigest();
  if (count === 0) {
    logger.info('digest', 'No new vacancies today, skipping digest');
    return;
  }

  try {
    await sendLongMessageDirect(bot, CONFIG.adminUserId, text);
    logger.info('digest', `Digest sent: ${count} vacancies`);
  } catch (err) {
    logger.error('digest', 'Failed to send digest', { error: String(err) });
  }
}

/** Send scrape notification to admin */
export async function sendScrapeNotification(bot: Bot, results: { source: string; found: number; new: number; topScore: number }[]): Promise<void> {
  const totalNew = results.reduce((sum, r) => sum + r.new, 0);
  if (totalNew === 0) return; // Don't spam if nothing new

  const summary = results
    .filter(r => r.new > 0)
    .map(r => `${r.source}: +${r.new} (топ ${r.topScore})`)
    .join('\n');

  try {
    await bot.api.sendMessage(
      CONFIG.adminUserId,
      `Найдено новых: ${totalNew}\n${summary}`,
    );
  } catch (err) {
    logger.error('bot', 'Failed to send scrape notification', { error: String(err) });
  }
}

// --- Helpers ---

async function sendLongMessage(ctx: Context, text: string): Promise<void> {
  const chunks = splitMessage(text, 4000);
  for (const chunk of chunks) {
    await ctx.reply(chunk, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  }
}

async function sendLongMessageDirect(bot: Bot, chatId: number, text: string): Promise<void> {
  const chunks = splitMessage(text, 4000);
  for (const chunk of chunks) {
    await bot.api.sendMessage(chatId, chunk, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  const lines = text.split('\n');
  let current = '';

  for (const line of lines) {
    if (current.length + line.length + 1 > maxLen) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
