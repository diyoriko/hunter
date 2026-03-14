import { Context, InlineKeyboard } from 'grammy';
import { getOrCreateUser, updateUser } from './db';
import { mainKeyboard } from './bot';
import { CONFIG } from './config';
import { escapeHtml } from './digest';
import { runAllScrapers } from './scrapers/runner';
import { logger } from './logger';
import type { OnboardingState, SkillWeight, UserProfile } from './types';

// --- State machine configuration ---

/** Map of onboarding states to their handlers */
const STEPS: Record<OnboardingState, {
  question: string;
  next: OnboardingState;
  parse: (text: string) => Record<string, any> | null;
}> = {
  new: {
    question: '',
    next: 'awaiting_name',
    parse: () => ({}),
  },
  awaiting_name: {
    question: 'Как тебя зовут?',
    next: 'awaiting_title',
    parse: (text) => {
      const name = text.trim().slice(0, 100);
      return name.length > 0 ? { name } : null;
    },
  },
  awaiting_title: {
    question: 'Кем работаешь? Например: Product Designer, Frontend Developer, Маркетолог',
    next: 'awaiting_experience',
    parse: (text) => {
      const title = text.trim().slice(0, 200);
      return title.length > 0 ? { title } : null;
    },
  },
  awaiting_experience: {
    question: 'Сколько лет опыта? (число)',
    next: 'awaiting_skills',
    parse: (text) => {
      const n = parseInt(text.trim(), 10);
      return !isNaN(n) && n >= 0 ? { yearsExperience: n } : null;
    },
  },
  awaiting_skills: {
    question: 'Перечисли ключевые навыки через запятую, от самого важного к менее важному.\nНапример: Figma, UI/UX, брендинг, HTML/CSS\n\nПервые навыки получат больший вес при скоринге.',
    next: 'awaiting_salary',
    parse: (text) => {
      const skills = text.slice(0, 500).split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
      const skillWeights: SkillWeight[] = skills.map((name, i) => ({
        name,
        weight: skills.length === 1 ? 1.0 : parseFloat((1.0 - (i / (skills.length - 1)) * 0.5).toFixed(2)),
      }));
      return { skills, skillWeights };
    },
  },
  awaiting_salary: {
    question: 'Желаемая зарплата? Формат: 300000-500000 (или 300k-500k)',
    next: 'awaiting_format',
    parse: (text) => {
      const trimmed = text.trim().toLowerCase();
      if (trimmed === 'пропустить' || trimmed === 'skip' || trimmed === '-') {
        return { salaryMin: null, salaryMax: null };
      }
      const cleaned = trimmed.replace(/[\s,]/g, '');
      const match = cleaned.match(/^(\d+)(k?)[-–](\d+)(k?)$/);
      if (match) {
        const min = parseInt(match[1], 10) * (match[2] ? 1000 : 1);
        const max = parseInt(match[3], 10) * (match[4] ? 1000 : 1);
        return { salaryMin: min, salaryMax: max };
      }
      const singleMatch = cleaned.match(/^(\d+)(k?)$/);
      if (singleMatch) {
        const val = parseInt(singleMatch[1], 10) * (singleMatch[2] ? 1000 : 1);
        return { salaryMin: val, salaryMax: null };
      }
      return null;
    },
  },
  awaiting_format: {
    question: '', // Inline buttons
    next: 'awaiting_domains',
    parse: () => ({}),
  },
  awaiting_domains: {
    question: '', // Inline buttons (multi-select)
    next: 'awaiting_red_flags',
    parse: () => ({}),
  },
  awaiting_red_flags: {
    question: 'Что точно НЕ подходит? Перечисли через запятую ключевые слова — вакансии с ними получат штраф.\nНапример: junior, стажёр, 3D, game design',
    next: 'awaiting_blacklist',
    parse: (text) => {
      const trimmed = text.trim().toLowerCase();
      if (trimmed === 'пропустить' || trimmed === 'skip' || trimmed === '-') {
        return { redFlags: [] };
      }
      return { redFlags: text.split(',').map(s => s.trim()).filter(Boolean) };
    },
  },
  awaiting_blacklist: {
    question: 'Компании, которые НЕ хочешь видеть? Через запятую.\nНапример: Яндекс Крауд, Mail.ru',
    next: 'awaiting_queries',
    parse: (text) => {
      const trimmed = text.trim().toLowerCase();
      if (trimmed === 'пропустить' || trimmed === 'skip' || trimmed === '-') {
        return { companyBlacklist: [] };
      }
      return { companyBlacklist: text.split(',').map(s => s.trim()).filter(Boolean) };
    },
  },
  awaiting_queries: {
    question: '', // Dynamic — generated from user's title
    next: 'awaiting_portfolio',
    parse: (text) => {
      const trimmed = text.trim().toLowerCase();
      if (trimmed === 'пропустить' || trimmed === 'skip' || trimmed === '-' || trimmed === 'ок' || trimmed === 'ok') {
        return {}; // Keep auto-generated queries
      }
      return { searchQueries: text.split(',').map(s => s.trim()).filter(Boolean) };
    },
  },
  awaiting_portfolio: {
    question: 'Ссылка на портфолио',
    next: 'awaiting_about',
    parse: (text) => {
      const trimmed = text.trim().toLowerCase();
      if (trimmed === 'пропустить' || trimmed === 'skip' || trimmed === '-') {
        return { portfolio: null };
      }
      return { portfolio: text.trim() };
    },
  },
  awaiting_about: {
    question: 'Расскажи кратко о своём опыте — где работал, что делал (до 2000 символов). Это будет использоваться для генерации сопроводительных писем.',
    next: 'complete',
    parse: (text) => {
      const trimmed = text.trim().toLowerCase();
      if (trimmed === 'пропустить' || trimmed === 'skip' || trimmed === '-') {
        return { about: null };
      }
      return { about: text.trim().slice(0, 2000) };
    },
  },
  complete: {
    question: '',
    next: 'complete',
    parse: () => ({}),
  },
};

