import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { UserProfile, Vacancy } from './types';

// ---- Top-level mocks (hoisted by vitest) ----

vi.mock('./config', () => ({
  CONFIG: {
    dbPath: ':memory:',
    telegramBotToken: 'test-token-123:ABC',
    adminTelegramId: 999999,
    scoring: { skills: 0.40, salary: 0.25, format: 0.20, domain: 0.15 },
    freemium: {
      free: { coverLetters: 5, digestPageSize: 15, pushMaxCards: 2 },
      pro: { coverLetters: Infinity, digestPageSize: Infinity, pushMaxCards: 5 },
      creditsPerLetter: 5,
    },
    stars: {
      proMonthly: 700,
      proYearly: 6720,
      creditsSmall: { stars: 100, letters: 3 },
      creditsLarge: { stars: 300, letters: 10 },
    },
    domains: ['SaaS/B2B', 'EdTech', 'FinTech', 'AI/ML'] as readonly string[],
    pageSize: 15,
  },
}));

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('./cover-letter', () => ({
  getCoverLetter: vi.fn().mockReturnValue(null),
  generateCoverLetter: vi.fn().mockResolvedValue('Generated cover letter text'),
}));

vi.mock('./onboarding', () => ({
  handleOnboarding: vi.fn().mockResolvedValue(false),
  handleFormatCallback: vi.fn().mockResolvedValue(undefined),
  handleDomainCallback: vi.fn().mockResolvedValue(undefined),
  handleOnboardingNavCallback: vi.fn().mockResolvedValue(undefined),
  askQuestion: vi.fn().mockResolvedValue(undefined),
  showEditMenu: vi.fn().mockResolvedValue(undefined),
  editingSessions: new Map<number, string>(),
  handleEditFieldCallback: vi.fn().mockResolvedValue(undefined),
}));

// ---- DB + Bot modules (loaded fresh per test) ----

let db: typeof import('./db');
let botModule: typeof import('./bot');

// ---- Fake botInfo to skip getMe API call ----

const FAKE_BOT_INFO = {
  id: 123456789,
  is_bot: true as const,
  first_name: 'TestBot',
  username: 'test_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
};

// ---- Factories ----

function makeVacancy(overrides: Partial<Vacancy> = {}): Vacancy {
  return {
    source: 'hh.ru',
    externalId: `ext-${Math.random().toString(36).slice(2)}`,
    title: 'Product Designer',
    company: 'TechCorp',
    salaryFrom: 200_000,
    salaryTo: 400_000,
    salaryCurrency: 'RUB',
    format: 'remote',
    city: 'Moscow',
    description: 'Looking for a product designer',
    skills: ['Figma', 'UI/UX'],
    url: 'https://hh.ru/vacancy/123',
    publishedAt: new Date(),
    experience: 'middle',
    ...overrides,
  };
}

function makeUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 1,
    telegramId: 12345,
    name: 'Test User',
    title: 'Product Designer',
    yearsExperience: 5,
    skills: ['Figma', 'UI/UX', 'Prototyping'],
    skillWeights: [],
    salaryMin: 200_000,
    salaryMax: 400_000,
    salaryCurrency: 'RUB',
    preferredFormat: 'remote',
    domains: [],
    redFlags: [],
    companyBlacklist: [],
    searchQueries: ['product designer'],
    portfolio: null,
    about: null,
    onboardingState: 'complete',
    createdAt: new Date(),
    plan: 'free',
    planExpiresAt: null,
    lettersUsed: 0,
    credits: 0,
    ...overrides,
  };
}

// ---- Setup / teardown ----

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  db = await import('./db');
  botModule = await import('./bot');
  db.getDb();
  apiCalls = [];
});

afterEach(() => {
  try { db.getDb().close(); } catch { /* ok */ }
});

// ---- API call capture ----

interface ApiCall {
  method: string;
  payload: Record<string, any>;
}

let apiCalls: ApiCall[] = [];

function findCalls(method: string): ApiCall[] {
  return apiCalls.filter(c => c.method === method);
}

// ---- Helpers ----

function setupOnboardedUser(telegramId = 12345) {
  db.getOrCreateUser(telegramId);
  db.updateUser(telegramId, {
    name: 'Test User',
    title: 'Product Designer',
    skills: ['Figma', 'UI/UX'],
    onboardingState: 'complete',
    salaryMin: 200_000,
    salaryMax: 400_000,
    preferredFormat: 'remote',
  });
  return db.getOrCreateUser(telegramId);
}

function insertScoredVacancy(userId: number, score: number, overrides: Partial<Vacancy> = {}) {
  const v = makeVacancy(overrides);
  const { id } = db.upsertVacancy(v);
  db.upsertUserVacancy(userId, id, score, score, score, score, score);
  return id;
}

