import { Bot, Context, Keyboard, InlineKeyboard } from 'grammy';
import { CONFIG } from './config';
import { logger } from './logger';
import { getOrCreateUser, getUserVacancies, getVacancyById, updateUserVacancyStatus, updateUser, getUserStats, markVacanciesNotified, isProUser, incrementLettersUsed, useCredits } from './db';
import { handleOnboarding, handleFormatCallback, handleDomainCallback, handleOnboardingNavCallback, askQuestion, showEditMenu, editingSessions, handleEditFieldCallback } from './onboarding';
import { getCoverLetter, generateCoverLetter } from './cover-letter';
import {
  formatVacancyDetail, formatVacancyWithLetter,
  formatVacancyLoading, escapeHtml, DIGEST_PAGE_SIZE,
  vacancyButtons, coverLetterButtons,
} from './digest';
import type { UserProfile, ScoredVacancy } from './types';

export const mainKeyboard = new Keyboard()
  .text('📋 Дайджест').text('👤 Профиль').row()
  .text('📊 Статистика').text('🧹 Очистить')
  .resized()
  .persistent();

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
  const pro = isProUser(user);
  const maxDigest = pro ? Infinity : CONFIG.freemium.free.digestPageSize;
  const { vacancies, total } = getUserVacancies(user.id, 0, DIGEST_PAGE_SIZE);

  if (vacancies.length === 0) {
    await ctx.reply(
      'Нет релевантных вакансий. Новые появятся после автоматического поиска.',
      { reply_markup: mainKeyboard },
    );
    return;
  }

  const shownCount = Math.min(vacancies.length, maxDigest);
  const displayVacancies = vacancies.slice(0, shownCount);
  const subtitle = total > shownCount ? `\nВот ${shownCount} лучших:` : '';

  await ctx.reply(
    `<b>Дайджест</b> — ${total} вакансий под тебя${subtitle}`,
    { parse_mode: 'HTML', reply_markup: mainKeyboard },
  );

  await sendVacancyCards(ctx, displayVacancies);
  markVacanciesNotified(user.id, displayVacancies.map(v => v.id));

  // Free plan: show paywall after limited digest
  if (!pro && total > maxDigest) {
    await ctx.reply(
      paywallText('digest', user),
      { parse_mode: 'HTML' },
    );
    return;
  }

  if (total > displayVacancies.length) {
    await ctx.reply(
      `Показано ${displayVacancies.length} из ${total}`,
      { reply_markup: new InlineKeyboard().text('Показать ещё', `more:${displayVacancies.length}`) },
    );
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
  const pro = isProUser(user);

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

  const remainingLetters = Math.max(0, CONFIG.freemium.free.coverLetters - user.lettersUsed);
  const planLine = pro
    ? `План: <b>Pro</b>${user.planExpiresAt ? ` (до ${user.planExpiresAt.toLocaleDateString('ru-RU')})` : ''}`
    : `План: <b>Free</b> — писем осталось: ${remainingLetters}/${CONFIG.freemium.free.coverLetters}`;

  const text = [
    '<b>📊 Статистика</b>',
    '',
    planLine,
    user.credits > 0 ? `Кредитов: ${user.credits}` : '',
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
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    '<b>🧠 Как работает скор</b>',
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
  ].filter(Boolean).join('\n');

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

async function handleSubscribe(ctx: Context): Promise<void> {
  const user = getOrCreateUser(ctx.from!.id);
  const pro = isProUser(user);

  if (pro) {
    const expires = user.planExpiresAt
      ? user.planExpiresAt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'бессрочно';
    await ctx.reply(
      `<b>У тебя Pro!</b>\n\nДействует до: ${expires}\nКредитов: ${user.credits}`,
      { parse_mode: 'HTML', reply_markup: mainKeyboard },
    );
    return;
  }

  const remaining = Math.max(0, CONFIG.freemium.free.coverLetters - user.lettersUsed);

  const text = [
    '<b>Тарифы Hunter</b>',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    '<b>Free</b> (текущий)',
    `  Писем: ${remaining} из ${CONFIG.freemium.free.coverLetters} осталось`,
    `  Дайджест: ${CONFIG.freemium.free.digestPageSize} вакансий`,
    '  Push: 2 вакансии/скрейп',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    '<b>Pro — 500 Stars/мес</b> (~350 руб)',
    '  Безлимит писем и дайджест',
    '  Push-алерты: 5 вакансий/скрейп',
    '  Утренний дайджест',
    '',
    '<b>Pro Год — 4800 Stars/год</b> (~3360 руб, -20%)',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    '<b>Кредиты</b> (разовая покупка)',
    '  50 Stars = 10 кредитов (2 письма)',
    '  200 Stars = 50 кредитов (10 писем)',
    `  Твои кредиты: ${user.credits}`,
    '',
    '<i>Оплата через Telegram Stars скоро!</i>',
  ].join('\n');

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: mainKeyboard });
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

  // --- /subscribe ---

  bot.command('subscribe', requireOnboarded, handleSubscribe);

  // --- Slash commands ---

  bot.command('digest', requireOnboarded, handleDigest);
  bot.command('profile', requireOnboarded, handleProfile);
  bot.command('stats', requireOnboarded, handleStats);

  // --- Button handlers ---

  bot.hears(/\u0414\u0430\u0439\u0434\u0436\u0435\u0441\u0442/, requireOnboarded, handleDigest);
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

      // Free plan: block pagination beyond limit
      const pro = isProUser(user);
      if (!pro) {
        const maxDigest = CONFIG.freemium.free.digestPageSize;
        if (id >= maxDigest) {
          await ctx.reply(paywallText('digest', user), { parse_mode: 'HTML' });
          return;
        }
      }

      const { vacancies, total } = getUserVacancies(user.id, id, DIGEST_PAGE_SIZE);
      if (vacancies.length === 0) {
        await ctx.reply('Больше нет релевантных вакансий.', { reply_markup: mainKeyboard });
        return;
      }

      const pageNum = Math.floor(id / DIGEST_PAGE_SIZE) + 1;
      await ctx.reply(`\n<code>  Страница ${pageNum}  </code>`, { parse_mode: 'HTML' });

      await sendVacancyCards(ctx, vacancies);
      markVacanciesNotified(user.id, vacancies.map(v => v.id));

      const shown = id + vacancies.length;
      if (shown < total) {
        await ctx.reply(
          `Показано ${shown} из ${total}`,
          { reply_markup: new InlineKeyboard().text('Показать ещё', `more:${shown}`) },
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

        // Check if cached — no limit needed
        const cached = getCoverLetter(user.id, id);
        if (!cached) {
          // Freemium gate: check cover letter limit
          const canGenerate = checkCoverLetterLimit(user);
          if (!canGenerate) {
            await ctx.reply(paywallText('letters', user), { parse_mode: 'HTML' });
            return;
          }
        }

        try {
          await ctx.editMessageText(formatVacancyLoading(vacancy), {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
          });
        } catch { /* ok */ }

        try {
          const letter = cached ?? await generateCoverLetter(user, vacancy);
          if (!cached) {
            consumeCoverLetterQuota(user);
          }
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

        // Freemium gate: restyle always counts as a new generation
        const canRestyle = checkCoverLetterLimit(user);
        if (!canRestyle) {
          await ctx.reply(paywallText('letters', user), { parse_mode: 'HTML' });
          return;
        }

        try {
          await ctx.editMessageText(formatVacancyLoading(vacancy, '\u0413\u0435\u043D\u0435\u0440\u0438\u0440\u0443\u044E \u0434\u0440\u0443\u0433\u043E\u0439 \u0432\u0430\u0440\u0438\u0430\u043D\u0442...'), {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
          });
        } catch { /* ok */ }

        try {
          const letter = await generateCoverLetter(user, vacancy, true);
          consumeCoverLetterQuota(user);
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

// --- Freemium helpers ---

function checkCoverLetterLimit(user: UserProfile): boolean {
  if (isProUser(user)) return true;
  // Credits can be used even on free plan
  if (user.credits >= CONFIG.freemium.creditsPerLetter) return true;
  return user.lettersUsed < CONFIG.freemium.free.coverLetters;
}

/** Deduct quota after successful generation */
function consumeCoverLetterQuota(user: UserProfile): void {
  if (isProUser(user)) return;
  // Try credits first, then free quota
  if (user.lettersUsed >= CONFIG.freemium.free.coverLetters) {
    useCredits(user.id, CONFIG.freemium.creditsPerLetter);
  } else {
    incrementLettersUsed(user.id);
  }
}

function paywallText(reason: 'letters' | 'digest', user: UserProfile): string {
  const remaining = Math.max(0, CONFIG.freemium.free.coverLetters - user.lettersUsed);

  if (reason === 'letters') {
    if (user.credits >= CONFIG.freemium.creditsPerLetter) {
      // Should not happen — checkCoverLetterLimit would pass — but just in case
      return '';
    }
    return [
      '<b>Лимит бесплатных писем исчерпан</b>',
      '',
      `Использовано: ${user.lettersUsed} из ${CONFIG.freemium.free.coverLetters}`,
      '',
      '<b>Pro</b> — безлимит писем, полный дайджест, push-алерты.',
      'Или купи кредиты для разовых генераций.',
      '',
      '/subscribe — посмотреть тарифы',
    ].join('\n');
  }

  // digest
  return [
    `<b>Показано ${CONFIG.freemium.free.digestPageSize} лучших вакансий</b>`,
    '',
    'Полный дайджест без ограничений — в <b>Pro</b>.',
    '',
    '/subscribe — посмотреть тарифы',
  ].join('\n');
}

function formatSalaryProfile(user: UserProfile): string {
  if (!user.salaryMin && !user.salaryMax) return '\u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D\u0430';
  const cur = user.salaryCurrency === 'RUB' ? '\u20BD' : user.salaryCurrency;
  if (user.salaryMin && user.salaryMax) return `${user.salaryMin}\u2013${user.salaryMax} ${cur}`;
  if (user.salaryMin) return `\u043E\u0442 ${user.salaryMin} ${cur}`;
  return `\u0434\u043E ${user.salaryMax} ${cur}`;
}