// --- Editing sessions (field-by-field) ---

/** Tracks which field a user is currently editing (telegramId → field key) */
export const editingSessions = new Map<number, string>();

/** Edit field configuration: maps field key to label, onboarding state, and value getter */
const EDIT_FIELDS: Record<string, {
  label: string;
  state: OnboardingState;
  getValue: (u: UserProfile) => string;
}> = {
  name: {
    label: 'Имя',
    state: 'awaiting_name',
    getValue: (u) => u.name ?? '—',
  },
  title: {
    label: 'Должность',
    state: 'awaiting_title',
    getValue: (u) => u.title ?? '—',
  },
  experience: {
    label: 'Опыт',
    state: 'awaiting_experience',
    getValue: (u) => `${u.yearsExperience ?? 0} лет`,
  },
  skills: {
    label: 'Навыки',
    state: 'awaiting_skills',
    getValue: (u) => u.skills.length > 0 ? truncate(u.skills.join(', '), 50) : '—',
  },
  salary: {
    label: 'Зарплата',
    state: 'awaiting_salary',
    getValue: (u) => formatSalaryEdit(u),
  },
  format: {
    label: 'Формат',
    state: 'awaiting_format',
    getValue: (u) => u.preferredFormat,
  },
  domains: {
    label: 'Отрасли',
    state: 'awaiting_domains',
    getValue: (u) => u.domains.length > 0 ? truncate(u.domains.map(d => d.name).join(', '), 50) : 'любые',
  },
  red_flags: {
    label: 'Red flags',
    state: 'awaiting_red_flags',
    getValue: (u) => u.redFlags.length > 0 ? truncate(u.redFlags.join(', '), 50) : 'нет',
  },
  blacklist: {
    label: 'Блеклист',
    state: 'awaiting_blacklist',
    getValue: (u) => u.companyBlacklist.length > 0 ? truncate(u.companyBlacklist.join(', '), 50) : 'нет',
  },
  queries: {
    label: 'Запросы',
    state: 'awaiting_queries',
    getValue: (u) => u.searchQueries.length > 0 ? truncate(u.searchQueries.join(', '), 50) : 'из должности',
  },
  portfolio: {
    label: 'Портфолио',
    state: 'awaiting_portfolio',
    getValue: (u) => u.portfolio ? truncate(u.portfolio, 40) : '—',
  },
  about: {
    label: 'О себе',
    state: 'awaiting_about',
    getValue: (u) => u.about ? truncate(u.about, 40) : '—',
  },
};

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + '...' : s;
}