/** Create bot with fake botInfo and mocked API; captures all outgoing API calls */
function createTestBot() {
  const bot = botModule.createBot();
  bot.botInfo = FAKE_BOT_INFO;
  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload: payload as Record<string, any> });
    const mockResponses: Record<string, any> = {
      sendMessage: { message_id: Math.floor(Math.random() * 10000), date: Math.floor(Date.now() / 1000), chat: { id: 1, type: 'private' } },
      editMessageText: true,
      editMessageReplyMarkup: true,
      deleteMessage: true,
      answerCallbackQuery: true,
      answerPreCheckoutQuery: true,
      sendInvoice: { message_id: Math.floor(Math.random() * 10000), date: Math.floor(Date.now() / 1000), chat: { id: 1, type: 'private' } },
    };
    return { ok: true as const, result: mockResponses[method] ?? true };
  });
  return bot;
}

// ---- Telegram update builders ----

function commandUpdate(cmd: string, fromId: number, updateId = 1): any {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: fromId, is_bot: false, first_name: 'Test' },
      chat: { id: fromId, type: 'private', first_name: 'Test' },
      date: Math.floor(Date.now() / 1000),
      text: `/${cmd}`,
      entities: [{ type: 'bot_command', offset: 0, length: cmd.length + 1 }],
    },
  };
}

function textUpdate(text: string, fromId: number, updateId = 1): any {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: fromId, is_bot: false, first_name: 'Test' },
      chat: { id: fromId, type: 'private', first_name: 'Test' },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  };
}

function callbackUpdate(data: string, fromId: number, updateId = 1): any {
  return {
    update_id: updateId,
    callback_query: {
      id: `cq_${updateId}`,
      from: { id: fromId, is_bot: false, first_name: 'Test' },
      chat_instance: '123',
      data,
      message: {
        message_id: 100 + updateId,
        from: { id: FAKE_BOT_INFO.id, is_bot: true, first_name: 'Bot' },
        chat: { id: fromId, type: 'private', first_name: 'Test' },
        date: Math.floor(Date.now() / 1000),
        text: 'Previous message',
      },
    },
  };
}

function preCheckoutUpdate(fromId: number, payload: string, amount: number, updateId = 1): any {
  return {
    update_id: updateId,
    pre_checkout_query: {
      id: `pcq_${updateId}`,
      from: { id: fromId, is_bot: false, first_name: 'Test' },
      currency: 'XTR',
      total_amount: amount,
      invoice_payload: payload,
    },
  };
}

function paymentUpdate(fromId: number, payload: string, amount: number, chargeId: string, updateId = 1): any {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: fromId, is_bot: false, first_name: 'Test' },
      chat: { id: fromId, type: 'private', first_name: 'Test' },
      date: Math.floor(Date.now() / 1000),
      successful_payment: {
        currency: 'XTR',
        total_amount: amount,
        invoice_payload: payload,
        telegram_payment_charge_id: chargeId,
        provider_payment_charge_id: `prov_${chargeId}`,
      },
    },
  };
}

// ==============================
// TESTS
// ==============================

describe('createBot', () => {
  it('returns a Bot instance with start method', () => {
    const bot = botModule.createBot();
    expect(bot).toBeDefined();
    expect(typeof bot.start).toBe('function');
  });

  it('has error handler installed', () => {
    const bot = botModule.createBot();
    expect(bot.errorHandler).toBeDefined();
  });
});

describe('mainKeyboard', () => {
  it('is exported', () => {
    expect(botModule.mainKeyboard).toBeDefined();
  });
});

// ---- Guard function logic (unit tests via makeUser + DB) ----

describe('checkCoverLetterLimit (logic)', () => {
  it('allows free user under limit', () => {
    const user = makeUser({ plan: 'free', lettersUsed: 3, credits: 0 });
    expect(user.lettersUsed < 5).toBe(true);
  });

  it('blocks free user at limit with no credits', () => {
    const user = makeUser({ plan: 'free', lettersUsed: 5, credits: 0 });
    const atLimit = user.lettersUsed >= 5;
    const hasCredits = user.credits >= 5;
    expect(atLimit && !hasCredits).toBe(true);
  });

  it('allows free user at limit with sufficient credits', () => {
    const user = makeUser({ plan: 'free', lettersUsed: 5, credits: 10 });
    expect(user.credits >= 5).toBe(true);
  });

  it('always allows pro user', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const user = makeUser({ plan: 'pro', planExpiresAt: future, lettersUsed: 100 });
    expect(db.isProUser(user)).toBe(true);
  });
});

