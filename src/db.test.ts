import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import type { Vacancy } from './types';

// Mock config before importing db
vi.mock('./config', () => ({
  CONFIG: {
    dbPath: ':memory:',
    adminTelegramId: 999999,
    scoring: { skills: 0.40, salary: 0.25, format: 0.20, domain: 0.15 },
    freemium: { free: { coverLetters: 5, digestPageSize: 15, pushMaxCards: 2 }, pro: { coverLetters: Infinity, digestPageSize: Infinity, pushMaxCards: 5 }, creditsPerLetter: 5 },
    stars: { proMonthly: 700, proYearly: 6720, creditsSmall: { stars: 100, letters: 3 }, creditsLarge: { stars: 300, letters: 10 } },
  },
}));

// Mock logger to suppress output
vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Force fresh db for each test by resetting module state
let db: typeof import('./db');

beforeEach(async () => {
  vi.resetModules();
  db = await import('./db');
  // Initialize db
  db.getDb();
});

afterEach(() => {
  try {
    db.getDb().close();
  } catch { /* ok */ }
});

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
    city: 'Москва',
    description: 'Looking for a product designer',
    skills: ['Figma', 'UI/UX'],
    url: 'https://hh.ru/vacancy/123',
    publishedAt: new Date(),
    experience: 'middle',
    ...overrides,
  };
}

describe('KV store', () => {
  it('returns null for non-existent key', () => {
    expect(db.getKV('nonexistent')).toBeNull();
  });

  it('sets and gets a value', () => {
    db.setKV('foo', 'bar');
    expect(db.getKV('foo')).toBe('bar');
  });

  it('overwrites existing key', () => {
    db.setKV('foo', 'bar');
    db.setKV('foo', 'baz');
    expect(db.getKV('foo')).toBe('baz');
  });
});

describe('getOrCreateUser', () => {
  it('creates a new user with default state', () => {
    const user = db.getOrCreateUser(12345);
    expect(user.telegramId).toBe(12345);
    expect(user.onboardingState).toBe('new');
    expect(user.plan).toBe('free');
    expect(user.credits).toBe(0);
    expect(user.lettersUsed).toBe(0);
  });

  it('returns existing user on second call', () => {
    const user1 = db.getOrCreateUser(12345);
    db.updateUser(12345, { name: 'Test' });
    const user2 = db.getOrCreateUser(12345);
    expect(user2.id).toBe(user1.id);
    expect(user2.name).toBe('Test');
  });

  it('seeds admin user automatically', () => {
    // Admin telegram ID is 999999 from mock config
    const admin = db.getOrCreateUser(999999);
    expect(admin.onboardingState).toBe('complete');
    expect(admin.name).toBe('Admin');
  });
});

describe('updateUser', () => {
  it('updates name', () => {
    db.getOrCreateUser(12345);
    db.updateUser(12345, { name: 'John' });
    const user = db.getOrCreateUser(12345);
    expect(user.name).toBe('John');
  });

  it('updates skills as JSON array', () => {
    db.getOrCreateUser(12345);
    db.updateUser(12345, { skills: ['Figma', 'Sketch'] });
    const user = db.getOrCreateUser(12345);
    expect(user.skills).toEqual(['Figma', 'Sketch']);
  });

  it('updates multiple fields at once', () => {
    db.getOrCreateUser(12345);
    db.updateUser(12345, {
      name: 'Jane',
      title: 'Designer',
      salaryMin: 300_000,
      salaryMax: 500_000,
      preferredFormat: 'remote',
      onboardingState: 'complete',
    });
    const user = db.getOrCreateUser(12345);
    expect(user.name).toBe('Jane');
    expect(user.title).toBe('Designer');
    expect(user.salaryMin).toBe(300_000);
    expect(user.salaryMax).toBe(500_000);
    expect(user.preferredFormat).toBe('remote');
    expect(user.onboardingState).toBe('complete');
  });

  it('updates domains as JSON', () => {
    db.getOrCreateUser(12345);
    db.updateUser(12345, { domains: [{ name: 'FinTech', weight: 1.0 }] });
    const user = db.getOrCreateUser(12345);
    expect(user.domains).toEqual([{ name: 'FinTech', weight: 1.0 }]);
  });

  it('updates redFlags and companyBlacklist', () => {
    db.getOrCreateUser(12345);
    db.updateUser(12345, {
      redFlags: ['junior', '3D'],
      companyBlacklist: ['BadCorp'],
    });
    const user = db.getOrCreateUser(12345);
    expect(user.redFlags).toEqual(['junior', '3D']);
    expect(user.companyBlacklist).toEqual(['BadCorp']);
  });
});

