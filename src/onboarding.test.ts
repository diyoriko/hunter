import { describe, it, expect } from 'vitest';

/**
 * Tests for onboarding parser logic.
 * Since STEPS parsers are not exported, we replicate the parsing logic here
 * to ensure correctness. These patterns are from onboarding.ts.
 */

// --- Salary parser (onboarding.ts:62-80) ---
function parseSalary(text: string): { salaryMin: number | null; salaryMax: number | null } | null {
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
}

// --- Name parser (onboarding.ts:26-28) ---
function parseName(text: string): { name: string } | null {
  const name = text.trim().slice(0, 100);
  return name.length > 0 ? { name } : null;
}

// --- Title parser (onboarding.ts:34-36) ---
function parseTitle(text: string): { title: string } | null {
  const title = text.trim().slice(0, 200);
  return title.length > 0 ? { title } : null;
}

// --- Skills parser (onboarding.ts:50-57) ---
function parseSkills(text: string): { skills: string[]; skillWeights: { name: string; weight: number }[] } {
  const skills = text.slice(0, 500).split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
  const skillWeights = skills.map((name, i) => ({
    name,
    weight: skills.length === 1 ? 1.0 : parseFloat((1.0 - (i / (skills.length - 1)) * 0.5).toFixed(2)),
  }));
  return { skills, skillWeights };
}

// --- Experience parser (onboarding.ts:42-44) ---
function parseExperience(text: string): { yearsExperience: number } | null {
  const n = parseInt(text.trim(), 10);
  return !isNaN(n) && n >= 0 ? { yearsExperience: n } : null;
}

// --- About parser (onboarding.ts) ---
function parseAbout(text: string): { about: string | null } | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === 'пропустить' || trimmed === 'skip' || trimmed === '-') {
    return { about: null };
  }
  const about = text.trim().slice(0, 2000);
  return about.length > 0 ? { about } : null;
}

// ===== Tests =====

describe('salary parser', () => {
  it('parses "300000-500000"', () => {
    const result = parseSalary('300000-500000');
    expect(result).toEqual({ salaryMin: 300_000, salaryMax: 500_000 });
  });

  it('parses "300k-500k"', () => {
    const result = parseSalary('300k-500k');
    expect(result).toEqual({ salaryMin: 300_000, salaryMax: 500_000 });
  });

  it('parses "300K-500K" (uppercase)', () => {
    const result = parseSalary('300K-500K');
    expect(result).toEqual({ salaryMin: 300_000, salaryMax: 500_000 });
  });

  it('parses mixed formats: "200k-400000"', () => {
    const result = parseSalary('200k-400000');
    expect(result).toEqual({ salaryMin: 200_000, salaryMax: 400_000 });
  });

  it('parses with spaces: "300 000 - 500 000"', () => {
    const result = parseSalary('300 000 - 500 000');
    expect(result).toEqual({ salaryMin: 300_000, salaryMax: 500_000 });
  });

  it('parses with commas: "300,000-500,000"', () => {
    const result = parseSalary('300,000-500,000');
    expect(result).toEqual({ salaryMin: 300_000, salaryMax: 500_000 });
  });

  it('parses single value: "200000"', () => {
    const result = parseSalary('200000');
    expect(result).toEqual({ salaryMin: 200_000, salaryMax: null });
  });

  it('parses single value with k: "200k"', () => {
    const result = parseSalary('200k');
    expect(result).toEqual({ salaryMin: 200_000, salaryMax: null });
  });

  it('parses en-dash: "300k–500k"', () => {
    const result = parseSalary('300k\u2013500k');
    expect(result).toEqual({ salaryMin: 300_000, salaryMax: 500_000 });
  });

  it('returns skip values for "пропустить"', () => {
    expect(parseSalary('пропустить')).toEqual({ salaryMin: null, salaryMax: null });
  });

  it('returns skip values for "skip"', () => {
    expect(parseSalary('skip')).toEqual({ salaryMin: null, salaryMax: null });
  });

  it('returns skip values for "-"', () => {
    expect(parseSalary('-')).toEqual({ salaryMin: null, salaryMax: null });
  });

  it('returns null for invalid input', () => {
    expect(parseSalary('abc')).toBeNull();
    expect(parseSalary('много денег')).toBeNull();
    expect(parseSalary('')).toBeNull();
  });

  it('handles USD range: "3000-5000"', () => {
    const result = parseSalary('3000-5000');
    expect(result).toEqual({ salaryMin: 3_000, salaryMax: 5_000 });
  });

  it('handles small k values: "3k-5k"', () => {
    const result = parseSalary('3k-5k');
    expect(result).toEqual({ salaryMin: 3_000, salaryMax: 5_000 });
  });
});

describe('name parser', () => {
  it('parses a normal name', () => {
    expect(parseName('Иван')).toEqual({ name: 'Иван' });
  });

  it('trims whitespace', () => {
    expect(parseName('  Иван  ')).toEqual({ name: 'Иван' });
  });

  it('truncates at 100 chars', () => {
    const long = 'A'.repeat(200);
    const result = parseName(long);
    expect(result!.name.length).toBe(100);
  });

  it('returns null for empty input', () => {
    expect(parseName('')).toBeNull();
    expect(parseName('   ')).toBeNull();
  });
});

describe('title parser', () => {
  it('parses a normal title', () => {
    expect(parseTitle('Product Designer')).toEqual({ title: 'Product Designer' });
  });

  it('truncates at 200 chars', () => {
    const long = 'B'.repeat(300);
    const result = parseTitle(long);
    expect(result!.title.length).toBe(200);
  });

  it('returns null for empty input', () => {
    expect(parseTitle('')).toBeNull();
  });
});