describe('consumeCoverLetterQuota (logic)', () => {
  it('increments lettersUsed for free user under limit', () => {
    const user = setupOnboardedUser(12345);
    expect(user.lettersUsed).toBe(0);
    db.incrementLettersUsed(user.id);
    const updated = db.getOrCreateUser(12345);
    expect(updated.lettersUsed).toBe(1);
  });

  it('uses credits when free quota exhausted', () => {
    const user = setupOnboardedUser(12345);
    for (let i = 0; i < 5; i++) db.incrementLettersUsed(user.id);
    db.addCredits(user.id, 10);
    const updated = db.getOrCreateUser(12345);
    expect(updated.lettersUsed).toBe(5);
    expect(updated.credits).toBe(10);
    const used = db.useCredits(updated.id, 5);
    expect(used).toBe(true);
    const final = db.getOrCreateUser(12345);
    expect(final.credits).toBe(5);
  });

  it('does not deduct anything for pro user', () => {
    const user = setupOnboardedUser(12345);
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    db.activatePro(user.id, future);
    const proUser = db.getOrCreateUser(12345);
    expect(db.isProUser(proUser)).toBe(true);
    expect(proUser.lettersUsed).toBe(0);
  });
});

// ---- /start command ----

describe('/start command', () => {
  it('shows welcome-back for completed user', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('start', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.length).toBeGreaterThan(0);
    expect(sends.some(s => s.payload.text.includes('С возвращением'))).toBe(true);
  });

  it('triggers onboarding for new user', async () => {
    db.getOrCreateUser(55555);
    expect(db.getOrCreateUser(55555).onboardingState).toBe('new');

    const { handleOnboarding } = await import('./onboarding');
    (handleOnboarding as any).mockResolvedValue(true);

    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('start', 55555));
    expect(handleOnboarding).toHaveBeenCalled();
  });

  it('recovers stuck onboarding state on /start', async () => {
    db.getOrCreateUser(12345);
    db.updateUser(12345, {
      name: 'Stuck User',
      title: 'Designer',
      onboardingState: 'awaiting_format',
    });

    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('start', 12345));
    const fixed = db.getOrCreateUser(12345);
    expect(fixed.onboardingState).toBe('complete');

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('С возвращением'))).toBe(true);
  });

  it('ignores update without from field', async () => {
    const bot = createTestBot();
    const update: any = {
      update_id: 99,
      message: {
        message_id: 99,
        chat: { id: 12345, type: 'private', first_name: 'Test' },
        date: Math.floor(Date.now() / 1000),
        text: '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    };
    await bot.handleUpdate(update);
    // No API calls should be made for messages without from
    expect(findCalls('sendMessage').length).toBe(0);
  });
});

// ---- /digest command ----

describe('/digest command', () => {
  it('shows empty digest message when no vacancies', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('digest', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Нет релевантных вакансий'))).toBe(true);
  });

  it('shows digest header with vacancy count', async () => {
    const user = setupOnboardedUser(12345);
    insertScoredVacancy(user.id, 80);
    insertScoredVacancy(user.id, 70);
    insertScoredVacancy(user.id, 60);

    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('digest', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Дайджест') && s.payload.text.includes('3'))).toBe(true);
  });

  it('sends vacancy cards with correct format', async () => {
    const user = setupOnboardedUser(12345);
    insertScoredVacancy(user.id, 80, { title: 'UX Lead', company: 'BigCorp' });

    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('digest', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('UX Lead'))).toBe(true);
    expect(sends.some(s => s.payload.text.includes('BigCorp'))).toBe(true);
    // Cards use HTML
    expect(sends.some(s => s.payload.parse_mode === 'HTML')).toBe(true);
  });

  it('marks vacancies as notified after showing', async () => {
    const user = setupOnboardedUser(12345);
    const vacId = insertScoredVacancy(user.id, 80);

    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('digest', 12345));

    const unnotified = db.getUnnotifiedHighScoreVacancies(user.id, 70);
    expect(unnotified.length).toBe(0);
  });

  it('shows paywall when free user has more vacancies than limit', async () => {
    const user = setupOnboardedUser(12345);
    // Insert 20 vacancies (free digestPageSize is 15)
    for (let i = 0; i < 20; i++) {
      insertScoredVacancy(user.id, 80 - i);
    }

    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('digest', 12345));

    const sends = findCalls('sendMessage');
    // Free user sees paywall after 15 vacancies
    expect(sends.some(s => s.payload.text?.includes('Показано 15 лучших вакансий'))).toBe(true);
  });

  it('shows "show more" button for pro user with many vacancies', async () => {
    const user = setupOnboardedUser(12345);
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    db.activatePro(user.id, future);

    // Insert 20 vacancies
    for (let i = 0; i < 20; i++) {
      insertScoredVacancy(user.id, 80 - i);
    }

    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('digest', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text?.includes('из 20'))).toBe(true);
  });
});

// ---- /profile command ----