function formatSalaryEdit(u: UserProfile): string {
  if (!u.salaryMin && !u.salaryMax) return 'не указана';
  if (u.salaryMin && u.salaryMax) return `${u.salaryMin}–${u.salaryMax}`;
  if (u.salaryMin) return `от ${u.salaryMin}`;
  return `до ${u.salaryMax}`;
}

/** Show edit menu with all profile fields as inline buttons */
export async function showEditMenu(ctx: Context): Promise<void> {
  const telegramId = ctx.from!.id;
  const user = getOrCreateUser(telegramId);

  const lines = [
    '<b>Редактирование профиля</b>',
    '',
  ];

  for (const [key, cfg] of Object.entries(EDIT_FIELDS)) {
    lines.push(`<b>${escapeHtml(cfg.label)}:</b> ${escapeHtml(cfg.getValue(user))}`);
  }

  lines.push('', 'Выбери поле для редактирования:');

  const kb = new InlineKeyboard();
  const keys = Object.keys(EDIT_FIELDS);
  for (let i = 0; i < keys.length; i++) {
    kb.text(EDIT_FIELDS[keys[i]].label, `edit:${keys[i]}`);
    if (i % 2 === 1) kb.row();
  }
  if (keys.length % 2 !== 0) kb.row();
  kb.text('❌ Закрыть', 'edit:cancel');

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
}

/** Handle user picking a field to edit */
export async function handleEditFieldCallback(ctx: Context, field: string): Promise<void> {
  const telegramId = ctx.from!.id;
  const cfg = EDIT_FIELDS[field];
  if (!cfg) return;

  await ctx.answerCallbackQuery();

  // Track editing in-memory only — DB state stays 'complete'
  editingSessions.set(telegramId, field);

  try { await ctx.deleteMessage(); } catch { /* ok */ }

  // Button-based fields — just show the question (buttons included)
  if (field === 'format' || field === 'domains') {
    await askQuestion(ctx, cfg.state);
    return;
  }

  // Text-based fields — show current value, then question
  const user = getOrCreateUser(telegramId);
  await ctx.reply(`Текущее значение: ${cfg.getValue(user)}`);
  await askQuestion(ctx, cfg.state);
}

/** Handle text input during field editing */
async function handleEditingTextInput(ctx: Context, field: string): Promise<boolean> {
  const telegramId = ctx.from!.id;
  const cfg = EDIT_FIELDS[field];
  if (!cfg) return false;

  const text = ctx.message?.text;
  if (!text) return true;

  const step = STEPS[cfg.state];
  const parsed = step.parse(text);

  if (parsed === null) {
    await ctx.reply('Не понял. Попробуй ещё раз.');
    return true;
  }

  // For queries: if user sends "ок", keep existing queries
  if (field === 'queries' && !parsed.searchQueries) {
    // Keep auto-generated queries, just move on
  } else {
    updateUser(telegramId, parsed);
  }

  // DB state is already 'complete' — just clear in-memory session
  editingSessions.delete(telegramId);

  await showEditMenu(ctx);
  return true;
}

// --- Navigation ---

/** Previous state for "Назад" button */
const PREV_STATE: Partial<Record<OnboardingState, OnboardingState>> = {
  awaiting_title: 'awaiting_name',
  awaiting_experience: 'awaiting_title',
  awaiting_skills: 'awaiting_experience',
  awaiting_salary: 'awaiting_skills',
  awaiting_format: 'awaiting_salary',
  awaiting_domains: 'awaiting_format',
  awaiting_red_flags: 'awaiting_domains',
  awaiting_blacklist: 'awaiting_red_flags',
  awaiting_queries: 'awaiting_blacklist',
  awaiting_portfolio: 'awaiting_queries',
  awaiting_about: 'awaiting_portfolio',
};

/** Steps where "Пропустить" inline button is shown */
const SKIPPABLE_STEPS: Set<OnboardingState> = new Set([
  'awaiting_salary',
  'awaiting_red_flags',
  'awaiting_blacklist',
  'awaiting_portfolio',
  'awaiting_about',
]);