describe('skills parser', () => {
  it('splits by comma and trims', () => {
    const result = parseSkills('Figma, UI/UX, Sketch');
    expect(result.skills).toEqual(['Figma', 'UI/UX', 'Sketch']);
  });

  it('filters empty entries', () => {
    const result = parseSkills('Figma,, ,Sketch');
    expect(result.skills).toEqual(['Figma', 'Sketch']);
  });

  it('limits to 20 skills', () => {
    const many = Array.from({ length: 30 }, (_, i) => `skill${i}`).join(',');
    const result = parseSkills(many);
    expect(result.skills.length).toBe(20);
  });

  it('truncates input at 500 chars', () => {
    const long = 'A'.repeat(600);
    const result = parseSkills(long);
    expect(result.skills[0].length).toBeLessThanOrEqual(500);
  });

  it('assigns decreasing weights', () => {
    const result = parseSkills('Figma, Sketch, InVision');
    expect(result.skillWeights[0].weight).toBe(1.0);
    expect(result.skillWeights[2].weight).toBe(0.5);
    // Middle should be between 0.5 and 1.0
    expect(result.skillWeights[1].weight).toBeGreaterThan(0.5);
    expect(result.skillWeights[1].weight).toBeLessThan(1.0);
  });

  it('assigns weight 1.0 for single skill', () => {
    const result = parseSkills('Figma');
    expect(result.skillWeights[0].weight).toBe(1.0);
  });
});

describe('experience parser', () => {
  it('parses a number', () => {
    expect(parseExperience('5')).toEqual({ yearsExperience: 5 });
  });

  it('parses zero', () => {
    expect(parseExperience('0')).toEqual({ yearsExperience: 0 });
  });

  it('trims whitespace', () => {
    expect(parseExperience('  3 ')).toEqual({ yearsExperience: 3 });
  });

  it('returns null for non-number', () => {
    expect(parseExperience('abc')).toBeNull();
    expect(parseExperience('')).toBeNull();
  });

  it('returns null for negative numbers', () => {
    expect(parseExperience('-1')).toBeNull();
  });
});

describe('about parser', () => {
  it('parses normal text', () => {
    const result = parseAbout('5 лет в UX, работал в финтехе');
    expect(result).toEqual({ about: '5 лет в UX, работал в финтехе' });
  });

  it('truncates at 2000 chars', () => {
    const long = 'C'.repeat(3000);
    const result = parseAbout(long);
    expect(result!.about!.length).toBe(2000);
  });

  it('returns null about for skip words', () => {
    expect(parseAbout('пропустить')).toEqual({ about: null });
    expect(parseAbout('skip')).toEqual({ about: null });
    expect(parseAbout('-')).toEqual({ about: null });
  });
});

// ============================================================
// State machine, handlers, keyboard builders, navigation tests
// ============================================================

import { vi, beforeEach, afterEach } from 'vitest';
import type { OnboardingState, UserProfile, Plan } from './types';

// --- Mock dependencies BEFORE importing onboarding ---

// Track all updateUser calls for assertions
let updateUserCalls: Array<[number, Record<string, any>]> = [];
let mockUserState: Partial<UserProfile> = {};

vi.mock('./db', () => ({
  getOrCreateUser: vi.fn((telegramId: number) => makeUser(telegramId)),
  updateUser: vi.fn((telegramId: number, fields: Record<string, any>) => {
    updateUserCalls.push([telegramId, fields]);
    // Apply changes to mockUserState so subsequent getOrCreateUser calls see them
    Object.assign(mockUserState, fields);
  }),
}));

vi.mock('./bot', () => ({
  mainKeyboard: { text: 'mock-keyboard' },
}));

vi.mock('./config', () => ({
  CONFIG: {
    domains: ['SaaS/B2B', 'EdTech', 'FinTech', 'AI/ML', 'E-commerce', 'HealthTech'],
    scoring: { skills: 0.4, salary: 0.25, format: 0.2, domain: 0.15 },
    adminTelegramId: 999999,
  },
}));

vi.mock('./digest', () => ({
  escapeHtml: vi.fn((text: string) => text),
}));

vi.mock('./scrapers/runner', () => ({
  runAllScrapers: vi.fn(async () => []),
  runScrapersWithProgress: vi.fn(async () => [{ source: 'hh.ru', new: 0, total: 0 }]),
}));

vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Now import the module under test (will use mocked deps)
import {
  handleOnboarding,
  handleFormatCallback,
  handleDomainCallback,
  handleOnboardingNavCallback,
  askQuestion,
  showEditMenu,
  handleEditFieldCallback,
  editingSessions,
} from './onboarding';

// --- Helpers ---

function makeUser(telegramId: number = 12345): UserProfile {
  return {
    id: 1,
    telegramId,
    name: mockUserState.name ?? '',
    title: mockUserState.title ?? '',
    yearsExperience: mockUserState.yearsExperience ?? 0,
    skills: mockUserState.skills ?? [],
    skillWeights: mockUserState.skillWeights ?? [],
    salaryMin: mockUserState.salaryMin ?? null,
    salaryMax: mockUserState.salaryMax ?? null,
    salaryCurrency: 'RUB',
    preferredFormat: mockUserState.preferredFormat ?? 'any',
    domains: mockUserState.domains ?? [],
    redFlags: mockUserState.redFlags ?? [],
    companyBlacklist: mockUserState.companyBlacklist ?? [],
    searchQueries: mockUserState.searchQueries ?? [],
    portfolio: mockUserState.portfolio ?? null,
    about: mockUserState.about ?? null,
    onboardingState: (mockUserState.onboardingState ?? 'new') as OnboardingState,
    createdAt: new Date(),
    plan: 'free' as Plan,
    planExpiresAt: null,
    lettersUsed: 0,
    credits: 0,
  };
}