describe('upsertVacancy', () => {
  it('inserts a new vacancy and returns inserted=true', () => {
    const v = makeVacancy({ externalId: 'v1' });
    const { id, inserted } = db.upsertVacancy(v);
    expect(inserted).toBe(true);
    expect(id).toBeGreaterThan(0);
  });

  it('returns inserted=false on duplicate', () => {
    const v = makeVacancy({ externalId: 'v2' });
    db.upsertVacancy(v);
    const { inserted } = db.upsertVacancy(v);
    expect(inserted).toBe(false);
  });

  it('allows same externalId from different sources', () => {
    const v1 = makeVacancy({ externalId: 'same', source: 'hh.ru' });
    const v2 = makeVacancy({ externalId: 'same', source: 'habr' });
    const r1 = db.upsertVacancy(v1);
    const r2 = db.upsertVacancy(v2);
    expect(r1.inserted).toBe(true);
    expect(r2.inserted).toBe(true);
    expect(r1.id).not.toBe(r2.id);
  });
});

describe('upsertUserVacancy + getUserVacancies', () => {
  it('stores and retrieves user vacancy with scores', () => {
    const user = db.getOrCreateUser(12345);
    const { id: vacId } = db.upsertVacancy(makeVacancy());
    db.upsertUserVacancy(user.id, vacId, 75, 80, 100, 100, 50);

    const { vacancies, total } = db.getUserVacancies(user.id, 0, 10);
    expect(total).toBe(1);
    expect(vacancies[0].score).toBe(75);
    expect(vacancies[0].scoreSkills).toBe(80);
    expect(vacancies[0].scoreSalary).toBe(100);
  });

  it('filters by minScore', () => {
    const user = db.getOrCreateUser(12345);
    const { id: v1 } = db.upsertVacancy(makeVacancy({ externalId: 'a' }));
    const { id: v2 } = db.upsertVacancy(makeVacancy({ externalId: 'b' }));
    db.upsertUserVacancy(user.id, v1, 80, 80, 80, 80, 80);
    db.upsertUserVacancy(user.id, v2, 30, 30, 30, 30, 30);

    const { total } = db.getUserVacancies(user.id, 0, 10, 40);
    expect(total).toBe(1);
  });

  it('respects offset and limit', () => {
    const user = db.getOrCreateUser(12345);
    for (let i = 0; i < 5; i++) {
      const { id: vId } = db.upsertVacancy(makeVacancy());
      db.upsertUserVacancy(user.id, vId, 60 + i, 60, 60, 60, 60);
    }

    const page1 = db.getUserVacancies(user.id, 0, 2);
    expect(page1.vacancies.length).toBe(2);
    expect(page1.total).toBe(5);

    const page2 = db.getUserVacancies(user.id, 2, 2);
    expect(page2.vacancies.length).toBe(2);
  });

  it('orders by score DESC', () => {
    const user = db.getOrCreateUser(12345);
    const { id: v1 } = db.upsertVacancy(makeVacancy({ externalId: 'low' }));
    const { id: v2 } = db.upsertVacancy(makeVacancy({ externalId: 'high' }));
    db.upsertUserVacancy(user.id, v1, 50, 50, 50, 50, 50);
    db.upsertUserVacancy(user.id, v2, 90, 90, 90, 90, 90);

    const { vacancies } = db.getUserVacancies(user.id, 0, 10);
    expect(vacancies[0].score).toBe(90);
    expect(vacancies[1].score).toBe(50);
  });
});

describe('getVacancyById', () => {
  it('returns null for non-existent id', () => {
    expect(db.getVacancyById(9999)).toBeNull();
  });

  it('returns vacancy without userId', () => {
    const { id } = db.upsertVacancy(makeVacancy());
    const v = db.getVacancyById(id);
    expect(v).not.toBeNull();
    expect(v!.title).toBe('Product Designer');
    expect(v!.score).toBe(0);
  });

  it('returns vacancy with user scores when userId provided', () => {
    const user = db.getOrCreateUser(12345);
    const { id: vId } = db.upsertVacancy(makeVacancy());
    db.upsertUserVacancy(user.id, vId, 85, 90, 80, 100, 60);

    const v = db.getVacancyById(vId, user.id);
    expect(v!.score).toBe(85);
    expect(v!.scoreSkills).toBe(90);
  });
});