/** Default data when skipping a step */
function getSkipData(state: OnboardingState): Record<string, any> {
  switch (state) {
    case 'awaiting_salary': return { salaryMin: null, salaryMax: null };
    case 'awaiting_red_flags': return { redFlags: [] };
    case 'awaiting_blacklist': return { companyBlacklist: [] };
    case 'awaiting_queries': return {};
    case 'awaiting_portfolio': return { portfolio: null };
    case 'awaiting_about': return { about: null };
    default: return {};
  }
}

/** Build inline keyboard for text-based steps (skip + back) */
function buildStepKeyboard(state: OnboardingState, telegramId?: number): InlineKeyboard | undefined {
  const isEditing = telegramId ? editingSessions.has(telegramId) : false;
  const hasBack = PREV_STATE[state] !== undefined || isEditing;
  const isSkippable = SKIPPABLE_STEPS.has(state);

  if (!hasBack && !isSkippable) return undefined;

  const kb = new InlineKeyboard();
  if (isSkippable) kb.text('Пропустить', 'onb:skip');
  if (hasBack) kb.text('\u25C0\uFE0F Назад', 'onb:back');

  return kb;
}

// --- Domain multi-select state (in-memory, per user) ---

const domainSelections = new Map<number, Set<string>>();

const CONFIG_DOMAIN_SET = new Set<string>(CONFIG.domains as unknown as string[]);

function buildDomainKeyboard(telegramId: number): InlineKeyboard {
  const selected = domainSelections.get(telegramId) || new Set();
  const kb = new InlineKeyboard();
  const domains = CONFIG.domains;

  // Standard domains in rows of 3
  for (let i = 0; i < domains.length; i++) {
    const d = domains[i];
    const label = selected.has(d) ? `\u2705 ${d}` : d;
    kb.text(label, `domain:${d}`);
    if (i % 3 === 2) kb.row();
  }
  if (domains.length % 3 !== 0) kb.row();

  // Custom domains (user-added, not in standard list)
  const customDomains = [...selected].filter(d => !CONFIG_DOMAIN_SET.has(d));
  for (const d of customDomains) {
    kb.text(`\u2705 ${d}`, `domain:${d}`).row();
  }

  // Action buttons
  kb.text('\u2795 Своя отрасль', 'domain:custom').row();
  kb.text('\u2705 Готово', 'domain:done')
    .text('Пропустить', 'domain:skip').row();
  kb.text('\u25C0\uFE0F Назад', 'onb:back');

  return kb;
}

// --- Completion message ---

async function sendComplete(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      'Профиль готов! Вот как пользоваться:',
      '',
      '\uD83D\uDCCB <b>Дайджест</b> — посмотреть подборку вакансий',
      '\uD83D\uDC64 <b>Профиль</b> — посмотреть или редактировать профиль',
      '\uD83D\uDCCA <b>Статистика</b> — скор, источники, активность',
      '',
      'Ищу первые вакансии для тебя...',
    ].join('\n'),
    { parse_mode: 'HTML', reply_markup: mainKeyboard },
  );

  // Auto-scrape for new user with progress feedback
  try {
    const progressMsg = await ctx.reply(
      '\u{1F50D} \u0418\u0449\u0443 \u043D\u0430 hh.ru...',
      { reply_markup: mainKeyboard },
    );

    const { runScrapersWithProgress } = await import('./scrapers/runner');
    const results = await runScrapersWithProgress(async (source, step) => {
      try {
        const texts: Record<string, string> = {
          'hh.ru': '\u{1F50D} \u0418\u0449\u0443 \u043D\u0430 hh.ru...',
          'habr': '\u{1F50D} \u0418\u0449\u0443 \u043D\u0430 Habr...',
          'scoring': '\u{1F9E0} \u041E\u0446\u0435\u043D\u0438\u0432\u0430\u044E \u0432\u0430\u043A\u0430\u043D\u0441\u0438\u0438...',
        };
        await ctx.api.editMessageText(
          ctx.chat!.id,
          progressMsg.message_id,
          texts[step] ?? `\u{1F50D} ${source}...`,
        );
      } catch (err) { logger.warn('onboarding', 'Progress edit failed', { error: String(err) }); }
    });

    const totalNew = results.reduce((sum, r) => sum + r.new, 0);
    try {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        progressMsg.message_id,
        `\u2705 \u0413\u043E\u0442\u043E\u0432\u043E! \u041D\u0430\u0439\u0434\u0435\u043D\u043E ${totalNew} \u043D\u043E\u0432\u044B\u0445 \u0432\u0430\u043A\u0430\u043D\u0441\u0438\u0439. \u041D\u0430\u0436\u043C\u0438 <b>\u0414\u0430\u0439\u0434\u0436\u0435\u0441\u0442</b>.`,
        { parse_mode: 'HTML' },
      );
    } catch (err) { logger.warn('onboarding', 'Final progress edit failed', { error: String(err) }); }
  } catch (err) {
    logger.warn('onboarding', 'Auto-scrape after onboarding failed', { error: String(err) });
  }
}