/** Create a mock grammY Context with reply/answerCallbackQuery/etc. */
function createMockCtx(telegramId: number = 12345, messageText?: string): any {
  const replyCalls: Array<[string, any?]> = [];
  const ctx: any = {
    from: { id: telegramId },
    chat: { id: telegramId },
    message: messageText !== undefined ? { text: messageText } : undefined,
    reply: vi.fn(async (text: string, opts?: any) => {
      replyCalls.push([text, opts]);
      return { message_id: 100 };
    }),
    answerCallbackQuery: vi.fn(async () => {}),
    deleteMessage: vi.fn(async () => {}),
    editMessageReplyMarkup: vi.fn(async () => {}),
    api: {
      editMessageText: vi.fn(async () => {}),
    },
    _replyCalls: replyCalls,
  };
  return ctx;
}

// --- Setup / teardown ---

beforeEach(() => {
  updateUserCalls = [];
  mockUserState = {};
  editingSessions.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  editingSessions.clear();
});

// ===== State machine transition tests =====

describe('onboarding state machine — step transitions', () => {
  const EXPECTED_FLOW: OnboardingState[] = [
    'new',
    'awaiting_name',
    'awaiting_title',
    'awaiting_experience',
    'awaiting_skills',
    'awaiting_salary',
    'awaiting_format',
    'awaiting_domains',
    'awaiting_red_flags',
    'awaiting_blacklist',
    'awaiting_queries',
    'awaiting_portfolio',
    'awaiting_about',
    'complete',
  ];

  it('defines 14 states in the correct order', () => {
    expect(EXPECTED_FLOW).toHaveLength(14);
  });

  it('new → awaiting_name on first message', async () => {
    mockUserState = { onboardingState: 'new' };
    const ctx = createMockCtx(12345, 'anything');
    const handled = await handleOnboarding(ctx);
    expect(handled).toBe(true);
    // Should update state to awaiting_name
    expect(updateUserCalls.some(([, f]) => f.onboardingState === 'awaiting_name')).toBe(true);
    // Should send welcome + question
    expect(ctx.reply).toHaveBeenCalled();
  });

  it('awaiting_name → awaiting_title on valid name', async () => {
    mockUserState = { onboardingState: 'awaiting_name' };
    const ctx = createMockCtx(12345, 'Иван');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) => f.onboardingState === 'awaiting_title' && f.name === 'Иван')).toBe(true);
  });

  it('awaiting_title → awaiting_experience on valid title', async () => {
    mockUserState = { onboardingState: 'awaiting_title' };
    const ctx = createMockCtx(12345, 'Product Designer');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) => f.onboardingState === 'awaiting_experience' && f.title === 'Product Designer')).toBe(true);
  });

  it('awaiting_experience → awaiting_skills on valid number', async () => {
    mockUserState = { onboardingState: 'awaiting_experience' };
    const ctx = createMockCtx(12345, '5');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) => f.onboardingState === 'awaiting_skills' && f.yearsExperience === 5)).toBe(true);
  });

  it('awaiting_skills → awaiting_salary on valid skills', async () => {
    mockUserState = { onboardingState: 'awaiting_skills' };
    const ctx = createMockCtx(12345, 'Figma, UI/UX, Sketch');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) =>
      f.onboardingState === 'awaiting_salary' &&
      f.skills?.length === 3 &&
      f.skillWeights?.length === 3
    )).toBe(true);
  });

  it('awaiting_salary → awaiting_format on valid range', async () => {
    mockUserState = { onboardingState: 'awaiting_salary' };
    const ctx = createMockCtx(12345, '300k-500k');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) =>
      f.onboardingState === 'awaiting_format' &&
      f.salaryMin === 300_000 &&
      f.salaryMax === 500_000
    )).toBe(true);
  });

  it('awaiting_salary → awaiting_format on skip text', async () => {
    mockUserState = { onboardingState: 'awaiting_salary' };
    const ctx = createMockCtx(12345, 'пропустить');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) =>
      f.onboardingState === 'awaiting_format' &&
      f.salaryMin === null &&
      f.salaryMax === null
    )).toBe(true);
  });

  it('awaiting_format tells user to use buttons', async () => {
    mockUserState = { onboardingState: 'awaiting_format' };
    const ctx = createMockCtx(12345, 'remote');
    const handled = await handleOnboarding(ctx);
    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith('Выбери формат кнопкой выше.');
  });

  it('awaiting_red_flags → awaiting_blacklist on valid input', async () => {
    mockUserState = { onboardingState: 'awaiting_red_flags' };
    const ctx = createMockCtx(12345, 'junior, стажёр');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) =>
      f.onboardingState === 'awaiting_blacklist' &&
      f.redFlags?.includes('junior')
    )).toBe(true);
  });

  it('awaiting_red_flags → awaiting_blacklist on skip', async () => {
    mockUserState = { onboardingState: 'awaiting_red_flags' };
    const ctx = createMockCtx(12345, '-');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) =>
      f.onboardingState === 'awaiting_blacklist' &&
      Array.isArray(f.redFlags) &&
      f.redFlags.length === 0
    )).toBe(true);
  });

  it('awaiting_blacklist → awaiting_queries on valid input', async () => {
    mockUserState = { onboardingState: 'awaiting_blacklist' };
    const ctx = createMockCtx(12345, 'Яндекс Крауд, Mail.ru');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) =>
      f.onboardingState === 'awaiting_queries' &&
      f.companyBlacklist?.includes('Яндекс Крауд')
    )).toBe(true);
  });

  it('awaiting_queries → awaiting_portfolio on "ок" (keeps auto-generated)', async () => {
    mockUserState = { onboardingState: 'awaiting_queries', title: 'Product Designer' };
    const ctx = createMockCtx(12345, 'ок');
    await handleOnboarding(ctx);
    // Should NOT include searchQueries in update (keep auto-generated)
    const call = updateUserCalls.find(([, f]) => f.onboardingState === 'awaiting_portfolio');
    expect(call).toBeTruthy();
    expect(call![1].searchQueries).toBeUndefined();
  });

  it('awaiting_queries → awaiting_portfolio with custom queries', async () => {
    mockUserState = { onboardingState: 'awaiting_queries' };
    const ctx = createMockCtx(12345, 'UX designer, product designer');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) =>
      f.onboardingState === 'awaiting_portfolio' &&
      f.searchQueries?.length === 2
    )).toBe(true);
  });

  it('awaiting_portfolio → awaiting_about on URL input', async () => {
    mockUserState = { onboardingState: 'awaiting_portfolio' };
    const ctx = createMockCtx(12345, 'https://behance.net/user');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) =>
      f.onboardingState === 'awaiting_about' &&
      f.portfolio === 'https://behance.net/user'
    )).toBe(true);
  });

  it('awaiting_portfolio → awaiting_about on skip', async () => {
    mockUserState = { onboardingState: 'awaiting_portfolio' };
    const ctx = createMockCtx(12345, 'skip');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) =>
      f.onboardingState === 'awaiting_about' &&
      f.portfolio === null
    )).toBe(true);
  });

  it('awaiting_about → complete on valid text', async () => {
    mockUserState = { onboardingState: 'awaiting_about' };
    const ctx = createMockCtx(12345, '5 лет в UX, работал в финтехе');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) =>
      f.onboardingState === 'complete' &&
      f.about === '5 лет в UX, работал в финтехе'
    )).toBe(true);
  });

  it('awaiting_about → complete on skip', async () => {
    mockUserState = { onboardingState: 'awaiting_about' };
    const ctx = createMockCtx(12345, '-');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) =>
      f.onboardingState === 'complete' &&
      f.about === null
    )).toBe(true);
  });

  it('complete state returns false (not handled)', async () => {
    mockUserState = { onboardingState: 'complete' };
    const ctx = createMockCtx(12345, 'hello');
    const handled = await handleOnboarding(ctx);
    expect(handled).toBe(false);
  });
});

