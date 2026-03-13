import { Bot, Context, Keyboard, InlineKeyboard } from 'grammy';
import { CONFIG } from './config';
import { logger } from './logger';
import { getOrCreateUser, getUserVacancies, getVacancyById, updateUserVacancyStatus, updateUser, getUserStats } from './db';
import { handleOnboarding, handleFormatCallback, handleDomainCallback, handleOnboardingNavCallback, askQuestion, showEditMenu, editingSessions, handleEditFieldCallback } from './onboarding';
import { runAllScrapers } from './scrapers/runner';
import { getCoverLetter, generateCoverLetter } from './cover-letter';
import {
  formatVacancyDetail, formatVacancyWithLetter,
  formatVacancyLoading, escapeHtml, DIGEST_PAGE_SIZE,
} from './digest';
import type { UserProfile, ScoredVacancy } from './types';

export const mainKeyboard = new Keyboard()
  .text('🔍 Поиск').text('📋 Дайджест').row()
  .text('👤 Профиль').text('📊 Статистика').row()
  .text('🧹 Очистить')
  .resized()
  .persistent();

function openButton(id: number): InlineKeyboard {
  return new InlineKeyboard().text('\u041E\u0442\u043A\u0440\u044B\u0442\u044C', `view:${id}`);
}

function vacancyButtons(id: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('📝 Письмо', `cover:${id}`)
    .text('❌ Скрыть', `reject:${id}`)
    .row()
    .text('✅ Откликнулся', `applied:${id}`);
}

function coverLetterButtons(id: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('◀️ Назад', `view:${id}`)
    .text('🔄 Другой вариант', `restyle:${id}`)
    .row()
    .text('✅ Откликнулся', `applied:${id}`);
}

async function requireOnboarded(ctx: Context, next: () => Promise<void>): Promise<void> {
  if (!ctx.from) return;

  // Cancel editing session when using main keyboard buttons
  if (editingSessions.has(ctx.from.id)) {
    editingSessions.delete(ctx.from.id);
  }

  // Recovery: if profile has essential data but state is stuck (from old editing bug), fix it
  const user = getOrCreateUser(ctx.from.id);
  if (user.onboardingState !== 'complete' && user.onboardingState !== 'new' && user.name && user.title) {
    updateUser(ctx.from.id, { onboardingState: 'complete' });
    return next();
  }

  const handled = await handleOnboarding(ctx);
  if (handled) return;
  return next();
}

// --- Handler functions (shared between buttons and commands) ---

async function handleDigest(ctx: Context): Promise<void> {
  const user = getOrCreateUser(ctx.from!.id);
  const { vacancies, total } = getUserVacancies(user.id, 0, DIGEST_PAGE_SIZE);

  if (vacancies.length === 0) {
    await ctx.reply(
      '\u041D\u0435\u0442 \u0440\u0435\u043B\u0435\u0432\u0430\u043D\u0442\u043D\u044B\u0445 \u0432\u0430\u043A\u0430\u043D\u0441\u0438\u0439. \u041D\u0430\u0436\u043C\u0438 \u041F\u043E\u0438\u0441\u043A, \u0447\u0442\u043E\u0431\u044B \u0441\u043E\u0431\u0440\u0430\u0442\u044C \u043D\u043E\u0432\u044B\u0435.',
      { reply_markup: mainKeyboard },
    );
    return;
  }

  await ctx.reply(
    `<b>\u0414\u0430\u0439\u0434\u0436\u0435\u0441\u0442</b> \u2014 ${total} \u0432\u0430\u043A\u0430\u043D\u0441\u0438\u0439 \u043F\u043E\u0434 \u0442\u0435\u0431\u044F`,
    { parse_mode: 'HTML', reply_markup: mainKeyboard },
  );

  await sendVacancyCards(ctx, vacancies);

  if (total > vacancies.length) {
    await ctx.reply(
      `\u041F\u043E\u043A\u0430\u0437\u0430\u043D\u043E ${vacancies.length} \u0438\u0437 ${total}`,
      { reply_markup: new InlineKeyboard().text('\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0435\u0449\u0451', `more:${vacancies.length}`) },
    );
  }
}