// --- Search query suggestions ---

function generateQuerySuggestions(title: string): string[] {
  if (!title) return [];

  const suggestions = [title];

  const designMap: Record<string, string[]> = {
    'product designer': ['продуктовый дизайнер', 'UX/UI дизайнер', 'product designer'],
    'ui/ux designer': ['UX/UI дизайнер', 'product designer', 'дизайнер интерфейсов'],
    'бренд дизайнер': ['brand designer', 'графический дизайнер', 'visual designer'],
    'brand designer': ['бренд дизайнер', 'графический дизайнер', 'visual designer'],
    'графический дизайнер': ['graphic designer', 'visual designer', 'бренд дизайнер'],
    'продуктовый дизайнер': ['product designer', 'UX/UI designer', 'UX/UI senior'],
  };

  const titleLower = title.toLowerCase();
  for (const [key, vals] of Object.entries(designMap)) {
    if (titleLower.includes(key)) {
      suggestions.push(...vals);
    }
  }

  if (!titleLower.includes('senior') && !titleLower.includes('junior')) {
    suggestions.push(`senior ${title}`);
  }

  return [...new Set(suggestions)];
}

// --- Handlers ---

/** Start or continue onboarding for a user */
export async function handleOnboarding(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from!.id;

  // --- Editing sessions: intercept text input (DB state stays 'complete') ---
  if (editingSessions.has(telegramId)) {
    const field = editingSessions.get(telegramId)!;
    if (field === 'format') {
      await ctx.reply('Выбери формат кнопкой выше.');
      return true;
    }
    if (field === 'domains') {
      // Accept text as custom domain name (same as onboarding)
      const domText = ctx.message?.text?.trim();
      if (domText) {
        if (!domainSelections.has(telegramId)) {
          domainSelections.set(telegramId, new Set());
        }
        domainSelections.get(telegramId)!.add(domText);
        await ctx.reply(`В каких отраслях хочешь работать? Добавлена: ${domText}`, {
          reply_markup: buildDomainKeyboard(telegramId),
        });
      }
      return true;
    }
    // Text field editing
    return await handleEditingTextInput(ctx, field);
  }

  const user = getOrCreateUser(telegramId);

  if (user.onboardingState === 'complete') return false;

  if (user.onboardingState === 'new') {
    await ctx.reply(
      'Привет! Я помогу найти работу.\n\nДавай настроим профиль — займёт пару минут.',
    );
    updateUser(telegramId, { onboardingState: 'awaiting_name' });
    await askQuestion(ctx, 'awaiting_name');
    return true;
  }

  // Inline-button steps
  if (user.onboardingState === 'awaiting_format') {
    await ctx.reply('Выбери формат кнопкой выше.');
    return true;
  }

  if (user.onboardingState === 'awaiting_domains') {
    // Accept text as custom domain name
    const text = ctx.message?.text?.trim();
    if (text) {
      if (!domainSelections.has(telegramId)) {
        domainSelections.set(telegramId, new Set());
      }
      domainSelections.get(telegramId)!.add(text);
      await ctx.reply(`В каких отраслях хочешь работать? Добавлена: ${text}`, {
        reply_markup: buildDomainKeyboard(telegramId),
      });
    }
    return true;
  }

  // Process text input for current step
  const text = ctx.message?.text;
  if (!text) return true;

  const step = STEPS[user.onboardingState];
  const parsed = step.parse(text);

  if (parsed === null) {
    await ctx.reply('Не понял. Попробуй ещё раз.');
    return true;
  }

  // For queries step: if user sends "ок", auto-generate from title
  if (user.onboardingState === 'awaiting_queries') {
    if (!parsed.searchQueries) {
      updateUser(telegramId, { onboardingState: step.next });
    } else {
      updateUser(telegramId, { ...parsed, onboardingState: step.next });
    }
  } else {
    updateUser(telegramId, { ...parsed, onboardingState: step.next });
  }

  if (step.next === 'complete') {
    await sendComplete(ctx);
    return true;
  }

  await askQuestion(ctx, step.next);
  return true;
}