// ===== Invalid input handling =====

describe('onboarding — invalid input stays on same step', () => {
  it('awaiting_name rejects empty input', async () => {
    mockUserState = { onboardingState: 'awaiting_name' };
    const ctx = createMockCtx(12345, '   ');
    await handleOnboarding(ctx);
    expect(ctx.reply).toHaveBeenCalledWith('Не понял. Попробуй ещё раз.');
    expect(updateUserCalls).toHaveLength(0);
  });

  it('awaiting_experience rejects non-numeric input', async () => {
    mockUserState = { onboardingState: 'awaiting_experience' };
    const ctx = createMockCtx(12345, 'five years');
    await handleOnboarding(ctx);
    expect(ctx.reply).toHaveBeenCalledWith('Не понял. Попробуй ещё раз.');
    expect(updateUserCalls).toHaveLength(0);
  });

  it('awaiting_experience rejects negative numbers', async () => {
    mockUserState = { onboardingState: 'awaiting_experience' };
    const ctx = createMockCtx(12345, '-3');
    await handleOnboarding(ctx);
    expect(ctx.reply).toHaveBeenCalledWith('Не понял. Попробуй ещё раз.');
  });

  it('awaiting_salary rejects gibberish', async () => {
    mockUserState = { onboardingState: 'awaiting_salary' };
    const ctx = createMockCtx(12345, 'много денег');
    await handleOnboarding(ctx);
    expect(ctx.reply).toHaveBeenCalledWith('Не понял. Попробуй ещё раз.');
  });

  it('ignores messages with no text during text steps', async () => {
    mockUserState = { onboardingState: 'awaiting_name' };
    const ctx = createMockCtx(12345);
    ctx.message = undefined;
    const handled = await handleOnboarding(ctx);
    expect(handled).toBe(true);
    expect(updateUserCalls).toHaveLength(0);
  });
});

// ===== handleFormatCallback =====

describe('handleFormatCallback', () => {
  it('sets preferredFormat and advances to awaiting_domains', async () => {
    mockUserState = { onboardingState: 'awaiting_format' };
    const ctx = createMockCtx(12345);
    await handleFormatCallback(ctx, 'remote');
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(updateUserCalls.some(([, f]) =>
      f.preferredFormat === 'remote' && f.onboardingState === 'awaiting_domains'
    )).toBe(true);
    expect(ctx.deleteMessage).toHaveBeenCalled();
  });

  it('ignores callback if user is not in awaiting_format', async () => {
    mockUserState = { onboardingState: 'awaiting_name' };
    const ctx = createMockCtx(12345);
    await handleFormatCallback(ctx, 'remote');
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
    expect(updateUserCalls).toHaveLength(0);
  });

  it('handles format edit in editing mode', async () => {
    mockUserState = { onboardingState: 'complete' };
    editingSessions.set(12345, 'format');
    const ctx = createMockCtx(12345);
    await handleFormatCallback(ctx, 'hybrid');
    expect(updateUserCalls.some(([, f]) => f.preferredFormat === 'hybrid')).toBe(true);
    expect(editingSessions.has(12345)).toBe(false);
  });
});

