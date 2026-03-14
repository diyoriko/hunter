import { Bot, Context, Keyboard, InlineKeyboard } from 'grammy';
import { CONFIG } from './config';
import { logger } from './logger';
import { getOrCreateUser, getUserVacancies, getVacancyById, updateUserVacancyStatus, updateUser, getUserStats, markVacanciesNotified, isProUser, incrementLettersUsed, useCredits, activatePro, addCredits, savePayment, getGlobalStats, getScoreDistribution, saveProposal, approveProposal, rejectProposal } from './db';
import { handleOnboarding, handleFormatCallback, handleDomainCallback, handleOnboardingNavCallback, askQuestion, showEditMenu, editingSessions, handleEditFieldCallback } from './onboarding';
import { getCoverLetter, generateCoverLetter } from './cover-letter';
import {
  formatVacancyDetail, formatVacancyWithLetter,
  formatVacancyLoading, escapeHtml, DIGEST_PAGE_SIZE,
  vacancyButtons, coverLetterButtons,
} from './digest';
import type { UserProfile, ScoredVacancy } from './types';

export const mainKeyboard = new Keyboard()
  .text('\u{1F4CB} \u0414\u0430\u0439\u0434\u0436\u0435\u0441\u0442').text('\u{1F464} \u041F\u0440\u043E\u0444\u0438\u043B\u044C').row()
  .text('\u{1F4CA} \u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430').text('\u{1F9F9} \u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0447\u0430\u0442')
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
      [
        'Нет релевантных вакансий.',
        '',
        'Попробуй расширить профиль:',
        '— добавь больше навыков',
        '— расширь зарплатную вилку',
        '— смени формат на «любой»',
        '',
        'Новые вакансии появятся после автоматического поиска.',
      ].join('\n'),
      { reply_markup: new InlineKeyboard().text('✏️ Редактировать профиль', 'edit_profile') },
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
      `Показано 1\u2013${displayVacancies.length} из ${total}`,
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
    user.redFlags.length > 0 ? '<i>  (скор вакансий с этими словами /2)</i>' : '',
    `🚫 <b>Блеклист:</b> ${escapeHtml(blacklist)}`,
    user.companyBlacklist.length > 0 ? '<i>  (скор вакансий этих компаний = 0)</i>' : '',
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
    '<b>Статистика</b>',
    '',
    planLine,
    user.credits > 0 ? `Кредитов: ${user.credits}` : '',
    '',
    `<code>Вакансий:     ${s.total}`,
    `Релевантных:  ${s.relevant} (скор 40+)`,
    `Откликнулся:  ${s.applied}`,
    `Скрыто:       ${s.rejected}`,
    `Писем:        ${s.coverLetters}`,
    `Средний скор: ${s.avgScore}/100</code>`,
    '',
    '<b>По источникам:</b>',
    sourceLines || '  нет данных',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    '<b>Как работает скор</b>',
    '',
    '<code>Навыки:  40% — совпадение навыков (первые важнее)',
    'Зарплата: 25% — попадание вилки в диапазон',
    'Формат:  20% — удалёнка, гибрид, офис',
    'Отрасль: 15% — совпадение с доменами</code>',
    '',
    'Red flags = скор /2, блеклист = скор 0.',
    'В дайджест попадают вакансии со скором 40+.',
  ].filter(Boolean).join('\n');

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: mainKeyboard });
}