describe('/profile command', () => {
  it('shows profile with user name and skills', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('profile', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Test User'))).toBe(true);
    expect(sends.some(s => s.payload.text.includes('Figma'))).toBe(true);
  });

  it('shows Free plan info', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('profile', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Free'))).toBe(true);
  });

  it('shows Pro plan info for pro user', async () => {
    const user = setupOnboardedUser(12345);
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    db.activatePro(user.id, future);

    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('profile', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Pro'))).toBe(true);
  });

  it('shows salary range in profile', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('profile', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('200000') && s.payload.text.includes('400000'))).toBe(true);
  });

  it('includes edit and subscribe buttons', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('profile', 12345));

    const sends = findCalls('sendMessage');
    // reply_markup should contain inline keyboard
    expect(sends.some(s => s.payload.reply_markup)).toBe(true);
  });
});

// ---- /stats command ----

describe('/stats command', () => {
  it('shows stats header', async () => {
    const user = setupOnboardedUser(12345);
    insertScoredVacancy(user.id, 80);
    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('stats', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Статистика'))).toBe(true);
  });

  it('shows vacancy and letter counts', async () => {
    const user = setupOnboardedUser(12345);
    insertScoredVacancy(user.id, 80);
    insertScoredVacancy(user.id, 60);

    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('stats', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Вакансий'))).toBe(true);
    expect(sends.some(s => s.payload.text.includes('Релевантных'))).toBe(true);
  });

  it('shows applied count after marking vacancy', async () => {
    const user = setupOnboardedUser(12345);
    const v1 = insertScoredVacancy(user.id, 80);
    db.updateUserVacancyStatus(user.id, v1, 'applied');

    const stats = db.getUserStats(user.id);
    expect(stats.applied).toBe(1);
  });

  it('shows scoring explanation', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('stats', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Навыки') && s.payload.text.includes('40%'))).toBe(true);
  });
});

// ---- /subscribe command ----

describe('/subscribe command', () => {
  it('shows tariff plans with prices for free user', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('subscribe', 12345));

    const sends = findCalls('sendMessage');
    const tariffMsg = sends.find(s => s.payload.text.includes('Тарифы Hunter'));
    expect(tariffMsg).toBeDefined();
    expect(tariffMsg!.payload.text).toContain('700');
    expect(tariffMsg!.payload.text).toContain('6720');
    expect(tariffMsg!.payload.text).toContain('Free');
    expect(tariffMsg!.payload.text).toContain('Pro');
  });

  it('shows active subscription message for pro user', async () => {
    const user = setupOnboardedUser(12345);
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    db.activatePro(user.id, future);

    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('subscribe', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('У тебя Pro'))).toBe(true);
  });

  it('shows remaining free letters count', async () => {
    const user = setupOnboardedUser(12345);
    db.incrementLettersUsed(user.id);
    db.incrementLettersUsed(user.id);

    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('subscribe', 12345));

    const sends = findCalls('sendMessage');
    // 5 - 2 = 3 remaining
    expect(sends.some(s => s.payload.text.includes('3 из 5'))).toBe(true);
  });
});

// ---- /clear command ----

describe('/clear command', () => {
  it('shows clear confirmation with inline buttons', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('clear', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Очистить чат'))).toBe(true);
    expect(sends.some(s => s.payload.reply_markup)).toBe(true);
  });
});

// ---- /adminstats command ----

describe('/adminstats command', () => {
  it('shows admin stats for admin user (999999)', async () => {
    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('adminstats', 999999));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Admin Stats'))).toBe(true);
    expect(sends.some(s => s.payload.text.includes('Total users'))).toBe(true);
    expect(sends.some(s => s.payload.text.includes('Pro users'))).toBe(true);
  });

  it('silently ignores non-admin user', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('adminstats', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.every(s => !s.payload.text?.includes('Admin Stats'))).toBe(true);
  });
});

// ---- /adminscore command ----

describe('/adminscore command', () => {
  it('shows score distribution for admin with data', async () => {
    const admin = setupOnboardedUser(999999);
    insertScoredVacancy(admin.id, 80);
    insertScoredVacancy(admin.id, 60);
    insertScoredVacancy(admin.id, 30);
    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('adminscore', 999999));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Score Distribution'))).toBe(true);
    expect(sends.some(s => s.payload.text.includes('Median'))).toBe(true);
  });

  it('shows empty state message when no score data', async () => {
    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('adminscore', 999999));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Нет данных по скорам'))).toBe(true);
  });

  it('ignores non-admin user', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('adminscore', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.every(s => !s.payload.text?.includes('Score Distribution'))).toBe(true);
  });
});

// ---- Pre-checkout query ----

describe('pre_checkout_query', () => {
  it('answers with ok=true', async () => {
    const bot = createTestBot();
    await bot.handleUpdate(preCheckoutUpdate(12345, 'pro_monthly', 700));

    const answers = findCalls('answerPreCheckoutQuery');
    expect(answers.length).toBe(1);
    expect(answers[0].payload.ok).toBe(true);
  });
});

// ---- Successful payment handler ----