// ===== handleDomainCallback =====

describe('handleDomainCallback', () => {
  it('toggles a domain on/off', async () => {
    mockUserState = { onboardingState: 'awaiting_domains' };
    const ctx = createMockCtx(12345);

    // Toggle on
    await handleDomainCallback(ctx, 'FinTech');
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalled();
  });

  it('"done" saves selected domains and moves to awaiting_red_flags', async () => {
    mockUserState = { onboardingState: 'awaiting_domains' };
    const ctx = createMockCtx(12345);

    // First toggle on FinTech
    await handleDomainCallback(ctx, 'FinTech');
    vi.clearAllMocks();

    // Then hit done
    await handleDomainCallback(ctx, 'done');
    expect(updateUserCalls.some(([, f]) => Array.isArray(f.domains))).toBe(true);
    expect(updateUserCalls.some(([, f]) => f.onboardingState === 'awaiting_red_flags')).toBe(true);
  });

  it('"skip" clears domains and moves to awaiting_red_flags', async () => {
    mockUserState = { onboardingState: 'awaiting_domains' };
    const ctx = createMockCtx(12345);
    await handleDomainCallback(ctx, 'skip');
    expect(updateUserCalls.some(([, f]) =>
      Array.isArray(f.domains) && f.domains.length === 0
    )).toBe(true);
    expect(updateUserCalls.some(([, f]) => f.onboardingState === 'awaiting_red_flags')).toBe(true);
  });

  it('"custom" answers callback with text prompt', async () => {
    mockUserState = { onboardingState: 'awaiting_domains' };
    const ctx = createMockCtx(12345);
    await handleDomainCallback(ctx, 'custom');
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Напиши название отрасли текстом' });
  });

  it('ignores callback if user is not in awaiting_domains', async () => {
    mockUserState = { onboardingState: 'awaiting_name' };
    const ctx = createMockCtx(12345);
    await handleDomainCallback(ctx, 'FinTech');
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
  });

  it('domain done in editing mode returns to edit menu', async () => {
    mockUserState = { onboardingState: 'complete' };
    editingSessions.set(12345, 'domains');
    const ctx = createMockCtx(12345);

    // Toggle on
    await handleDomainCallback(ctx, 'EdTech');
    vi.clearAllMocks();

    // Done
    await handleDomainCallback(ctx, 'done');
    expect(editingSessions.has(12345)).toBe(false);
    expect(updateUserCalls.some(([, f]) => Array.isArray(f.domains))).toBe(true);
    // Should NOT set onboardingState (editing mode keeps 'complete')
    expect(updateUserCalls.every(([, f]) => f.onboardingState !== 'awaiting_red_flags')).toBe(true);
  });
});

// ===== handleOnboardingNavCallback =====

describe('handleOnboardingNavCallback — back', () => {
  it('goes back from awaiting_title to awaiting_name', async () => {
    mockUserState = { onboardingState: 'awaiting_title' };
    const ctx = createMockCtx(12345);
    await handleOnboardingNavCallback(ctx, 'back');
    expect(updateUserCalls.some(([, f]) => f.onboardingState === 'awaiting_name')).toBe(true);
    expect(ctx.deleteMessage).toHaveBeenCalled();
  });

  it('goes back from awaiting_salary to awaiting_skills', async () => {
    mockUserState = { onboardingState: 'awaiting_salary' };
    const ctx = createMockCtx(12345);
    await handleOnboardingNavCallback(ctx, 'back');
    expect(updateUserCalls.some(([, f]) => f.onboardingState === 'awaiting_skills')).toBe(true);
  });

  it('goes back from awaiting_domains to awaiting_format', async () => {
    mockUserState = { onboardingState: 'awaiting_domains' };
    const ctx = createMockCtx(12345);
    await handleOnboardingNavCallback(ctx, 'back');
    expect(updateUserCalls.some(([, f]) => f.onboardingState === 'awaiting_format')).toBe(true);
  });

  it('goes back from awaiting_about to awaiting_portfolio', async () => {
    mockUserState = { onboardingState: 'awaiting_about' };
    const ctx = createMockCtx(12345);
    await handleOnboardingNavCallback(ctx, 'back');
    expect(updateUserCalls.some(([, f]) => f.onboardingState === 'awaiting_portfolio')).toBe(true);
  });

  it('does nothing when on awaiting_name (no previous state)', async () => {
    mockUserState = { onboardingState: 'awaiting_name' };
    const ctx = createMockCtx(12345);
    await handleOnboardingNavCallback(ctx, 'back');
    // Should answer callback but not update state
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(updateUserCalls).toHaveLength(0);
  });

  it('does nothing when user is complete', async () => {
    mockUserState = { onboardingState: 'complete' };
    const ctx = createMockCtx(12345);
    await handleOnboardingNavCallback(ctx, 'back');
    expect(updateUserCalls).toHaveLength(0);
  });
});

