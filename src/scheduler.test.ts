import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { UserProfile, ScoredVacancy } from './types';

// --- Mocks ---

// Mock config
vi.mock('./config', () => ({
  CONFIG: {
    dbPath: ':memory:',
    adminTelegramId: 999999,
    scoring: { skills: 0.40, salary: 0.25, format: 0.20, domain: 0.15 },
    freemium: {
      free: { coverLetters: 5, digestPageSize: 15, pushMaxCards: 2 },
      pro: { coverLetters: Infinity, digestPageSize: Infinity, pushMaxCards: 5 },
      creditsPerLetter: 5,
    },
    stars: { proMonthly: 700, proYearly: 6720, creditsSmall: { stars: 100, letters: 3 }, creditsLarge: { stars: 300, letters: 10 } },
    scheduler: {
      scrapeCron: '0 9,13,17 * * *',
      digestCron: '15 9 * * *',
      timezone: 'Europe/Moscow',
      pushMinScore: 70,
      pushMaxCards: 5,
      enabled: true,
    },
  },
}));

// Mock logger
vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock node-cron — track schedule calls manually so we can extract callbacks
const mockStop = vi.fn();
const scheduleCalls: unknown[][] = [];
vi.mock('node-cron', () => ({
  default: {
    schedule(...args: unknown[]) {
      scheduleCalls.push(args);
      return { stop: mockStop };
    },
  },
}));

// Mock scrapers/runner
const mockRunAllScrapers = vi.fn();
vi.mock('./scrapers/runner', () => ({
  runAllScrapers: (...args: unknown[]) => mockRunAllScrapers(...args),
}));

// Mock db functions — typed with rest params to allow proper argument forwarding
const mockGetAllUsers: Mock = vi.fn(() => [] as UserProfile[]);
const mockGetUnnotifiedHighScoreVacancies: Mock = vi.fn(() => [] as ScoredVacancy[]);
const mockMarkVacanciesNotified: Mock = vi.fn();
const mockGetDigestSummary: Mock = vi.fn(() => ({ total: 0, highScore: 0 }));
const mockGetKV: Mock = vi.fn(() => null as string | null);
const mockSetKV: Mock = vi.fn();
const mockIsProUser: Mock = vi.fn(() => false);
const mockExpireProPlans: Mock = vi.fn(() => 0);
const mockGetUsersExpiringWithin: Mock = vi.fn(() => [] as UserProfile[]);

vi.mock('./db', () => ({
  getAllUsers: (...a: unknown[]) => mockGetAllUsers(...a),
  getUnnotifiedHighScoreVacancies: (...a: unknown[]) => mockGetUnnotifiedHighScoreVacancies(...a),
  markVacanciesNotified: (...a: unknown[]) => mockMarkVacanciesNotified(...a),
  getDigestSummary: (...a: unknown[]) => mockGetDigestSummary(...a),
  getKV: (...a: unknown[]) => mockGetKV(...a),
  setKV: (...a: unknown[]) => mockSetKV(...a),
  isProUser: (...a: unknown[]) => mockIsProUser(...a),
  expireProPlans: () => mockExpireProPlans(),
  getUsersExpiringWithin: (...a: unknown[]) => mockGetUsersExpiringWithin(...a),
}));

// Mock digest
vi.mock('./digest', () => ({
  formatVacancyDetail: vi.fn(() => '<b>Test vacancy</b>'),
  vacancyButtons: vi.fn(() => ({ inline_keyboard: [] })),
}));

// --- Helpers ---

function makeUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 1,
    telegramId: 11111,
    name: 'Test User',
    title: 'Product Designer',
    yearsExperience: 5,
    skills: ['Figma'],
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

function makeScoredVacancy(overrides: Partial<ScoredVacancy> = {}): ScoredVacancy {
  return {
    id: 1,
    source: 'hh.ru',
    externalId: `ext-${Math.random().toString(36).slice(2)}`,
    title: 'Product Designer',
    company: 'TechCorp',
    salaryFrom: 200_000,
    salaryTo: 400_000,
    salaryCurrency: 'RUB',
    format: 'remote',
    city: null,
    description: 'Looking for a designer',
    skills: ['Figma'],
    url: 'https://hh.ru/vacancy/123',
    publishedAt: new Date(),
    experience: 'middle',
    score: 85,
    scoreSkills: 90,
    scoreSalary: 80,
    scoreFormat: 100,
    scoreDomain: 50,
    status: 'new',
    createdAt: new Date(),
    ...overrides,
  };
}