/** Handle inline button callback for format selection */
export async function handleFormatCallback(ctx: Context, format: string): Promise<void> {
  const telegramId = ctx.from!.id;

  // Editing mode: check in-memory session (DB state is 'complete')
  if (editingSessions.get(telegramId) === 'format') {
    await ctx.answerCallbackQuery();
    updateUser(telegramId, { preferredFormat: format });
    editingSessions.delete(telegramId);
    try { await ctx.deleteMessage(); } catch { /* ok */ }
    await showEditMenu(ctx);
    return;
  }

  // Onboarding mode
  const user = getOrCreateUser(telegramId);
  if (user.onboardingState !== 'awaiting_format') return;

  await ctx.answerCallbackQuery();
  updateUser(telegramId, { preferredFormat: format, onboardingState: 'awaiting_domains' });
  try { await ctx.deleteMessage(); } catch { /* ok */ }
  await askQuestion(ctx, 'awaiting_domains');
}

/** Handle domain toggle/done/skip/custom callback */
export async function handleDomainCallback(ctx: Context, action: string): Promise<void> {
  const telegramId = ctx.from!.id;
  const isEditing = editingSessions.get(telegramId) === 'domains';

  // Guard: must be in domain step (either editing or onboarding)
  if (!isEditing) {
    const user = getOrCreateUser(telegramId);
    if (user.onboardingState !== 'awaiting_domains') return;
  }

  if (action === 'custom') {
    await ctx.answerCallbackQuery({ text: 'Напиши название отрасли текстом' });
    return;
  }

  await ctx.answerCallbackQuery();

  if (action === 'done') {
    const selected = domainSelections.get(telegramId) || new Set();
    const domainsArr = [...selected];
    const domains = domainsArr.map((name, i) => ({
      name,
      weight: domainsArr.length === 1 ? 0.8 : parseFloat((0.8 - (i / Math.max(domainsArr.length - 1, 1)) * 0.3).toFixed(2)),
    }));

    domainSelections.delete(telegramId);
    updateUser(telegramId, { domains });

    if (isEditing) {
      editingSessions.delete(telegramId);
      try { await ctx.deleteMessage(); } catch { /* ok */ }
      await showEditMenu(ctx);
      return;
    }

    updateUser(telegramId, { onboardingState: 'awaiting_red_flags' });
    try { await ctx.deleteMessage(); } catch { /* ok */ }
    await askQuestion(ctx, 'awaiting_red_flags');
    return;
  }

  if (action === 'skip') {
    domainSelections.delete(telegramId);
    updateUser(telegramId, { domains: [] });

    if (isEditing) {
      editingSessions.delete(telegramId);
      try { await ctx.deleteMessage(); } catch { /* ok */ }
      await showEditMenu(ctx);
      return;
    }

    updateUser(telegramId, { onboardingState: 'awaiting_red_flags' });
    try { await ctx.deleteMessage(); } catch { /* ok */ }
    await askQuestion(ctx, 'awaiting_red_flags');
    return;
  }

  // Toggle domain
  if (!domainSelections.has(telegramId)) {
    domainSelections.set(telegramId, new Set());
  }
  const sel = domainSelections.get(telegramId)!;

  if (sel.has(action)) {
    sel.delete(action);
  } else {
    sel.add(action);
  }

  try {
    await ctx.editMessageReplyMarkup({
      reply_markup: buildDomainKeyboard(telegramId),
    });
  } catch { /* ok */ }
}