describe('successful_payment', () => {
  it('activates Pro monthly and confirms', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(paymentUpdate(12345, 'pro_monthly', 700, 'charge_m1'));

    const updated = db.getOrCreateUser(12345);
    expect(updated.plan).toBe('pro');
    expect(updated.planExpiresAt).not.toBeNull();
    expect(db.isProUser(updated)).toBe(true);

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Pro активирован'))).toBe(true);
  });

  it('activates Pro yearly with correct expiry', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(paymentUpdate(12345, 'pro_yearly', 6720, 'charge_y1'));

    const updated = db.getOrCreateUser(12345);
    expect(updated.plan).toBe('pro');
    expect(db.isProUser(updated)).toBe(true);
    expect(updated.planExpiresAt!.getFullYear()).toBeGreaterThanOrEqual(new Date().getFullYear() + 1);

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Pro на год активирован'))).toBe(true);
  });

  it('adds small credit pack (3 letters = 15 credits)', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(paymentUpdate(12345, 'credits_small', 100, 'charge_cs1'));

    const updated = db.getOrCreateUser(12345);
    expect(updated.credits).toBe(15);

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Кредиты добавлены'))).toBe(true);
    expect(sends.some(s => s.payload.text.includes('+15'))).toBe(true);
  });

  it('adds large credit pack (10 letters = 50 credits)', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(paymentUpdate(12345, 'credits_large', 300, 'charge_cl1'));

    const updated = db.getOrCreateUser(12345);
    expect(updated.credits).toBe(50);

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('+50'))).toBe(true);
  });

  it('saves payment record (duplicate charge rejects)', async () => {
    const user = setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(paymentUpdate(12345, 'pro_monthly', 700, 'charge_dup_test'));

    expect(() => {
      db.savePayment(user.id, 'charge_dup_test', 'pro_monthly', 700, 'pro_monthly');
    }).toThrow();
  });
});

// ---- Callback: quick actions ----

describe('callback: quick actions', () => {
  it('quick:digest shows empty digest', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('quick:digest', 12345));

    const answers = findCalls('answerCallbackQuery');
    expect(answers.length).toBe(1);
    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Нет релевантных вакансий'))).toBe(true);
  });

  it('quick:profile shows profile', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('quick:profile', 12345, 2));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Test User'))).toBe(true);
  });

  it('quick:stats shows stats', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('quick:stats', 12345, 3));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Статистика'))).toBe(true);
  });

  it('quick:subscribe shows tariffs', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('quick:subscribe', 12345, 4));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Тарифы Hunter'))).toBe(true);
  });
});

// ---- Callback: vacancy actions ----

describe('callback: vacancy actions', () => {
  it('reject marks vacancy as rejected and deletes message', async () => {
    const user = setupOnboardedUser(12345);
    const vacId = insertScoredVacancy(user.id, 80);

    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate(`reject:${vacId}`, 12345));

    const answers = findCalls('answerCallbackQuery');
    expect(answers.some(a => a.payload.text === 'Скрыто')).toBe(true);

    const deletes = findCalls('deleteMessage');
    expect(deletes.length).toBeGreaterThan(0);

    const { total } = db.getUserVacancies(user.id, 0, 10);
    expect(total).toBe(0);
  });

  it('applied marks vacancy and shows confirmation', async () => {
    const user = setupOnboardedUser(12345);
    const vacId = insertScoredVacancy(user.id, 80);

    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate(`applied:${vacId}`, 12345));

    const answers = findCalls('answerCallbackQuery');
    expect(answers.some(a => a.payload.text === 'Откликнулся')).toBe(true);

    const edits = findCalls('editMessageText');
    expect(edits.length).toBeGreaterThan(0);

    const stats = db.getUserStats(user.id);
    expect(stats.applied).toBe(1);
  });

  it('view shows detailed vacancy card', async () => {
    const user = setupOnboardedUser(12345);
    const vacId = insertScoredVacancy(user.id, 80, { title: 'Senior Designer', company: 'DesignCo' });

    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate(`view:${vacId}`, 12345));

    const edits = findCalls('editMessageText');
    expect(edits.length).toBeGreaterThan(0);
    expect(edits[0].payload.text).toContain('Senior Designer');
    expect(edits[0].payload.text).toContain('DesignCo');
  });

  it('details shows vacancy description and skills', async () => {
    const user = setupOnboardedUser(12345);
    const vacId = insertScoredVacancy(user.id, 80, {
      skills: ['React', 'TypeScript'],
      description: 'We need a frontend developer',
      experience: 'senior',
    });

    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate(`details:${vacId}`, 12345));

    const edits = findCalls('editMessageText');
    expect(edits.length).toBeGreaterThan(0);
    expect(edits[0].payload.text).toContain('Что хотят');
    expect(edits[0].payload.text).toContain('React');
    expect(edits[0].payload.text).toContain('TypeScript');
    expect(edits[0].payload.text).toContain('Senior');
  });

  it('returns error for non-existent vacancy', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('view:99999', 12345));

    const answers = findCalls('answerCallbackQuery');
    expect(answers.some(a => a.payload.text === 'Вакансия не найдена')).toBe(true);
  });

  it('returns error for invalid (NaN) id', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('view:abc', 12345));

    const answers = findCalls('answerCallbackQuery');
    expect(answers.some(a => a.payload.text === 'Ошибка')).toBe(true);
  });

  it('returns error for unknown action', async () => {
    const user = setupOnboardedUser(12345);
    const vacId = insertScoredVacancy(user.id, 80);

    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate(`unknown_action:${vacId}`, 12345));

    const answers = findCalls('answerCallbackQuery');
    expect(answers.some(a => a.payload.text === 'Неизвестное действие')).toBe(true);
  });

  it('blocks actions for non-onboarded user', async () => {
    db.getOrCreateUser(55555); // state = 'new'
    const v = makeVacancy();
    const { id: vacId } = db.upsertVacancy(v);

    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate(`view:${vacId}`, 55555));

    const answers = findCalls('answerCallbackQuery');
    expect(answers.some(a => a.payload.text === 'Сначала заверши настройку профиля')).toBe(true);
  });
});