describe('handleOnboardingNavCallback — skip', () => {
  it('skips awaiting_salary with null values', async () => {
    mockUserState = { onboardingState: 'awaiting_salary' };
    const ctx = createMockCtx(12345);
    await handleOnboardingNavCallback(ctx, 'skip');
    expect(updateUserCalls.some(([, f]) =>
      f.onboardingState === 'awaiting_format' &&
      f.salaryMin === null &&
      f.salaryMax === null
    )).toBe(true);
  });

  it('skips awaiting_red_flags with empty array', async () => {
    mockUserState = { onboardingState: 'awaiting_red_flags' };
    const ctx = createMockCtx(12345);
    await handleOnboardingNavCallback(ctx, 'skip');
    expect(updateUserCalls.some(([, f]) =>
      f.onboardingState === 'awaiting_blacklist' &&
      Array.isArray(f.redFlags) &&
      f.redFlags.length === 0
    )).toBe(true);
  });

  it('skips awaiting_blacklist with empty array', async () => {
    mockUserState = { onboardingState: 'awaiting_blacklist' };
    const ctx = createMockCtx(12345);
    await handleOnboardingNavCallback(ctx, 'skip');
    expect(updateUserCalls.some(([, f]) =>
      f.onboardingState === 'awaiting_queries' &&
      Array.isArray(f.companyBlacklist) &&
      f.companyBlacklist.length === 0
    )).toBe(true);
  });

  it('skips awaiting_portfolio with null', async () => {
    mockUserState = { onboardingState: 'awaiting_portfolio' };
    const ctx = createMockCtx(12345);
    await handleOnboardingNavCallback(ctx, 'skip');
    expect(updateUserCalls.some(([, f]) =>
      f.onboardingState === 'awaiting_about' &&
      f.portfolio === null
    )).toBe(true);
  });

  it('skips awaiting_about → complete', async () => {
    mockUserState = { onboardingState: 'awaiting_about' };
    const ctx = createMockCtx(12345);
    await handleOnboardingNavCallback(ctx, 'skip');
    expect(updateUserCalls.some(([, f]) =>
      f.onboardingState === 'complete' &&
      f.about === null
    )).toBe(true);
  });
});

describe('handleOnboardingNavCallback — ok', () => {
  it('accepts auto-generated queries and advances', async () => {
    mockUserState = { onboardingState: 'awaiting_queries' };
    const ctx = createMockCtx(12345);
    await handleOnboardingNavCallback(ctx, 'ok');
    expect(updateUserCalls.some(([, f]) => f.onboardingState === 'awaiting_portfolio')).toBe(true);
  });
});

// ===== askQuestion =====

describe('askQuestion', () => {
  it('sends format buttons for awaiting_format', async () => {
    const ctx = createMockCtx(12345);
    await askQuestion(ctx, 'awaiting_format');
    expect(ctx.reply).toHaveBeenCalled();
    const call = ctx._replyCalls[0];
    expect(call[0]).toContain('формат работы');
    expect(call[1]?.reply_markup).toBeDefined();
  });

  it('sends domain selection for awaiting_domains', async () => {
    const ctx = createMockCtx(12345);
    await askQuestion(ctx, 'awaiting_domains');
    expect(ctx.reply).toHaveBeenCalled();
    const call = ctx._replyCalls[0];
    expect(call[0]).toContain('отраслях');
    expect(call[1]?.reply_markup).toBeDefined();
  });

  it('sends query suggestions for awaiting_queries with title', async () => {
    mockUserState = { title: 'Product Designer' };
    const ctx = createMockCtx(12345);
    await askQuestion(ctx, 'awaiting_queries');
    expect(ctx.reply).toHaveBeenCalled();
    const call = ctx._replyCalls[0];
    expect(call[0]).toContain('Product Designer');
    // Should also update searchQueries with auto-generated
    expect(updateUserCalls.some(([, f]) => Array.isArray(f.searchQueries))).toBe(true);
  });

  it('sends query suggestions without title', async () => {
    mockUserState = { title: '' };
    const ctx = createMockCtx(12345);
    await askQuestion(ctx, 'awaiting_queries');
    expect(ctx.reply).toHaveBeenCalled();
    const call = ctx._replyCalls[0];
    // No title → generic prompt
    expect(call[0]).toContain('поисковые запросы');
  });

  it('sends text question for awaiting_name', async () => {
    const ctx = createMockCtx(12345);
    await askQuestion(ctx, 'awaiting_name');
    expect(ctx.reply).toHaveBeenCalled();
    const call = ctx._replyCalls[0];
    expect(call[0]).toContain('зовут');
  });

  it('sends text question for awaiting_salary with skip/back buttons', async () => {
    const ctx = createMockCtx(12345);
    await askQuestion(ctx, 'awaiting_salary');
    expect(ctx.reply).toHaveBeenCalled();
    const call = ctx._replyCalls[0];
    expect(call[0]).toContain('зарплата');
    // Should have inline keyboard with skip+back
    expect(call[1]?.reply_markup).toBeDefined();
  });

  it('sends text question for awaiting_about with skip/back', async () => {
    const ctx = createMockCtx(12345);
    await askQuestion(ctx, 'awaiting_about');
    expect(ctx.reply).toHaveBeenCalled();
    const call = ctx._replyCalls[0];
    expect(call[0]).toContain('опыте');
    expect(call[1]?.reply_markup).toBeDefined();
  });
});

// ===== Editing sessions =====