/** Handle onboarding navigation callbacks (onb:back, onb:skip, onb:ok) */
export async function handleOnboardingNavCallback(ctx: Context, action: string): Promise<void> {
  const telegramId = ctx.from!.id;

  // Editing mode: all nav actions return to edit menu (no DB state changes)
  if (editingSessions.has(telegramId)) {
    await ctx.answerCallbackQuery();

    if (action === 'skip') {
      const field = editingSessions.get(telegramId)!;
      const editState = EDIT_FIELDS[field]?.state;
      if (editState) {
        const skipData = getSkipData(editState);
        updateUser(telegramId, skipData);
      }
    }

    editingSessions.delete(telegramId);
    domainSelections.delete(telegramId);
    try { await ctx.deleteMessage(); } catch { /* ok */ }
    await showEditMenu(ctx);
    return;
  }

  const user = getOrCreateUser(telegramId);
  if (user.onboardingState === 'complete') return;

  await ctx.answerCallbackQuery();

  if (action === 'back') {
    const prev = PREV_STATE[user.onboardingState];
    if (!prev) return;

    // Clean up domain state if leaving domains step
    if (user.onboardingState === 'awaiting_domains') {
      domainSelections.delete(telegramId);
    }

    updateUser(telegramId, { onboardingState: prev });
    try { await ctx.deleteMessage(); } catch { /* ok */ }
    await askQuestion(ctx, prev);
    return;
  }

  if (action === 'skip') {
    const step = STEPS[user.onboardingState];
    const skipData = getSkipData(user.onboardingState);

    updateUser(telegramId, { ...skipData, onboardingState: step.next });
    try { await ctx.deleteMessage(); } catch { /* ok */ }

    if (step.next === 'complete') {
      await sendComplete(ctx);
    } else {
      await askQuestion(ctx, step.next);
    }
    return;
  }

  if (action === 'ok') {
    // Accept auto-generated queries
    const step = STEPS[user.onboardingState];
    updateUser(telegramId, { onboardingState: step.next });
    try { await ctx.deleteMessage(); } catch { /* ok */ }

    if (step.next === 'complete') {
      await sendComplete(ctx);
    } else {
      await askQuestion(ctx, step.next);
    }
    return;
  }
}

/** Send the question for a given onboarding state */
export async function askQuestion(ctx: Context, state: OnboardingState): Promise<void> {
  // Format step — inline buttons with back
  if (state === 'awaiting_format') {
    const kb = new InlineKeyboard()
      .text('Удалённо', 'format:remote')
      .text('Гибрид', 'format:hybrid').row()
      .text('Офис', 'format:office')
      .text('Любой', 'format:any').row()
      .text('\u25C0\uFE0F Назад', 'onb:back');

    await ctx.reply('Предпочитаемый формат работы:', { reply_markup: kb });
    return;
  }

  // Domains step — multi-select inline buttons
  if (state === 'awaiting_domains') {
    const telegramId = ctx.from!.id;
    domainSelections.set(telegramId, new Set());

    await ctx.reply('В каких отраслях хочешь работать? Выбери одну или несколько:', {
      reply_markup: buildDomainKeyboard(telegramId),
    });
    return;
  }

  // Queries step — auto-generated suggestions
  if (state === 'awaiting_queries') {
    const telegramId = ctx.from!.id;
    const user = getOrCreateUser(telegramId);
    const suggestions = generateQuerySuggestions(user.title);

    const kb = new InlineKeyboard();
    if (suggestions.length > 0) {
      updateUser(telegramId, { searchQueries: suggestions });
      kb.text('Ок', 'onb:ok');
    } else {
      kb.text('Пропустить', 'onb:skip');
    }
    if (PREV_STATE[state]) kb.text('\u25C0\uFE0F Назад', 'onb:back');

    if (suggestions.length > 0) {
      await ctx.reply(
        `Поисковые запросы для hh.ru и Habr. Я подобрал на основе твоей должности:\n\n${suggestions.map(q => `\u2022 ${q}`).join('\n')}\n\nНапиши свои через запятую или нажми Ок.`,
        { reply_markup: kb },
      );
    } else {
      await ctx.reply(
        'Какие поисковые запросы использовать для поиска вакансий? Через запятую.\nНапример: product designer, UX/UI дизайнер, продуктовый дизайнер',
        { reply_markup: kb },
      );
    }
    return;
  }

  // Standard text steps — with optional skip/back buttons
  const step = STEPS[state];
  if (step.question) {
    const telegramId = ctx.from!.id;
    const kb = buildStepKeyboard(state, telegramId);
    await ctx.reply(step.question, kb ? { reply_markup: kb } : undefined);
  }
}