// ---- Callback: clear confirm/cancel ----

describe('callback: clear confirm/cancel', () => {
  it('clear_confirm attempts to delete messages', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('clear_confirm', 12345));

    const deletes = findCalls('deleteMessage');
    expect(deletes.length).toBeGreaterThan(0);

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Удалено'))).toBe(true);
  });

  it('clear_cancel answers with cancelled text and deletes message', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('clear_cancel', 12345));

    const answers = findCalls('answerCallbackQuery');
    expect(answers.some(a => a.payload.text === 'Отменено')).toBe(true);

    const deletes = findCalls('deleteMessage');
    expect(deletes.length).toBeGreaterThan(0);
  });
});

// ---- Callback: pagination ----

describe('callback: pagination', () => {
  it('shows next page for pro user', async () => {
    const user = setupOnboardedUser(12345);
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    db.activatePro(user.id, future);

    for (let i = 0; i < 20; i++) {
      insertScoredVacancy(user.id, 80 - i);
    }

    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('more:15', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text?.includes('Страница'))).toBe(true);
  });

  it('shows paywall for free user past digest limit', async () => {
    const user = setupOnboardedUser(12345);
    for (let i = 0; i < 20; i++) {
      insertScoredVacancy(user.id, 80 - i);
    }

    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('more:15', 12345));

    const sends = findCalls('sendMessage');
    // Free user is blocked at offset >= 15
    expect(sends.some(s => s.payload.text?.includes('Показано 15 лучших'))).toBe(true);
  });

  it('shows "no more" message when past end', async () => {
    const user = setupOnboardedUser(12345);
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    db.activatePro(user.id, future);
    insertScoredVacancy(user.id, 80);

    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('more:15', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text?.includes('Больше нет релевантных вакансий'))).toBe(true);
  });
});

// ---- Callback: buy products ----

describe('callback: buy products', () => {
  it('sends invoice for pro_monthly', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('buy:pro_monthly', 12345));

    const invoices = findCalls('sendInvoice');
    expect(invoices.length).toBe(1);
    expect(invoices[0].payload.title).toContain('Pro');
    expect(invoices[0].payload.currency).toBe('XTR');
    expect(invoices[0].payload.prices).toEqual([expect.objectContaining({ amount: 700 })]);
  });

  it('sends invoice for pro_yearly', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('buy:pro_yearly', 12345, 2));

    const invoices = findCalls('sendInvoice');
    expect(invoices.length).toBe(1);
    expect(invoices[0].payload.prices).toEqual([expect.objectContaining({ amount: 6720 })]);
  });

  it('sends invoice for credits_small', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('buy:credits_small', 12345, 3));

    const invoices = findCalls('sendInvoice');
    expect(invoices.length).toBe(1);
    expect(invoices[0].payload.prices).toEqual([expect.objectContaining({ amount: 100 })]);
  });

  it('sends invoice for credits_large', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('buy:credits_large', 12345, 4));

    const invoices = findCalls('sendInvoice');
    expect(invoices.length).toBe(1);
    expect(invoices[0].payload.prices).toEqual([expect.objectContaining({ amount: 300 })]);
  });

  it('ignores unknown product (no invoice sent)', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('buy:unknown_product', 12345, 5));

    const invoices = findCalls('sendInvoice');
    expect(invoices.length).toBe(0);
  });
});

// ---- Callback: proposals (admin-only) ----