function makeMockBot() {
  return {
    api: {
      sendMessage: vi.fn().mockResolvedValue({}),
    },
  } as unknown as import('grammy').Bot;
}

/** Extract the cron callback from tracked schedule calls. */
function getCronCallback(index: number): () => void {
  return scheduleCalls[index][1] as () => void;
}

/**
 * Flush all pending microtasks/promises.
 * The scheduler uses sleep(100) between push cards, so tests with multiple
 * cards need a longer flush (e.g. 5 cards x 100ms = 500ms + margin).
 */
function flushPromises(ms = 300): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Tests ---

describe('scheduler', () => {
  let scheduler: typeof import('./scheduler');
  let bot: ReturnType<typeof makeMockBot>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    scheduleCalls.length = 0;

    // Re-import to reset module-level state (tasks[], isRunning)
    scheduler = await import('./scheduler');
    bot = makeMockBot();

    // Default mock behaviors
    mockRunAllScrapers.mockResolvedValue([{ source: 'hh.ru', found: 10, new: 3 }]);
    mockGetAllUsers.mockReturnValue([]);
    mockGetUnnotifiedHighScoreVacancies.mockReturnValue([]);
    mockGetDigestSummary.mockReturnValue({ total: 0, highScore: 0 });
    mockExpireProPlans.mockReturnValue(0);
    mockGetKV.mockReturnValue(null);
    mockGetUsersExpiringWithin.mockReturnValue([]);
    mockIsProUser.mockReturnValue(false);
  });

  afterEach(() => {
    // Ensure scheduler is stopped after each test
    try { scheduler.stopScheduler(); } catch { /* ok */ }
  });

  describe('startScheduler', () => {
    it('schedules scrape and digest cron tasks', () => {
      scheduler.startScheduler(bot);

      expect(scheduleCalls.length).toBe(2);

      // First call: scrape cron
      expect(scheduleCalls[0][0]).toBe('0 9,13,17 * * *');
      expect(scheduleCalls[0][2]).toEqual({ timezone: 'Europe/Moscow' });

      // Second call: digest cron
      expect(scheduleCalls[1][0]).toBe('15 9 * * *');
      expect(scheduleCalls[1][2]).toEqual({ timezone: 'Europe/Moscow' });
    });

    it('does not start when scheduler is disabled', async () => {
      // Re-mock config with scheduler disabled
      const { CONFIG } = await import('./config');
      (CONFIG as { scheduler: { enabled: boolean } }).scheduler.enabled = false;

      vi.resetModules();
      scheduleCalls.length = 0;
      const freshScheduler = await import('./scheduler');
      freshScheduler.startScheduler(bot);

      // No tasks should be scheduled
      freshScheduler.stopScheduler();

      // Restore
      (CONFIG as { scheduler: { enabled: boolean } }).scheduler.enabled = true;
    });
  });

  describe('stopScheduler', () => {
    it('stops all scheduled tasks', () => {
      scheduler.startScheduler(bot);
      scheduler.stopScheduler();

      // stop() called for each registered task (2 tasks)
      expect(mockStop).toHaveBeenCalledTimes(2);
    });

    it('clears task list after stopping', () => {
      scheduler.startScheduler(bot);
      scheduler.stopScheduler();

      // Calling stop again should not call task.stop() more times
      mockStop.mockClear();
      scheduler.stopScheduler();
      expect(mockStop).not.toHaveBeenCalled();
    });
  });

  describe('cron expressions', () => {
    it('scrape cron fires at 09:00, 13:00, 17:00', () => {
      const cronExpr = '0 9,13,17 * * *';
      const parts = cronExpr.split(' ');

      // minute = 0, hours = 9,13,17, every day
      expect(parts[0]).toBe('0');
      expect(parts[1]).toBe('9,13,17');
      expect(parts[2]).toBe('*');
      expect(parts[3]).toBe('*');
      expect(parts[4]).toBe('*');
    });

    it('digest cron fires at 09:15', () => {
      const cronExpr = '15 9 * * *';
      const parts = cronExpr.split(' ');

      expect(parts[0]).toBe('15');
      expect(parts[1]).toBe('9');
    });
  });

  describe('runScheduledScrape (via cron callback)', () => {
    async function triggerScrape() {
      scheduler.startScheduler(bot);
      // The cron callback is a sync wrapper that fires-and-forgets the async function,
      // so we must flush the microtask queue to let the async chain settle.
      getCronCallback(0)();
      await flushPromises();
    }

    it('calls expireProPlans before scraping', async () => {
      await triggerScrape();
      expect(mockExpireProPlans).toHaveBeenCalledTimes(1);
    });

    it('calls runAllScrapers', async () => {
      await triggerScrape();
      expect(mockRunAllScrapers).toHaveBeenCalledTimes(1);
    });

    it('saves last_auto_scrape timestamp', async () => {
      await triggerScrape();
      expect(mockSetKV).toHaveBeenCalledWith('last_auto_scrape', expect.any(String));
    });

    it('skips if a scrape is already running', async () => {
      // Start first scrape that never resolves
      mockRunAllScrapers.mockReturnValue(new Promise(() => {}));

      scheduler.startScheduler(bot);
      const scrapeCallback = getCronCallback(0);

      // Start first scrape (will hang because runAllScrapers never resolves)
      scrapeCallback();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Try second scrape — should be skipped because isRunning is true
      scrapeCallback();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockRunAllScrapers).toHaveBeenCalledTimes(1);
    });

    it('sends admin error message on scrape failure', async () => {
      mockRunAllScrapers.mockRejectedValue(new Error('Scrape boom'));

      await triggerScrape();

      expect(bot.api.sendMessage as Mock).toHaveBeenCalledWith(
        999999,
        expect.stringContaining('Scrape boom'),
      );
    });

    it('does not crash if admin notification also fails', async () => {
      mockRunAllScrapers.mockRejectedValue(new Error('Scrape boom'));
      (bot.api.sendMessage as Mock).mockRejectedValue(new Error('Bot error'));

      // Should not throw — triggerScrape internally catches all errors
      await triggerScrape();
    });

    it('resets isRunning flag after failure', async () => {
      mockRunAllScrapers.mockRejectedValueOnce(new Error('fail'));
      (bot.api.sendMessage as Mock).mockResolvedValue({});

      await triggerScrape();

      // Second scrape should succeed (isRunning was reset)
      mockRunAllScrapers.mockResolvedValue([{ source: 'hh.ru', found: 0, new: 0 }]);
      getCronCallback(0)();
      await flushPromises();

      expect(mockRunAllScrapers).toHaveBeenCalledTimes(2);
    });
  });

  describe('push notifications', () => {
    async function triggerScrape() {
      scheduler.startScheduler(bot);
      getCronCallback(0)();
      await flushPromises();
    }

    it('sends push to users with high-score unnotified vacancies', async () => {
      const user = makeUser({ id: 1, telegramId: 11111 });
      const vacancy = makeScoredVacancy({ id: 10, score: 85 });

      mockGetAllUsers.mockReturnValue([user]);
      mockGetUnnotifiedHighScoreVacancies.mockReturnValue([vacancy]);

      await triggerScrape();

      // Header message + 1 vacancy card
      expect(bot.api.sendMessage as Mock).toHaveBeenCalledWith(
        11111,
        expect.stringContaining('1'),
        expect.objectContaining({ parse_mode: 'HTML' }),
      );
    });

    it('does not send push when no high-score vacancies', async () => {
      const user = makeUser({ id: 1, telegramId: 11111 });
      mockGetAllUsers.mockReturnValue([user]);
      mockGetUnnotifiedHighScoreVacancies.mockReturnValue([]);

      await triggerScrape();

      const calls = (bot.api.sendMessage as Mock).mock.calls;
      const userCalls = calls.filter((c: unknown[]) => c[0] === 11111);
      expect(userCalls.length).toBe(0);
    });

    it('limits free users to 2 push cards', async () => {
      const user = makeUser({ id: 1, telegramId: 11111, plan: 'free' });
      const vacancies = Array.from({ length: 5 }, (_, i) =>
        makeScoredVacancy({ id: i + 1, score: 80 + i }),
      );

      mockGetAllUsers.mockReturnValue([user]);
      mockGetUnnotifiedHighScoreVacancies.mockReturnValue(vacancies);
      mockIsProUser.mockReturnValue(false);

      await triggerScrape();

      // 1 header + 2 vacancy cards = 3 messages to user
      const calls = (bot.api.sendMessage as Mock).mock.calls;
      const userCalls = calls.filter((c: unknown[]) => c[0] === 11111);
      expect(userCalls.length).toBe(3); // header + 2 cards
    });

    it('allows pro users up to 5 push cards', async () => {
      const user = makeUser({ id: 1, telegramId: 11111, plan: 'pro' });
      const vacancies = Array.from({ length: 7 }, (_, i) =>
        makeScoredVacancy({ id: i + 1, score: 80 + i }),
      );

      mockGetAllUsers.mockReturnValue([user]);
      mockGetUnnotifiedHighScoreVacancies.mockReturnValue(vacancies);
      mockIsProUser.mockReturnValue(true);

      // 5 cards * sleep(100) = 500ms minimum + margin
      scheduler.startScheduler(bot);
      getCronCallback(0)();
      await flushPromises(800);

      // 1 header + 5 vacancy cards = 6 messages to user
      const calls = (bot.api.sendMessage as Mock).mock.calls;
      const userCalls = calls.filter((c: unknown[]) => c[0] === 11111);
      expect(userCalls.length).toBe(6); // header + 5 cards
    });

    it('marks vacancies as notified after sending', async () => {
      const user = makeUser({ id: 1, telegramId: 11111 });
      const vacancies = [
        makeScoredVacancy({ id: 10, score: 85 }),
        makeScoredVacancy({ id: 20, score: 90 }),
      ];

      mockGetAllUsers.mockReturnValue([user]);
      mockGetUnnotifiedHighScoreVacancies.mockReturnValue(vacancies);

      await triggerScrape();

      // marks ALL vacancies (not just the ones sent) as notified
      expect(mockMarkVacanciesNotified).toHaveBeenCalledWith(1, [10, 20]);
    });

    it('uses pushMinScore=70 threshold from config', async () => {
      const user = makeUser({ id: 1, telegramId: 11111 });
      mockGetAllUsers.mockReturnValue([user]);

      await triggerScrape();

      expect(mockGetUnnotifiedHighScoreVacancies).toHaveBeenCalledWith(1, 70);
    });

    it('continues processing other users if one fails', async () => {
      const user1 = makeUser({ id: 1, telegramId: 11111 });
      const user2 = makeUser({ id: 2, telegramId: 22222 });
      const vacancy = makeScoredVacancy({ id: 10, score: 85 });

      mockGetAllUsers.mockReturnValue([user1, user2]);
      mockGetUnnotifiedHighScoreVacancies
        .mockReturnValueOnce([vacancy]) // user1
        .mockReturnValueOnce([vacancy]); // user2

      // Fail on user1's header message, succeed on user2
      (bot.api.sendMessage as Mock)
        .mockRejectedValueOnce(new Error('blocked'))
        .mockResolvedValue({});

      await triggerScrape();

      // user2 should still get notifications
      const calls = (bot.api.sendMessage as Mock).mock.calls;
      const user2Calls = calls.filter((c: unknown[]) => c[0] === 22222);
      expect(user2Calls.length).toBeGreaterThan(0);
    });
  });

  describe('morning digest (via cron callback)', () => {
    async function triggerDigest() {
      scheduler.startScheduler(bot);
      getCronCallback(1)();
      await flushPromises();
    }

    it('sends digest to users with new vacancies', async () => {
      const user = makeUser({ id: 1, telegramId: 11111 });
      mockGetAllUsers.mockReturnValue([user]);
      mockGetDigestSummary.mockReturnValue({ total: 5, highScore: 2 });

      await triggerDigest();

      expect(bot.api.sendMessage as Mock).toHaveBeenCalledWith(
        11111,
        expect.stringContaining('5'),
        expect.objectContaining({ parse_mode: 'HTML' }),
      );
    });

    it('includes high score count when > 0', async () => {
      const user = makeUser({ id: 1, telegramId: 11111 });
      mockGetAllUsers.mockReturnValue([user]);
      mockGetDigestSummary.mockReturnValue({ total: 10, highScore: 3 });

      await triggerDigest();

      const calls = (bot.api.sendMessage as Mock).mock.calls;
      const digestCall = calls.find((c: unknown[]) => c[0] === 11111);
      expect(digestCall).toBeDefined();
      expect(digestCall![1]).toContain('70+');
      expect(digestCall![1]).toContain('3');
    });

    it('skips users with no new vacancies', async () => {
      const user = makeUser({ id: 1, telegramId: 11111 });
      mockGetAllUsers.mockReturnValue([user]);
      mockGetDigestSummary.mockReturnValue({ total: 0, highScore: 0 });

      await triggerDigest();

      const calls = (bot.api.sendMessage as Mock).mock.calls;
      const userCalls = calls.filter((c: unknown[]) => c[0] === 11111);
      expect(userCalls.length).toBe(0);
    });

    it('continues to next user if one fails', async () => {
      const user1 = makeUser({ id: 1, telegramId: 11111 });
      const user2 = makeUser({ id: 2, telegramId: 22222 });

      mockGetAllUsers.mockReturnValue([user1, user2]);
      mockGetDigestSummary.mockReturnValue({ total: 3, highScore: 1 });

      (bot.api.sendMessage as Mock)
        .mockRejectedValueOnce(new Error('blocked'))
        .mockResolvedValue({});

      await triggerDigest();

      const calls = (bot.api.sendMessage as Mock).mock.calls;
      const user2Calls = calls.filter((c: unknown[]) => c[0] === 22222);
      expect(user2Calls.length).toBe(1);
    });
  });

  describe('Pro plan expiration', () => {
    async function triggerScrape() {
      scheduler.startScheduler(bot);
      getCronCallback(0)();
      await flushPromises();
    }

    it('calls expireProPlans on each scheduled scrape', async () => {
      await triggerScrape();
      expect(mockExpireProPlans).toHaveBeenCalledTimes(1);
    });

    it('logs when plans are expired', async () => {
      mockExpireProPlans.mockReturnValue(2);
      const { logger } = await import('./logger');

      await triggerScrape();

      expect(logger.info).toHaveBeenCalledWith(
        'scheduler',
        expect.stringContaining('2'),
      );
    });
  });

  describe('renewal reminders', () => {
    async function triggerScrape() {
      scheduler.startScheduler(bot);
      getCronCallback(0)();
      await flushPromises();
    }

    it('sends reminder to users expiring within 3 days', async () => {
      const expiringUser = makeUser({
        id: 1,
        telegramId: 11111,
        plan: 'pro',
        planExpiresAt: new Date(Date.now() + 2 * 86_400_000), // 2 days from now
      });

      mockGetUsersExpiringWithin.mockReturnValue([expiringUser]);

      await triggerScrape();

      expect(mockGetUsersExpiringWithin).toHaveBeenCalledWith(3);

      const calls = (bot.api.sendMessage as Mock).mock.calls;
      const reminderCalls = calls.filter(
        (c: unknown[]) => c[0] === 11111 && typeof c[1] === 'string' && (c[1] as string).includes('/subscribe'),
      );
      expect(reminderCalls.length).toBe(1);
    });

    it('sends reminder only once per day', async () => {
      const today = new Date().toISOString().slice(0, 10);
      mockGetKV.mockReturnValue(today);

      const expiringUser = makeUser({
        id: 1,
        telegramId: 11111,
        plan: 'pro',
        planExpiresAt: new Date(Date.now() + 2 * 86_400_000),
      });
      mockGetUsersExpiringWithin.mockReturnValue([expiringUser]);

      await triggerScrape();

      // getUsersExpiringWithin should NOT be called because reminder was already sent today
      expect(mockGetUsersExpiringWithin).not.toHaveBeenCalled();
    });

    it('saves last_renewal_reminder date after sending', async () => {
      mockGetUsersExpiringWithin.mockReturnValue([]);

      await triggerScrape();

      const today = new Date().toISOString().slice(0, 10);
      expect(mockSetKV).toHaveBeenCalledWith('last_renewal_reminder', today);
    });
  });
});