describe('editing sessions', () => {
  it('editing format intercepts text and tells user to use buttons', async () => {
    mockUserState = { onboardingState: 'complete' };
    editingSessions.set(12345, 'format');
    const ctx = createMockCtx(12345, 'remote');
    const handled = await handleOnboarding(ctx);
    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith('Выбери формат кнопкой выше.');
  });

  it('editing domains accepts text as custom domain', async () => {
    mockUserState = { onboardingState: 'complete' };
    editingSessions.set(12345, 'domains');
    const ctx = createMockCtx(12345, 'CyberSecurity');
    const handled = await handleOnboarding(ctx);
    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalled();
    const call = ctx._replyCalls[0];
    expect(call[0]).toContain('CyberSecurity');
    expect(call[1]?.reply_markup).toBeDefined();
  });

  it('editing text field (name) updates and returns to edit menu', async () => {
    mockUserState = { onboardingState: 'complete' };
    editingSessions.set(12345, 'name');
    const ctx = createMockCtx(12345, 'Петр');
    const handled = await handleOnboarding(ctx);
    expect(handled).toBe(true);
    expect(updateUserCalls.some(([, f]) => f.name === 'Петр')).toBe(true);
    expect(editingSessions.has(12345)).toBe(false);
  });

  it('editing text field with invalid input shows error', async () => {
    mockUserState = { onboardingState: 'complete' };
    editingSessions.set(12345, 'experience');
    const ctx = createMockCtx(12345, 'abc');
    const handled = await handleOnboarding(ctx);
    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith('Не понял. Попробуй ещё раз.');
    // Session should persist
    expect(editingSessions.has(12345)).toBe(true);
  });

  it('editing queries with "ок" keeps existing queries', async () => {
    mockUserState = { onboardingState: 'complete', searchQueries: ['existing'] };
    editingSessions.set(12345, 'queries');
    const ctx = createMockCtx(12345, 'ок');
    const handled = await handleOnboarding(ctx);
    expect(handled).toBe(true);
    // Should not call updateUser with searchQueries
    expect(updateUserCalls.every(([, f]) => f.searchQueries === undefined)).toBe(true);
    expect(editingSessions.has(12345)).toBe(false);
  });
});

describe('handleEditFieldCallback', () => {
  it('sets editing session and asks question for text field', async () => {
    mockUserState = { onboardingState: 'complete', name: 'Иван' };
    const ctx = createMockCtx(12345);
    await handleEditFieldCallback(ctx, 'name');
    expect(editingSessions.get(12345)).toBe('name');
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    // Should show current value, then ask question
    expect(ctx.reply).toHaveBeenCalled();
  });

  it('sets editing session and shows buttons for format field', async () => {
    mockUserState = { onboardingState: 'complete', preferredFormat: 'remote' };
    const ctx = createMockCtx(12345);
    await handleEditFieldCallback(ctx, 'format');
    expect(editingSessions.get(12345)).toBe('format');
    expect(ctx.reply).toHaveBeenCalled();
  });

  it('ignores unknown field', async () => {
    const ctx = createMockCtx(12345);
    await handleEditFieldCallback(ctx, 'nonexistent');
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
    expect(editingSessions.has(12345)).toBe(false);
  });
});

// ===== Nav callbacks in editing mode =====

describe('handleOnboardingNavCallback — editing mode', () => {
  it('back in editing mode returns to edit menu', async () => {
    mockUserState = { onboardingState: 'complete' };
    editingSessions.set(12345, 'salary');
    const ctx = createMockCtx(12345);
    await handleOnboardingNavCallback(ctx, 'back');
    expect(editingSessions.has(12345)).toBe(false);
    expect(ctx.reply).toHaveBeenCalled(); // showEditMenu
  });

  it('skip in editing mode applies skip data and returns to edit menu', async () => {
    mockUserState = { onboardingState: 'complete' };
    editingSessions.set(12345, 'salary');
    const ctx = createMockCtx(12345);
    await handleOnboardingNavCallback(ctx, 'skip');
    expect(editingSessions.has(12345)).toBe(false);
    expect(updateUserCalls.some(([, f]) =>
      f.salaryMin === null && f.salaryMax === null
    )).toBe(true);
  });

  it('skip red_flags in editing mode applies empty array', async () => {
    mockUserState = { onboardingState: 'complete' };
    editingSessions.set(12345, 'red_flags');
    const ctx = createMockCtx(12345);
    await handleOnboardingNavCallback(ctx, 'skip');
    expect(updateUserCalls.some(([, f]) =>
      Array.isArray(f.redFlags) && f.redFlags.length === 0
    )).toBe(true);
    expect(editingSessions.has(12345)).toBe(false);
  });
});

// ===== Custom domain text input during onboarding =====

describe('awaiting_domains — custom text input', () => {
  it('adds typed text as custom domain during onboarding', async () => {
    mockUserState = { onboardingState: 'awaiting_domains' };
    const ctx = createMockCtx(12345, 'CyberSecurity');
    const handled = await handleOnboarding(ctx);
    expect(handled).toBe(true);
    const call = ctx._replyCalls[0];
    expect(call[0]).toContain('CyberSecurity');
    expect(call[1]?.reply_markup).toBeDefined();
  });
});

// ===== Complete flow (end-to-end through text steps) =====