async function handleScrape(ctx: Context): Promise<void> {
  await ctx.reply('\u0417\u0430\u043F\u0443\u0441\u043A\u0430\u044E \u043F\u043E\u0438\u0441\u043A...', { reply_markup: mainKeyboard });

  try {
    const results = await runAllScrapers();
    const summary = results
      .map(r => `${r.source}: \u043D\u0430\u0439\u0434\u0435\u043D\u043E ${r.found}, \u043D\u043E\u0432\u044B\u0445 ${r.new}`)
      .join('\n');

    await ctx.reply(
      `<b>Поиск завершён</b>\n\n${summary}`,
      { parse_mode: 'HTML', reply_markup: mainKeyboard },
    );

    // Auto-show digest after scrape
    await handleDigest(ctx);
  } catch (err) {
    logger.error('bot', 'Scrape failed', { error: String(err) });
    await ctx.reply(`\u041E\u0448\u0438\u0431\u043A\u0430: ${String(err)}`, { reply_markup: mainKeyboard });
  }
}

async function handleProfile(ctx: Context): Promise<void> {
  const user = getOrCreateUser(ctx.from!.id);
  const skills = user.skills.length > 0 ? user.skills.join(', ') : 'не указаны';
  const salary = formatSalaryProfile(user);
  const domains = user.domains.length > 0 ? user.domains.map(d => d.name).join(', ') : 'любые';
  const redFlags = user.redFlags.length > 0 ? user.redFlags.join(', ') : 'нет';
  const blacklist = user.companyBlacklist.length > 0 ? user.companyBlacklist.join(', ') : 'нет';
  const queries = user.searchQueries.length > 0 ? user.searchQueries.join(', ') : 'из должности';
  const formatLabel: Record<string, string> = {
    remote: '🏠 Удалённо', hybrid: '🔀 Гибрид', office: '🏢 Офис', any: '🤷 Любой',
  };

  const text = [
    `👤 <b>${escapeHtml(user.name ?? '—')}</b>`,
    `${escapeHtml(user.title ?? '—')} · ${user.yearsExperience ?? 0} лет опыта`,
    '',
    `🛠 <b>Навыки</b>`,
    escapeHtml(skills),
    '',
    `💰 <b>Зарплата:</b> ${salary}`,
    `${formatLabel[user.preferredFormat] ?? user.preferredFormat}`,
    '',
    `🏢 <b>Отрасли:</b> ${escapeHtml(domains)}`,
    '',
    `🔍 <b>Запросы:</b> ${escapeHtml(queries)}`,
    '',
    `🚩 <b>Red flags:</b> ${escapeHtml(redFlags)}`,
    `🚫 <b>Блеклист:</b> ${escapeHtml(blacklist)}`,
    '',
    user.portfolio ? `🔗 <b>Портфолио:</b> ${escapeHtml(user.portfolio)}` : '',
  ].filter(Boolean).join('\n');

  const editButton = new InlineKeyboard()
    .text('✏️ Редактировать', 'edit_profile');

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: editButton });
}