describe('updateUserVacancyStatus', () => {
  it('updates status to applied', () => {
    const user = db.getOrCreateUser(12345);
    const { id: vId } = db.upsertVacancy(makeVacancy());
    db.upsertUserVacancy(user.id, vId, 70, 70, 70, 70, 70);

    db.updateUserVacancyStatus(user.id, vId, 'applied');

    // Applied vacancies should not appear in "new" digest
    const { total } = db.getUserVacancies(user.id, 0, 10);
    expect(total).toBe(0);
  });

  it('updates status to rejected', () => {
    const user = db.getOrCreateUser(12345);
    const { id: vId } = db.upsertVacancy(makeVacancy());
    db.upsertUserVacancy(user.id, vId, 70, 70, 70, 70, 70);

    db.updateUserVacancyStatus(user.id, vId, 'rejected');

    const { total } = db.getUserVacancies(user.id, 0, 10);
    expect(total).toBe(0);
  });
});

describe('getAllUsers', () => {
  it('returns only onboarded users', () => {
    db.getOrCreateUser(11111); // state: new
    db.getOrCreateUser(22222);
    db.updateUser(22222, { onboardingState: 'complete', name: 'Done' });

    const users = db.getAllUsers();
    // Admin (999999) is auto-seeded + user 22222
    expect(users.length).toBe(2);
    expect(users.some(u => u.telegramId === 22222)).toBe(true);
  });
});

describe('markVacanciesNotified', () => {
  it('marks vacancies as notified', () => {
    const user = db.getOrCreateUser(12345);
    const { id: v1 } = db.upsertVacancy(makeVacancy({ externalId: 'n1' }));
    const { id: v2 } = db.upsertVacancy(makeVacancy({ externalId: 'n2' }));
    db.upsertUserVacancy(user.id, v1, 80, 80, 80, 80, 80);
    db.upsertUserVacancy(user.id, v2, 75, 75, 75, 75, 75);

    db.markVacanciesNotified(user.id, [v1]);

    const unnotified = db.getUnnotifiedHighScoreVacancies(user.id, 70);
    expect(unnotified.length).toBe(1);
    expect(unnotified[0].id).toBe(v2);
  });

  it('handles empty array gracefully', () => {
    expect(() => db.markVacanciesNotified(1, [])).not.toThrow();
  });
});

describe('getUserStats', () => {
  it('returns correct counts', () => {
    const user = db.getOrCreateUser(12345);
    const { id: v1 } = db.upsertVacancy(makeVacancy({ externalId: 's1' }));
    const { id: v2 } = db.upsertVacancy(makeVacancy({ externalId: 's2' }));
    const { id: v3 } = db.upsertVacancy(makeVacancy({ externalId: 's3' }));

    db.upsertUserVacancy(user.id, v1, 80, 80, 80, 80, 80);
    db.upsertUserVacancy(user.id, v2, 60, 60, 60, 60, 60);
    db.upsertUserVacancy(user.id, v3, 30, 30, 30, 30, 30);

    db.updateUserVacancyStatus(user.id, v2, 'applied');
    db.updateUserVacancyStatus(user.id, v3, 'rejected');

    const stats = db.getUserStats(user.id);
    expect(stats.total).toBe(3);
    expect(stats.relevant).toBe(2); // score >= 40
    expect(stats.applied).toBe(1);
    expect(stats.rejected).toBe(1);
    expect(stats.sources).toHaveProperty('hh.ru');
  });
});

describe('isProUser', () => {
  it('returns false for free user', () => {
    const user = db.getOrCreateUser(12345);
    expect(db.isProUser(user)).toBe(false);
  });

  it('returns true for pro user with future expiration', () => {
    const user = db.getOrCreateUser(12345);
    const future = new Date();
    future.setMonth(future.getMonth() + 1);
    db.activatePro(user.id, future);
    const updated = db.getOrCreateUser(12345);
    expect(db.isProUser(updated)).toBe(true);
  });

  it('returns false for expired pro user', () => {
    const user = db.getOrCreateUser(12345);
    const past = new Date('2020-01-01');
    db.activatePro(user.id, past);
    const updated = db.getOrCreateUser(12345);
    expect(db.isProUser(updated)).toBe(false);
  });
});