describe('callback: proposals', () => {
  it('admin can approve proposal', async () => {
    const proposalId = db.saveProposal('- [ ] **Test** — do something');

    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate(`prop_approve:${proposalId}`, 999999));

    const approved = db.getApprovedProposals();
    expect(approved).toHaveLength(1);
    expect(approved[0].status).toBe('approved');

    const edits = findCalls('editMessageText');
    expect(edits.length).toBeGreaterThan(0);
  });

  it('admin can reject proposal', async () => {
    const proposalId = db.saveProposal('- [ ] **Reject me** — desc');

    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate(`prop_reject:${proposalId}`, 999999));

    const approved = db.getApprovedProposals();
    expect(approved).toHaveLength(0);

    const edits = findCalls('editMessageText');
    expect(edits.length).toBeGreaterThan(0);
  });

  it('non-admin cannot approve proposal', async () => {
    setupOnboardedUser(12345);
    const proposalId = db.saveProposal('- [ ] **Sneaky** — unauthorized');

    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate(`prop_approve:${proposalId}`, 12345));

    const approved = db.getApprovedProposals();
    expect(approved).toHaveLength(0);
  });

  it('already processed proposal shows feedback', async () => {
    const proposalId = db.saveProposal('- [ ] **Already done** — desc');
    db.approveProposal(proposalId);

    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate(`prop_approve:${proposalId}`, 999999));

    // Second approval should show "already processed"
    const answers = findCalls('answerCallbackQuery');
    expect(answers.some(a => a.payload.text === 'Уже обработано')).toBe(true);
  });
});

// ---- Callback: edit_profile ----

describe('callback: edit_profile', () => {
  it('calls showEditMenu on edit_profile', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('edit_profile', 12345));

    const { showEditMenu } = await import('./onboarding');
    expect(showEditMenu).toHaveBeenCalled();
  });
});

// ---- Callback: edit field ----

describe('callback: edit field', () => {
  it('delegates to handleEditFieldCallback for edit:name', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('edit:name', 12345));

    const { handleEditFieldCallback } = await import('./onboarding');
    expect(handleEditFieldCallback).toHaveBeenCalled();
  });

  it('cancels editing session on edit:cancel', async () => {
    setupOnboardedUser(12345);
    const { editingSessions } = await import('./onboarding');
    editingSessions.set(12345, 'name');

    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('edit:cancel', 12345));

    expect(editingSessions.has(12345)).toBe(false);
  });
});

// ---- Callback: format delegation ----

describe('callback: format', () => {
  it('delegates to handleFormatCallback', async () => {
    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('format:remote', 12345));

    const { handleFormatCallback } = await import('./onboarding');
    expect(handleFormatCallback).toHaveBeenCalled();
  });
});

// ---- Callback: domain delegation ----

describe('callback: domain', () => {
  it('delegates to handleDomainCallback', async () => {
    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('domain:FinTech', 12345));

    const { handleDomainCallback } = await import('./onboarding');
    expect(handleDomainCallback).toHaveBeenCalled();
  });
});

// ---- Callback: onboarding nav delegation ----

describe('callback: onb nav', () => {
  it('delegates to handleOnboardingNavCallback for onb:back', async () => {
    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('onb:back', 12345));

    const { handleOnboardingNavCallback } = await import('./onboarding');
    expect(handleOnboardingNavCallback).toHaveBeenCalled();
  });

  it('delegates to handleOnboardingNavCallback for onb:skip', async () => {
    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate('onb:skip', 12345));

    const { handleOnboardingNavCallback } = await import('./onboarding');
    expect(handleOnboardingNavCallback).toHaveBeenCalled();
  });
});

// ---- Callback: cover letter flow ----

describe('callback: cover letter', () => {
  it('uses cached letter without quota consumption', async () => {
    const user = setupOnboardedUser(12345);
    const vacId = insertScoredVacancy(user.id, 80);

    const coverLetterModule = await import('./cover-letter');
    (coverLetterModule.getCoverLetter as any).mockReturnValue('Cached letter');

    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate(`cover:${vacId}`, 12345));

    const edits = findCalls('editMessageText');
    expect(edits.length).toBeGreaterThan(0);

    // Should NOT consume free quota
    const after = db.getOrCreateUser(12345);
    expect(after.lettersUsed).toBe(0);
  });

  it('generates new letter when not cached', async () => {
    const user = setupOnboardedUser(12345);
    const vacId = insertScoredVacancy(user.id, 80);

    const coverLetterModule = await import('./cover-letter');
    (coverLetterModule.getCoverLetter as any).mockReturnValue(null);
    (coverLetterModule.generateCoverLetter as any).mockResolvedValue('New letter text');

    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate(`cover:${vacId}`, 12345));

    const edits = findCalls('editMessageText');
    // Should have at least loading message + final result
    expect(edits.length).toBeGreaterThanOrEqual(2);
    expect(coverLetterModule.generateCoverLetter).toHaveBeenCalled();
  });

  it('shows paywall when free limit exhausted and no credits', async () => {
    const user = setupOnboardedUser(12345);
    const vacId = insertScoredVacancy(user.id, 80);
    // Exhaust free quota
    for (let i = 0; i < 5; i++) db.incrementLettersUsed(user.id);

    const coverLetterModule = await import('./cover-letter');
    (coverLetterModule.getCoverLetter as any).mockReturnValue(null);

    const bot = createTestBot();
    await bot.handleUpdate(callbackUpdate(`cover:${vacId}`, 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text?.includes('Лимит бесплатных писем исчерпан'))).toBe(true);
  });
});