async function handleStats(ctx: Context): Promise<void> {
  const user = getOrCreateUser(ctx.from!.id);
  const s = getUserStats(user.id);

  const sourceLinks: Record<string, string> = {
    'hh.ru': 'https://hh.ru',
    'habr': 'https://career.habr.com',
  };

  const sourceLines = Object.entries(s.sources)
    .map(([source, count]) => {
      const url = sourceLinks[source];
      return url ? `  <a href="${url}">${source}</a>: ${count}` : `  ${source}: ${count}`;
    })
    .join('\n');

  const text = [
    '<b>📊 Статистика</b>',
    '',
    `📋 Всего вакансий: ${s.total}`,
    `🎯 Релевантных (40+): ${s.relevant}`,
    `✅ Откликнулся: ${s.applied}`,
    `❌ Скрыто: ${s.rejected}`,
    `✉️ Писем сгенерировано: ${s.coverLetters}`,
    `⚡ Средний скор: ${s.avgScore}/100`,
    '',
    '<b>🌐 По источникам:</b>',
    sourceLines || '  нет данных',
    '',
    '<b>🧠 Как работает скор</b>',
    '',
    'Каждая вакансия оценивается от 0 до 100:',
    '',
    '🛠 <b>Навыки (40%)</b> — взвешенное совпадение навыков. Первые навыки в списке важнее.',
    '💰 <b>Зарплата (25%)</b> — попадание вилки в твой диапазон.',
    '🏠 <b>Формат (20%)</b> — удалёнка, гибрид, офис.',
    '🏢 <b>Отрасль (15%)</b> — совпадение с выбранными доменами.',
    '',
    '⚠️ <b>Штрафы:</b> red flags = скор /2, блеклист = скор 0.',
    '',
    'В дайджест попадают вакансии со скором 40+.',
  ].join('\n');

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: mainKeyboard });
}

async function handleClear(ctx: Context): Promise<void> {
  const chatId = ctx.chat!.id;
  const currentMsgId = ctx.message!.message_id;
  let deleted = 0;

  for (let id = currentMsgId; id > currentMsgId - 500 && id > 0; id--) {
    try {
      await ctx.api.deleteMessage(chatId, id);
      deleted++;
    } catch {
      // Message doesn't exist or too old — skip
    }
  }

  await ctx.reply(`🧹 Удалено ${deleted} сообщений`, { reply_markup: mainKeyboard });
}

// --- Bot setup ---