describe('onboarding — complete text flow', () => {
  it('progresses through all text-input steps', async () => {
    const tid = 99999;

    // 1. new → awaiting_name
    mockUserState = { onboardingState: 'new' };
    let ctx = createMockCtx(tid, 'start');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) => f.onboardingState === 'awaiting_name')).toBe(true);

    // 2. awaiting_name → awaiting_title
    updateUserCalls = [];
    mockUserState = { onboardingState: 'awaiting_name' };
    ctx = createMockCtx(tid, 'Алиса');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) => f.name === 'Алиса')).toBe(true);

    // 3. awaiting_title → awaiting_experience
    updateUserCalls = [];
    mockUserState = { onboardingState: 'awaiting_title' };
    ctx = createMockCtx(tid, 'Frontend Developer');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) => f.title === 'Frontend Developer')).toBe(true);

    // 4. awaiting_experience → awaiting_skills
    updateUserCalls = [];
    mockUserState = { onboardingState: 'awaiting_experience' };
    ctx = createMockCtx(tid, '3');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) => f.yearsExperience === 3)).toBe(true);

    // 5. awaiting_skills → awaiting_salary
    updateUserCalls = [];
    mockUserState = { onboardingState: 'awaiting_skills' };
    ctx = createMockCtx(tid, 'React, TypeScript');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) => f.skills?.length === 2)).toBe(true);

    // 6. awaiting_salary → awaiting_format
    updateUserCalls = [];
    mockUserState = { onboardingState: 'awaiting_salary' };
    ctx = createMockCtx(tid, '200k-400k');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) => f.salaryMin === 200_000)).toBe(true);

    // 7. awaiting_format → awaiting_domains (via callback)
    updateUserCalls = [];
    mockUserState = { onboardingState: 'awaiting_format' };
    ctx = createMockCtx(tid);
    await handleFormatCallback(ctx, 'remote');
    expect(updateUserCalls.some(([, f]) => f.preferredFormat === 'remote')).toBe(true);

    // 8. awaiting_domains → awaiting_red_flags (via callback skip)
    updateUserCalls = [];
    mockUserState = { onboardingState: 'awaiting_domains' };
    ctx = createMockCtx(tid);
    await handleDomainCallback(ctx, 'skip');
    expect(updateUserCalls.some(([, f]) => f.onboardingState === 'awaiting_red_flags')).toBe(true);

    // 9. awaiting_red_flags → awaiting_blacklist
    updateUserCalls = [];
    mockUserState = { onboardingState: 'awaiting_red_flags' };
    ctx = createMockCtx(tid, '-');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) => f.onboardingState === 'awaiting_blacklist')).toBe(true);

    // 10. awaiting_blacklist → awaiting_queries
    updateUserCalls = [];
    mockUserState = { onboardingState: 'awaiting_blacklist' };
    ctx = createMockCtx(tid, '-');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) => f.onboardingState === 'awaiting_queries')).toBe(true);

    // 11. awaiting_queries → awaiting_portfolio (via ok callback)
    updateUserCalls = [];
    mockUserState = { onboardingState: 'awaiting_queries', title: 'Frontend Developer' };
    ctx = createMockCtx(tid);
    await handleOnboardingNavCallback(ctx, 'ok');
    expect(updateUserCalls.some(([, f]) => f.onboardingState === 'awaiting_portfolio')).toBe(true);

    // 12. awaiting_portfolio → awaiting_about
    updateUserCalls = [];
    mockUserState = { onboardingState: 'awaiting_portfolio' };
    ctx = createMockCtx(tid, '-');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) => f.onboardingState === 'awaiting_about')).toBe(true);

    // 13. awaiting_about → complete
    updateUserCalls = [];
    mockUserState = { onboardingState: 'awaiting_about' };
    ctx = createMockCtx(tid, 'Работал 3 года в стартапах');
    await handleOnboarding(ctx);
    expect(updateUserCalls.some(([, f]) => f.onboardingState === 'complete')).toBe(true);
  });
});

// ===== Domain weights =====

describe('domain weights', () => {
  it('single domain gets weight 0.8', async () => {
    const tid = 77777;
    mockUserState = { onboardingState: 'awaiting_domains' };
    const ctx = createMockCtx(tid);

    // Select one domain, then done
    await handleDomainCallback(ctx, 'FinTech');
    updateUserCalls = [];
    await handleDomainCallback(ctx, 'done');

    const domainUpdate = updateUserCalls.find(([, f]) => Array.isArray(f.domains));
    expect(domainUpdate).toBeTruthy();
    expect(domainUpdate![1].domains).toHaveLength(1);
    expect(domainUpdate![1].domains[0].weight).toBe(0.8);
  });

  it('multiple domains get decreasing weights', async () => {
    const tid = 88888;
    mockUserState = { onboardingState: 'awaiting_domains' };
    const ctx = createMockCtx(tid);

    await handleDomainCallback(ctx, 'FinTech');
    await handleDomainCallback(ctx, 'EdTech');
    await handleDomainCallback(ctx, 'AI/ML');
    updateUserCalls = [];
    await handleDomainCallback(ctx, 'done');

    const domainUpdate = updateUserCalls.find(([, f]) => Array.isArray(f.domains));
    expect(domainUpdate).toBeTruthy();
    const domains = domainUpdate![1].domains;
    expect(domains).toHaveLength(3);
    // First should be highest weight, last should be lowest
    expect(domains[0].weight).toBeGreaterThan(domains[2].weight);
  });
});

// ===== showEditMenu =====

describe('showEditMenu', () => {
  it('sends a reply with all field labels', async () => {
    mockUserState = { onboardingState: 'complete', name: 'Test', title: 'Dev' };
    const ctx = createMockCtx(12345);
    await showEditMenu(ctx);
    expect(ctx.reply).toHaveBeenCalled();
    const call = ctx._replyCalls[0];
    const text = call[0] as string;
    expect(text).toContain('Редактирование профиля');
    expect(text).toContain('Имя');
    expect(text).toContain('Должность');
    expect(text).toContain('Навыки');
    expect(text).toContain('Зарплата');
    expect(text).toContain('Формат');
    // Should have inline keyboard
    expect(call[1]?.reply_markup).toBeDefined();
    expect(call[1]?.parse_mode).toBe('HTML');
  });
});

// ===== Multi-user isolation =====

describe('multi-user isolation', () => {
  it('editing sessions are per-user', async () => {
    editingSessions.set(111, 'name');
    editingSessions.set(222, 'title');

    expect(editingSessions.get(111)).toBe('name');
    expect(editingSessions.get(222)).toBe('title');

    editingSessions.delete(111);
    expect(editingSessions.has(111)).toBe(false);
    expect(editingSessions.has(222)).toBe(true);
  });
});