async function handleClear(ctx: Context): Promise<void> {
  const confirmButton = new InlineKeyboard()
    .text('\u2705 \u0414\u0430, \u043E\u0447\u0438\u0441\u0442\u0438\u0442\u044C', 'clear_confirm')
    .text('\u274C \u041E\u0442\u043C\u0435\u043D\u0430', 'clear_cancel');

  await ctx.reply(
    '\u{1F9F9} \u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0447\u0430\u0442?\n\u0411\u0443\u0434\u0443\u0442 \u0443\u0434\u0430\u043B\u0435\u043D\u044B \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u0432 \u0447\u0430\u0442\u0435.',
    { reply_markup: confirmButton },
  );
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
  const { stars } = CONFIG;

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
    `<b>Pro — ${stars.proMonthly} Stars/мес</b>`,
    '  Безлимит писем и дайджест',
    '  Push-алерты: 5 вакансий/скрейп',
    '  Утренний дайджест',
    '',
    `<b>Pro Год — ${stars.proYearly} Stars/год</b> (-20%)`,
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    '<b>Кредиты</b> (разовая покупка)',
    `  ${stars.creditsSmall.stars} Stars = ${stars.creditsSmall.letters} письма`,
    `  ${stars.creditsLarge.stars} Stars = ${stars.creditsLarge.letters} писем`,
    user.credits > 0 ? `  Твои кредиты: ${user.credits}` : '',
  ].filter(Boolean).join('\n');

  const buttons = new InlineKeyboard()
    .text(`Pro мес — ${stars.proMonthly} Stars`, 'buy:pro_monthly').row()
    .text(`Pro год — ${stars.proYearly} Stars (-20%)`, 'buy:pro_yearly').row()
    .text(`${stars.creditsSmall.letters} письма — ${stars.creditsSmall.stars} Stars`, 'buy:credits_small')
    .text(`${stars.creditsLarge.letters} писем — ${stars.creditsLarge.stars} Stars`, 'buy:credits_large');

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: buttons });
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
      const quickButtons = new InlineKeyboard()
        .text('\u{1F4CB} \u0414\u0430\u0439\u0434\u0436\u0435\u0441\u0442', 'quick:digest')
        .text('\u{1F464} \u041F\u0440\u043E\u0444\u0438\u043B\u044C', 'quick:profile')
        .row()
        .text('\u{1F4CA} \u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430', 'quick:stats')
        .text('\u2B50 \u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430', 'quick:subscribe');
      await ctx.reply(
        `\u0421 \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0435\u043D\u0438\u0435\u043C, ${escapeHtml(user.name ?? '\u{1F44B}')}!`,
        { parse_mode: 'HTML', reply_markup: quickButtons },
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
      try { await ctx.deleteMessage(); } catch (err) { logger.warn('bot', 'Failed to delete edit menu', { error: String(err) }); }
      return;
    }
    await handleEditFieldCallback(ctx, field);
  });

  // --- /subscribe ---

  bot.command('subscribe', requireOnboarded, handleSubscribe);

  // --- Buy callbacks (Telegram Stars invoices) ---

  bot.callbackQuery(/^buy:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

    const product = ctx.match[1];
    const { stars } = CONFIG;

    type ProductInfo = { title: string; description: string; amount: number; payload: string };
    const products: Record<string, ProductInfo> = {
      pro_monthly: {
        title: 'Hunter Pro — 1 месяц',
        description: 'Безлимит писем, полный дайджест, 5 push-алертов/скрейп',
        amount: stars.proMonthly,
        payload: 'pro_monthly',
      },
      pro_yearly: {
        title: 'Hunter Pro — 1 год (-20%)',
        description: 'Безлимит писем, полный дайджест, 5 push-алертов/скрейп. Скидка 20%',
        amount: stars.proYearly,
        payload: 'pro_yearly',
      },
      credits_small: {
        title: `${stars.creditsSmall.letters} сопроводительных письма`,
        description: `Пакет на ${stars.creditsSmall.letters} генерации cover letter`,
        amount: stars.creditsSmall.stars,
        payload: 'credits_small',
      },
      credits_large: {
        title: `${stars.creditsLarge.letters} сопроводительных писем`,
        description: `Пакет на ${stars.creditsLarge.letters} генераций cover letter`,
        amount: stars.creditsLarge.stars,
        payload: 'credits_large',
      },
    };

    const info = products[product];
    if (!info) return;

    try {
      await ctx.replyWithInvoice(
        info.title,
        info.description,
        info.payload,
        'XTR',
        [{ label: info.title, amount: info.amount }],
        { provider_token: '' },
      );
    } catch (err) {
      logger.error('bot', 'Failed to send invoice', { error: String(err), product });
      await ctx.reply('Ошибка при создании платежа. Попробуй позже.');
    }
  });

  // --- Pre-checkout query (must respond within 10 seconds) ---

  bot.on('pre_checkout_query', async (ctx) => {
    try {
      await ctx.answerPreCheckoutQuery(true);
    } catch (err) {
      logger.error('bot', 'Pre-checkout query failed', { error: String(err) });
    }
  });

  // --- Successful payment handler ---

  bot.on('message:successful_payment', async (ctx) => {
    if (!ctx.from) return;
    const payment = ctx.message!.successful_payment!;
    const user = getOrCreateUser(ctx.from.id);
    const payload = payment.invoice_payload;
    const chargeId = payment.telegram_payment_charge_id;

    try {
      savePayment(user.id, chargeId, payload, payment.total_amount, payload);

      if (payload === 'pro_monthly') {
        const expires = new Date();
        expires.setMonth(expires.getMonth() + 1);
        activatePro(user.id, expires);
        await ctx.reply(
          `<b>Pro активирован!</b>\n\nДействует до: ${expires.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`,
          { parse_mode: 'HTML', reply_markup: mainKeyboard },
        );
      } else if (payload === 'pro_yearly') {
        const expires = new Date();
        expires.setFullYear(expires.getFullYear() + 1);
        activatePro(user.id, expires);
        await ctx.reply(
          `<b>Pro на год активирован!</b>\n\nДействует до: ${expires.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`,
          { parse_mode: 'HTML', reply_markup: mainKeyboard },
        );
      } else if (payload === 'credits_small') {
        const credits = CONFIG.stars.creditsSmall.letters * CONFIG.freemium.creditsPerLetter;
        addCredits(user.id, credits);
        await ctx.reply(
          `<b>Кредиты добавлены!</b>\n\n+${credits} кредитов (${CONFIG.stars.creditsSmall.letters} письма)`,
          { parse_mode: 'HTML', reply_markup: mainKeyboard },
        );
      } else if (payload === 'credits_large') {
        const credits = CONFIG.stars.creditsLarge.letters * CONFIG.freemium.creditsPerLetter;
        addCredits(user.id, credits);
        await ctx.reply(
          `<b>Кредиты добавлены!</b>\n\n+${credits} кредитов (${CONFIG.stars.creditsLarge.letters} писем)`,
          { parse_mode: 'HTML', reply_markup: mainKeyboard },
        );
      }

      logger.info('payment', `Payment received: ${payload}`, {
        userId: user.id,
        telegramId: ctx.from.id,
        amount: payment.total_amount,
        chargeId,
      });
    } catch (err) {
      logger.error('payment', 'Payment processing failed', { error: String(err), chargeId, payload });
      await ctx.reply('Оплата получена, но произошла ошибка активации. Напиши в поддержку.');
    }
  });

  // --- Slash commands ---

  bot.command('digest', requireOnboarded, handleDigest);
  bot.command('profile', requireOnboarded, handleProfile);
  bot.command('stats', requireOnboarded, handleStats);

  // --- Admin stats ---

  bot.command('adminstats', async (ctx) => {
    if (!ctx.from || ctx.from.id !== CONFIG.adminTelegramId) {
      return;
    }

    const g = getGlobalStats();
    const sourceLines = Object.entries(g.vacanciesBySource)
      .map(([source, count]) => `  ${source}: ${count}`)
      .join('\n');

    const text = [
      '<b>Admin Stats</b>',
      '',
      `<code>MAU:          ${g.mau}`,
      `Total users:  ${g.totalUsers}`,
      `Pro users:    ${g.proUsers}`,
      `Vacancies:    ${g.totalVacancies}`,
      `Cover letters: ${g.totalCoverLetters}`,
      `Avg score:    ${g.avgScore}/100</code>`,
      '',
      '<b>By source:</b>',
      sourceLines || '  no data',
    ].join('\n');

    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  // --- Admin score distribution ---

  bot.command('adminscore', async (ctx) => {
    if (!ctx.from || ctx.from.id !== CONFIG.adminTelegramId) return;

    const dist = getScoreDistribution();
    if (dist.total === 0) {
      await ctx.reply('Нет данных по скорам.');
      return;
    }

    const barWidth = 20;
    const maxCount = Math.max(...dist.buckets.map(b => b.count));
    const bars = dist.buckets.map(b => {
      const filled = maxCount > 0 ? Math.round((b.count / maxCount) * barWidth) : 0;
      return `${b.range.padEnd(6)} ${'█'.repeat(filled)}${'░'.repeat(barWidth - filled)} ${b.count}`;
    }).join('\n');

    const text = [
      '<b>Score Distribution</b>',
      '',
      `<code>${bars}</code>`,
      '',
      `<code>Total:   ${dist.total}`,
      `Median:  ${dist.median}`,
      `P25:     ${dist.p25}`,
      `P75:     ${dist.p75}`,
      `≥40:     ${dist.above40} (${Math.round(dist.above40 / dist.total * 100)}%)`,
      `≥60:     ${dist.above60} (${Math.round(dist.above60 / dist.total * 100)}%)`,
      `≥80:     ${dist.above80} (${Math.round(dist.above80 / dist.total * 100)}%)</code>`,
      '',
      'Текущий порог дайджеста: 40',
    ].join('\n');

    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  // --- Button handlers ---

  bot.hears(/\u0414\u0430\u0439\u0434\u0436\u0435\u0441\u0442/, requireOnboarded, handleDigest);
  bot.hears(/\u041F\u0440\u043E\u0444\u0438\u043B\u044C/, requireOnboarded, handleProfile);
  bot.hears(/\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430/, requireOnboarded, handleStats);
  bot.hears(/\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C(\s\u0447\u0430\u0442)?/, requireOnboarded, handleClear);
  bot.command('clear', requireOnboarded, handleClear);

  // --- Quick action buttons (return user) ---

  bot.callbackQuery(/^quick:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const action = ctx.match[1];
    switch (action) {
      case 'digest': return handleDigest(ctx);
      case 'profile': return handleProfile(ctx);
      case 'stats': return handleStats(ctx);
      case 'subscribe': return handleSubscribe(ctx);
    }
  });

  // --- Clear chat confirmation ---

  bot.callbackQuery('clear_confirm', async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat!.id;
    const currentMsgId = ctx.callbackQuery.message?.message_id ?? 0;
    let deleted = 0;

    for (let id = currentMsgId; id > currentMsgId - 500 && id > 0; id--) {
      try {
        await ctx.api.deleteMessage(chatId, id);
        deleted++;
      } catch {
        // Message doesn't exist or too old — skip
      }
    }

    await ctx.reply(`\u{1F9F9} \u0423\u0434\u0430\u043B\u0435\u043D\u043E ${deleted} \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439`, { reply_markup: mainKeyboard });
  });

  bot.callbackQuery('clear_cancel', async (ctx) => {
    await ctx.answerCallbackQuery({ text: '\u041E\u0442\u043C\u0435\u043D\u0435\u043D\u043E' });
    try { await ctx.deleteMessage(); } catch (err) { logger.warn('bot', 'Telegram API call failed', { error: String(err) }); }
  });

  // --- Strategist proposal approval ---

  bot.callbackQuery(/^prop_approve:(\d+)$/, async (ctx) => {
    if (!ctx.from || ctx.from.id !== CONFIG.adminTelegramId) return;
    await ctx.answerCallbackQuery();
    const proposalId = parseInt(ctx.match[1], 10);
    const ok = approveProposal(proposalId);
    if (ok) {
      const msgText = ctx.callbackQuery.message?.text ?? '';
      try {
        await ctx.editMessageText(`\u2705 ${msgText}`, { reply_markup: undefined });
      } catch (err) { logger.warn('bot', 'Failed to edit proposal message', { error: String(err) }); }
    } else {
      await ctx.answerCallbackQuery({ text: '\u0423\u0436\u0435 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043E' });
    }
  });

  bot.callbackQuery(/^prop_reject:(\d+)$/, async (ctx) => {
    if (!ctx.from || ctx.from.id !== CONFIG.adminTelegramId) return;
    await ctx.answerCallbackQuery();
    const proposalId = parseInt(ctx.match[1], 10);
    const ok = rejectProposal(proposalId);
    if (ok) {
      const msgText = ctx.callbackQuery.message?.text ?? '';
      try {
        await ctx.editMessageText(`\u274C ${msgText}`, { reply_markup: undefined });
      } catch (err) { logger.warn('bot', 'Failed to edit proposal message', { error: String(err) }); }
    } else {
      await ctx.answerCallbackQuery({ text: '\u0423\u0436\u0435 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043E' });
    }
  });

  // --- Inline keyboard callbacks ---

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (data.startsWith('format:') || data.startsWith('domain:') || data.startsWith('onb:') || data.startsWith('edit:') || data.startsWith('buy:') || data.startsWith('quick:') || data.startsWith('prop_') || data === 'edit_profile' || data === 'clear_confirm' || data === 'clear_cancel') return;

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
      try { await ctx.deleteMessage(); } catch (err) { logger.warn('bot', 'Telegram API call failed', { error: String(err) }); }

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
          `Показано ${id + 1}\u2013${shown} из ${total}`,
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
        try { await ctx.deleteMessage(); } catch (err) { logger.warn('bot', 'Telegram API call failed', { error: String(err) }); }
        break;
      }

      case 'applied': {
        updateUserVacancyStatus(user.id, id, 'applied');
        await ctx.answerCallbackQuery({ text: '\u041E\u0442\u043A\u043B\u0438\u043A\u043D\u0443\u043B\u0441\u044F' });
        try {
          await ctx.editMessageText(
            formatVacancyDetail(vacancy, '\u2705 '),
            { parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
          );
        } catch {
          logger.warn('bot', 'Failed to edit applied message', { vacancyId: id });
        }
        break;
      }

      case 'cover': {
        await ctx.answerCallbackQuery();

        // Check if cached — no limit needed
        const cached = getCoverLetter(user.id, id);
        if (!cached) {
          // Rate limit: prevent spam-clicking
          const cooldown = checkCooldown(user.id);
          if (!cooldown.allowed) {
            await ctx.answerCallbackQuery({ text: `Подожди ${cooldown.remainingSec} сек` });
            return;
          }
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
        } catch (err) { logger.warn('bot', 'Telegram API call failed', { error: String(err) }); }

        try {
          // Show "taking longer" after 15s
          let slowTimer: ReturnType<typeof setTimeout> | null = null;
          if (!cached) {
            slowTimer = setTimeout(async () => {
              try {
                await ctx.editMessageText(
                  formatVacancyLoading(vacancy, '\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F \u0437\u0430\u043D\u0438\u043C\u0430\u0435\u0442 \u0434\u043E\u043B\u044C\u0448\u0435 \u043E\u0431\u044B\u0447\u043D\u043E\u0433\u043E...'),
                  { parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
                );
              } catch (err) { logger.warn('bot', 'Telegram API call failed', { error: String(err) }); }
            }, 15_000);
          }

          const letter = cached ?? await generateCoverLetter(user, vacancy);
          if (slowTimer) clearTimeout(slowTimer);

          if (!cached) {
            consumeCoverLetterQuota(user);
            setCooldown(user.id);
          }
          await ctx.editMessageText(formatVacancyWithLetter(vacancy, letter), {
            parse_mode: 'HTML',
            reply_markup: coverLetterButtons(id),
            link_preview_options: { is_disabled: true },
          });
        } catch (err) {
          logger.error('bot', 'Cover letter failed', { error: String(err) });
          const retryButtons = new InlineKeyboard()
            .text('\u{1F504} \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C', `cover:${id}`)
            .text('\u25C0\uFE0F \u041D\u0430\u0437\u0430\u0434', `view:${id}`);
          try {
            await ctx.editMessageText(
              formatVacancyDetail(vacancy, '\u26A0\uFE0F '),
              { parse_mode: 'HTML', reply_markup: retryButtons, link_preview_options: { is_disabled: true } },
            );
          } catch {
            logger.warn('bot', 'Failed to show cover letter error fallback');
          }
        }
        break;
      }

      case 'skills': {
        await ctx.answerCallbackQuery();
        const skillsList = vacancy.skills.length > 0 ? vacancy.skills.join(', ') : 'не указаны';
        const descSnippet = vacancy.description
          ? vacancy.description.replace(/<[^>]+>/g, '').slice(0, 1000)
          : '';
        const lines = [
          `\u{1F6E0}\uFE0F <b>Навыки вакансии</b>`,
          '',
          `<code>${escapeHtml(skillsList)}</code>`,
        ];
        if (descSnippet) {
          lines.push('', `<b>Описание:</b>`, escapeHtml(descSnippet));
          if (vacancy.description && vacancy.description.replace(/<[^>]+>/g, '').length > 1000) {
            lines.push('...');
          }
        }
        const backBtn = new InlineKeyboard().text('\u25C0\uFE0F Назад', `view:${id}`);
        try {
          await ctx.editMessageText(lines.join('\n'), {
            parse_mode: 'HTML',
            reply_markup: backBtn,
            link_preview_options: { is_disabled: true },
          });
        } catch (err) {
          logger.warn('bot', 'Failed to show skills', { error: String(err) });
        }
        break;
      }

      case 'restyle': {
        await ctx.answerCallbackQuery();

        // Rate limit: prevent spam-clicking
        const restyleCooldown = checkCooldown(user.id);
        if (!restyleCooldown.allowed) {
          await ctx.answerCallbackQuery({ text: `Подожди ${restyleCooldown.remainingSec} сек` });
          return;
        }

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
        } catch (err) { logger.warn('bot', 'Telegram API call failed', { error: String(err) }); }

        try {
          // Show "taking longer" after 15s
          const slowTimer = setTimeout(async () => {
            try {
              await ctx.editMessageText(
                formatVacancyLoading(vacancy, '\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F \u0437\u0430\u043D\u0438\u043C\u0430\u0435\u0442 \u0434\u043E\u043B\u044C\u0448\u0435 \u043E\u0431\u044B\u0447\u043D\u043E\u0433\u043E...'),
                { parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
              );
            } catch (err) { logger.warn('bot', 'Telegram API call failed', { error: String(err) }); }
          }, 15_000);

          const letter = await generateCoverLetter(user, vacancy, true);
          clearTimeout(slowTimer);
          consumeCoverLetterQuota(user);
          setCooldown(user.id);
          await ctx.editMessageText(formatVacancyWithLetter(vacancy, letter), {
            parse_mode: 'HTML',
            reply_markup: coverLetterButtons(id),
            link_preview_options: { is_disabled: true },
          });
        } catch (err) {
          logger.error('bot', 'Restyle failed', { error: String(err) });
          const retryButtons = new InlineKeyboard()
            .text('\u{1F504} \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C', `restyle:${id}`)
            .text('\u25C0\uFE0F \u041D\u0430\u0437\u0430\u0434', `view:${id}`);
          try {
            await ctx.editMessageText(
              formatVacancyDetail(vacancy, '\u26A0\uFE0F '),
              { parse_mode: 'HTML', reply_markup: retryButtons, link_preview_options: { is_disabled: true } },
            );
          } catch {
            logger.warn('bot', 'Failed to show restyle error fallback');
          }
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

// --- Rate limiting ---

/** Cooldown per user for cover letter generation (prevents spam-clicking) */
const coverLetterCooldowns = new Map<number, number>();
const COVER_LETTER_COOLDOWN_MS = 30_000; // 30 seconds between generations

function checkCooldown(userId: number): { allowed: boolean; remainingSec: number } {
  const lastTime = coverLetterCooldowns.get(userId);
  if (!lastTime) return { allowed: true, remainingSec: 0 };
  const elapsed = Date.now() - lastTime;
  if (elapsed >= COVER_LETTER_COOLDOWN_MS) return { allowed: true, remainingSec: 0 };
  return { allowed: false, remainingSec: Math.ceil((COVER_LETTER_COOLDOWN_MS - elapsed) / 1000) };
}

function setCooldown(userId: number): void {
  coverLetterCooldowns.set(userId, Date.now());
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