describe('credits', () => {
  it('adds credits', () => {
    const user = db.getOrCreateUser(12345);
    db.addCredits(user.id, 15);
    const updated = db.getOrCreateUser(12345);
    expect(updated.credits).toBe(15);
  });

  it('uses credits when sufficient', () => {
    const user = db.getOrCreateUser(12345);
    db.addCredits(user.id, 10);
    const used = db.useCredits(user.id, 5);
    expect(used).toBe(true);
    const updated = db.getOrCreateUser(12345);
    expect(updated.credits).toBe(5);
  });

  it('refuses to use credits when insufficient', () => {
    const user = db.getOrCreateUser(12345);
    db.addCredits(user.id, 3);
    const used = db.useCredits(user.id, 5);
    expect(used).toBe(false);
    const updated = db.getOrCreateUser(12345);
    expect(updated.credits).toBe(3); // unchanged
  });
});

describe('incrementLettersUsed', () => {
  it('increments counter', () => {
    const user = db.getOrCreateUser(12345);
    expect(user.lettersUsed).toBe(0);
    db.incrementLettersUsed(user.id);
    db.incrementLettersUsed(user.id);
    const updated = db.getOrCreateUser(12345);
    expect(updated.lettersUsed).toBe(2);
  });
});

describe('savePayment', () => {
  it('saves a payment record', () => {
    const user = db.getOrCreateUser(12345);
    expect(() => {
      db.savePayment(user.id, 'charge_123', 'pro_monthly', 700, 'pro_monthly');
    }).not.toThrow();
  });

  it('rejects duplicate charge IDs', () => {
    const user = db.getOrCreateUser(12345);
    db.savePayment(user.id, 'charge_dup', 'pro_monthly', 700, 'pro_monthly');
    expect(() => {
      db.savePayment(user.id, 'charge_dup', 'pro_monthly', 700, 'pro_monthly');
    }).toThrow();
  });
});

describe('getGlobalStats', () => {
  it('returns all stats fields', () => {
    const stats = db.getGlobalStats();
    expect(stats).toHaveProperty('totalUsers');
    expect(stats).toHaveProperty('proUsers');
    expect(stats).toHaveProperty('totalVacancies');
    expect(stats).toHaveProperty('vacanciesBySource');
    expect(stats).toHaveProperty('totalCoverLetters');
    expect(stats).toHaveProperty('avgScore');
    expect(stats).toHaveProperty('mau');
  });

  it('counts vacancies correctly', () => {
    db.upsertVacancy(makeVacancy({ externalId: 'g1', source: 'hh.ru' }));
    db.upsertVacancy(makeVacancy({ externalId: 'g2', source: 'habr' }));

    const stats = db.getGlobalStats();
    expect(stats.totalVacancies).toBe(2);
    expect(stats.vacanciesBySource['hh.ru']).toBe(1);
    expect(stats.vacanciesBySource['habr']).toBe(1);
  });
});

describe('getDigestSummary', () => {
  it('counts unnotified new vacancies above threshold', () => {
    const user = db.getOrCreateUser(12345);
    const { id: v1 } = db.upsertVacancy(makeVacancy({ externalId: 'd1' }));
    const { id: v2 } = db.upsertVacancy(makeVacancy({ externalId: 'd2' }));
    db.upsertUserVacancy(user.id, v1, 80, 80, 80, 80, 80);
    db.upsertUserVacancy(user.id, v2, 50, 50, 50, 50, 50);

    const summary = db.getDigestSummary(user.id);
    expect(summary.total).toBe(2); // both >= 40
    expect(summary.highScore).toBe(1); // only v1 >= 70
  });
});

describe('expireProPlans', () => {
  it('expires past-due pro plans', () => {
    const user = db.getOrCreateUser(12345);
    const past = new Date('2020-01-01');
    db.activatePro(user.id, past);

    const expired = db.expireProPlans();
    expect(expired).toBe(1);

    const updated = db.getOrCreateUser(12345);
    expect(updated.plan).toBe('free');
  });

  it('does not expire active pro plans', () => {
    const user = db.getOrCreateUser(12345);
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    db.activatePro(user.id, future);

    const expired = db.expireProPlans();
    expect(expired).toBe(0);

    const updated = db.getOrCreateUser(12345);
    expect(updated.plan).toBe('pro');
  });
});