export function createBot(): Bot {
  const bot = new Bot(CONFIG.telegramBotToken);

  // --- /start ---

  bot.command('start', async (ctx) => {
    if (!ctx.from) return;

    // Cancel any editing session
    editingSessions.delete(ctx.from.id);

    const user = getOrCreateUser(ctx.from.id);

    // Recovery: if profile has essential data but state is stuck, fix it
    if (user.onboardingState !== 'complete' && user.onboardingState !== 'new' && user.name && user.title) {
      updateUser(ctx.from.id, { onboardingState: 'complete' });
      await ctx.reply(
        `С возвращением, ${escapeHtml(user.name)}!\nИспользуй кнопки внизу.`,
        { parse_mode: 'HTML', reply_markup: mainKeyboard },
      );
      return;
    }

    if (user.onboardingState === 'complete') {
      await ctx.reply(
        `С возвращением, ${escapeHtml(user.name ?? '👋')}!\nИспользуй кнопки внизу.`,
        { parse_mode: 'HTML', reply_markup: mainKeyboard },
      );
      return;
    }

    await handleOnboarding(ctx);
  });

  // --- Format callback (onboarding) ---

  bot.callbackQuery(/^format:(.+)$/, async (ctx) => {
    await handleFormatCallback(ctx, ctx.match[1]);
  });

  // --- Domain multi-select callback (onboarding) ---

  bot.callbackQuery(/^domain:(.+)$/, async (ctx) => {
    await handleDomainCallback(ctx, ctx.match[1]);
  });

  // --- Onboarding navigation (back, skip, ok) ---

  bot.callbackQuery(/^onb:(.+)$/, async (ctx) => {
    await handleOnboardingNavCallback(ctx, ctx.match[1]);
  });

  // --- Edit profile callback ---

  bot.callbackQuery('edit_profile', async (ctx) => {
    if (!ctx.from) return;
    await ctx.answerCallbackQuery();
    await showEditMenu(ctx);
  });

  // --- Field-by-field edit callbacks ---

  bot.callbackQuery(/^edit:(.+)$/, async (ctx) => {
    if (!ctx.from) return;
    const field = ctx.match[1];
    if (field === 'cancel') {
      editingSessions.delete(ctx.from.id);
      await ctx.answerCallbackQuery();
      try { await ctx.deleteMessage(); } catch { /* ok */ }
      return;
    }
    await handleEditFieldCallback(ctx, field);
  });

  // --- Slash commands ---

  bot.command('digest', requireOnboarded, handleDigest);
  bot.command('scrape', requireOnboarded, handleScrape);
  bot.command('search', requireOnboarded, handleScrape);
  bot.command('profile', requireOnboarded, handleProfile);
  bot.command('stats', requireOnboarded, handleStats);

  // --- Button handlers ---

  bot.hears(/\u0414\u0430\u0439\u0434\u0436\u0435\u0441\u0442/, requireOnboarded, handleDigest);
  bot.hears(/\u041F\u043E\u0438\u0441\u043A/, requireOnboarded, handleScrape);
  bot.hears(/\u041F\u0440\u043E\u0444\u0438\u043B\u044C/, requireOnboarded, handleProfile);
  bot.hears(/\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430/, requireOnboarded, handleStats);
  bot.hears(/\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C/, requireOnboarded, handleClear);
  bot.command('clear', requireOnboarded, handleClear);

  // --- Inline keyboard callbacks ---

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (data.startsWith('format:') || data.startsWith('domain:') || data.startsWith('onb:') || data.startsWith('edit:') || data === 'edit_profile') return;

    const [action, idStr] = data.split(':');
    const id = parseInt(idStr, 10);

    if (isNaN(id)) {
      await ctx.answerCallbackQuery({ text: '\u041E\u0448\u0438\u0431\u043A\u0430' });
      return;
    }

    if (!ctx.from) return;
    const user = getOrCreateUser(ctx.from.id);

    if (user.onboardingState !== 'complete') {
      await ctx.answerCallbackQuery({ text: '\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0438 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0443 \u043F\u0440\u043E\u0444\u0438\u043B\u044F' });
      return;
    }

    // Pagination
    if (action === 'more') {
      await ctx.answerCallbackQuery();
      try { await ctx.deleteMessage(); } catch { /* ok */ }

      const { vacancies, total } = getUserVacancies(user.id, id, DIGEST_PAGE_SIZE);
      if (vacancies.length === 0) {
        await ctx.reply('\u0411\u043E\u043B\u044C\u0448\u0435 \u043D\u0435\u0442 \u0440\u0435\u043B\u0435\u0432\u0430\u043D\u0442\u043D\u044B\u0445 \u0432\u0430\u043A\u0430\u043D\u0441\u0438\u0439.', { reply_markup: mainKeyboard });
        return;
      }

      const pageNum = Math.floor(id / DIGEST_PAGE_SIZE) + 1;
      await ctx.reply(`\u2014 \u2014 \u2014 \u0421\u0442\u0440\u0430\u043D\u0438\u0446\u0430 ${pageNum} \u2014 \u2014 \u2014`);

      await sendVacancyCards(ctx, vacancies);

      const shown = id + vacancies.length;
      if (shown < total) {
        await ctx.reply(
          `\u041F\u043E\u043A\u0430\u0437\u0430\u043D\u043E ${shown} \u0438\u0437 ${total}`,
          { reply_markup: new InlineKeyboard().text('\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0435\u0449\u0451', `more:${shown}`) },
        );
      }
      return;
    }

    const vacancy = getVacancyById(id, user.id);
    if (!vacancy) {
      await ctx.answerCallbackQuery({ text: '\u0412\u0430\u043A\u0430\u043D\u0441\u0438\u044F \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430' });
      return;
    }

    switch (action) {
      case 'view': {
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(formatVacancyDetail(vacancy), {
          parse_mode: 'HTML',
          reply_markup: vacancyButtons(id),
          link_preview_options: { is_disabled: true },
        });
        break;
      }

      case 'reject': {
        updateUserVacancyStatus(user.id, id, 'rejected');
        await ctx.answerCallbackQuery({ text: '\u0421\u043A\u0440\u044B\u0442\u043E' });
        try { await ctx.deleteMessage(); } catch { /* ok */ }
        break;
      }

      case 'applied': {
        updateUserVacancyStatus(user.id, id, 'applied');
        await ctx.answerCallbackQuery({ text: '\u041E\u0442\u043A\u043B\u0438\u043A\u043D\u0443\u043B\u0441\u044F' });
        try { await ctx.deleteMessage(); } catch { /* ok */ }
        await ctx.reply(
          `\u041E\u0442\u043A\u043B\u0438\u043A\u043D\u0443\u043B\u0441\u044F: <b>${escapeHtml(vacancy.title)}</b> \u2014 ${escapeHtml(vacancy.company)}`,
          { parse_mode: 'HTML', reply_markup: mainKeyboard },
        );
        break;
      }

      case 'cover': {
        await ctx.answerCallbackQuery();

        try {
          await ctx.editMessageText(formatVacancyLoading(vacancy), {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
          });
        } catch { /* ok */ }

        try {
          const letter = getCoverLetter(user.id, id) ?? await generateCoverLetter(user, vacancy);
          await ctx.editMessageText(formatVacancyWithLetter(vacancy, letter), {
            parse_mode: 'HTML',
            reply_markup: coverLetterButtons(id),
            link_preview_options: { is_disabled: true },
          });
        } catch (err) {
          logger.error('bot', 'Cover letter failed', { error: String(err) });
          try {
            await ctx.editMessageText(formatVacancyDetail(vacancy), {
              parse_mode: 'HTML',
              reply_markup: vacancyButtons(id),
              link_preview_options: { is_disabled: true },
            });
          } catch { /* ok */ }
          await ctx.reply(`\u041E\u0448\u0438\u0431\u043A\u0430 \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u0438: ${String(err)}`);
        }
        break;
      }

      case 'restyle': {
        await ctx.answerCallbackQuery();

        try {
          await ctx.editMessageText(formatVacancyLoading(vacancy, '\u0413\u0435\u043D\u0435\u0440\u0438\u0440\u0443\u044E \u0434\u0440\u0443\u0433\u043E\u0439 \u0432\u0430\u0440\u0438\u0430\u043D\u0442...'), {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
          });
        } catch { /* ok */ }

        try {
          const letter = await generateCoverLetter(user, vacancy, true);
          await ctx.editMessageText(formatVacancyWithLetter(vacancy, letter), {
            parse_mode: 'HTML',
            reply_markup: coverLetterButtons(id),
            link_preview_options: { is_disabled: true },
          });
        } catch (err) {
          logger.error('bot', 'Restyle failed', { error: String(err) });
          await ctx.reply(`\u041E\u0448\u0438\u0431\u043A\u0430 \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u0438: ${String(err)}`);
        }
        break;
      }

      default:
        await ctx.answerCallbackQuery({ text: '\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435' });
    }
  });

  // --- Catch-all ---

  bot.on('message:text', async (ctx) => {
    if (!ctx.from) return;
    const handled = await handleOnboarding(ctx);
    if (handled) return;
    await ctx.reply('\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439 \u043A\u043D\u043E\u043F\u043A\u0438 \u0432\u043D\u0438\u0437\u0443.', { reply_markup: mainKeyboard });
  });

  bot.catch((err) => {
    logger.error('bot', 'Unhandled error', { error: String(err.error) });
  });

  return bot;
}

async function sendVacancyCards(ctx: Context, vacancies: ScoredVacancy[]): Promise<void> {
  for (const v of vacancies) {
    await ctx.reply(formatVacancyDetail(v), {
      parse_mode: 'HTML',
      reply_markup: vacancyButtons(v.id),
      link_preview_options: { is_disabled: true },
    });
  }
}

function formatSalaryProfile(user: UserProfile): string {
  if (!user.salaryMin && !user.salaryMax) return '\u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D\u0430';
  const cur = user.salaryCurrency === 'RUB' ? '\u20BD' : user.salaryCurrency;
  if (user.salaryMin && user.salaryMax) return `${user.salaryMin}\u2013${user.salaryMax} ${cur}`;
  if (user.salaryMin) return `\u043E\u0442 ${user.salaryMin} ${cur}`;
  return `\u0434\u043E ${user.salaryMax} ${cur}`;
}