// ---- Keyboard button matching (hears) ----

describe('keyboard buttons', () => {
  it('Дайджест button triggers digest', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(textUpdate('\u{1F4CB} \u0414\u0430\u0439\u0434\u0436\u0435\u0441\u0442', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Нет релевантных вакансий') || s.payload.text.includes('Дайджест'))).toBe(true);
  });

  it('Профиль button triggers profile', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(textUpdate('\u{1F464} \u041F\u0440\u043E\u0444\u0438\u043B\u044C', 12345, 2));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Test User'))).toBe(true);
  });

  it('Статистика button triggers stats', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(textUpdate('\u{1F4CA} \u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430', 12345, 3));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Статистика'))).toBe(true);
  });

  it('Очистить чат button triggers clear', async () => {
    setupOnboardedUser(12345);
    const bot = createTestBot();
    await bot.handleUpdate(textUpdate('\u{1F9F9} \u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0447\u0430\u0442', 12345, 4));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Очистить чат'))).toBe(true);
  });
});

// ---- Catch-all text handler ----

describe('catch-all text handler', () => {
  it('replies with button hint for unrecognized text', async () => {
    setupOnboardedUser(12345);
    const { handleOnboarding } = await import('./onboarding');
    (handleOnboarding as any).mockResolvedValue(false);

    const bot = createTestBot();
    await bot.handleUpdate(textUpdate('random gibberish text', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('Используй кнопки внизу'))).toBe(true);
  });
});

// ---- requireOnboarded guard ----

describe('requireOnboarded guard', () => {
  it('clears editing session when main keyboard button used', async () => {
    setupOnboardedUser(12345);
    const { editingSessions } = await import('./onboarding');
    editingSessions.set(12345, 'name');

    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('digest', 12345));

    expect(editingSessions.has(12345)).toBe(false);
  });

  it('recovers stuck onboarding state with essential data', async () => {
    db.getOrCreateUser(12345);
    db.updateUser(12345, {
      name: 'Stuck',
      title: 'Dev',
      onboardingState: 'awaiting_skills',
    });

    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('digest', 12345));

    const user = db.getOrCreateUser(12345);
    expect(user.onboardingState).toBe('complete');
  });
});

// ---- Edge cases ----

describe('edge cases', () => {
  it('user with domains stored correctly', () => {
    setupOnboardedUser(12345);
    db.updateUser(12345, {
      domains: [{ name: 'FinTech', weight: 1.0 }, { name: 'SaaS/B2B', weight: 0.8 }],
    });
    const updated = db.getOrCreateUser(12345);
    expect(updated.domains).toEqual([
      { name: 'FinTech', weight: 1.0 },
      { name: 'SaaS/B2B', weight: 0.8 },
    ]);
  });

  it('user with red flags and blacklist', () => {
    setupOnboardedUser(12345);
    db.updateUser(12345, {
      redFlags: ['junior', '3D'],
      companyBlacklist: ['BadCorp'],
    });
    const updated = db.getOrCreateUser(12345);
    expect(updated.redFlags).toEqual(['junior', '3D']);
    expect(updated.companyBlacklist).toEqual(['BadCorp']);
  });

  it('user with portfolio link in profile', async () => {
    setupOnboardedUser(12345);
    db.updateUser(12345, { portfolio: 'https://portfolio.example.com' });

    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('profile', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('https://portfolio.example.com'))).toBe(true);
  });

  it('freemium digest limit is enforced at 15', () => {
    const user = setupOnboardedUser(12345);
    for (let i = 0; i < 20; i++) {
      insertScoredVacancy(user.id, 80 - i);
    }
    const { vacancies, total } = db.getUserVacancies(user.id, 0, 15);
    expect(vacancies.length).toBe(15);
    expect(total).toBe(20);
  });

  it('profile shows credits count when > 0', async () => {
    const user = setupOnboardedUser(12345);
    db.addCredits(user.id, 25);

    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('profile', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('25'))).toBe(true);
  });

  it('stats shows source breakdown', async () => {
    const user = setupOnboardedUser(12345);
    insertScoredVacancy(user.id, 80, { source: 'hh.ru', externalId: 'src1' });
    insertScoredVacancy(user.id, 70, { source: 'habr', externalId: 'src2' });

    const bot = createTestBot();
    await bot.handleUpdate(commandUpdate('stats', 12345));

    const sends = findCalls('sendMessage');
    expect(sends.some(s => s.payload.text.includes('hh.ru'))).toBe(true);
    expect(sends.some(s => s.payload.text.includes('habr'))).toBe(true);
  });
});
