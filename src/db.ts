import Database from 'better-sqlite3';
import { CONFIG } from './config';
import { logger } from './logger';
import type { UserProfile, OnboardingState, ScoredVacancy, Vacancy, VacancyStatus, VacancySource, WorkFormat, SkillWeight, DomainWeight } from './types';

let db: Database.Database;

function safeJsonParse(value: string | null | undefined): string[] {
  if (!value) return [];
  try { return JSON.parse(value); }
  catch { return []; }
}

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(CONFIG.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  getDb().exec(`
    -- Users with their profiles
    CREATE TABLE IF NOT EXISTS users (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id       INTEGER NOT NULL UNIQUE,
      name              TEXT,
      title             TEXT,
      years_experience  INTEGER,
      skills            TEXT NOT NULL DEFAULT '[]',
      salary_min        INTEGER,
      salary_max        INTEGER,
      salary_currency   TEXT NOT NULL DEFAULT 'RUB',
      preferred_format  TEXT NOT NULL DEFAULT 'any',
      portfolio         TEXT,
      about             TEXT,
      onboarding_state  TEXT NOT NULL DEFAULT 'new',
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Shared vacancy pool (scraped once, scored per user)
    CREATE TABLE IF NOT EXISTS vacancies (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      source          TEXT NOT NULL,
      external_id     TEXT NOT NULL,
      title           TEXT NOT NULL,
      company         TEXT NOT NULL,
      salary_from     INTEGER,
      salary_to       INTEGER,
      salary_currency TEXT,
      format          TEXT NOT NULL DEFAULT 'unknown',
      city            TEXT,
      description     TEXT NOT NULL DEFAULT '',
      skills          TEXT NOT NULL DEFAULT '[]',
      url             TEXT NOT NULL,
      published_at    TEXT NOT NULL,
      experience      TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_vacancies_created ON vacancies(created_at DESC);

    -- Per-user vacancy scores and status
    CREATE TABLE IF NOT EXISTS user_vacancies (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      vacancy_id  INTEGER NOT NULL REFERENCES vacancies(id),
      score       INTEGER NOT NULL DEFAULT 0,
      score_skills INTEGER NOT NULL DEFAULT 0,
      score_salary INTEGER NOT NULL DEFAULT 0,
      score_format INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'new',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, vacancy_id)
    );

    CREATE INDEX IF NOT EXISTS idx_uv_user_score ON user_vacancies(user_id, score DESC);
    CREATE INDEX IF NOT EXISTS idx_uv_user_status ON user_vacancies(user_id, status);

    -- Per-user cover letters
    CREATE TABLE IF NOT EXISTS cover_letters (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      vacancy_id  INTEGER NOT NULL REFERENCES vacancies(id),
      text        TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, vacancy_id)
    );

    -- Key-value store (deploy tracking, etc.)
    CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  // Migrate: add new profile columns (v0.2.0)
  const columns = getDb().prepare("PRAGMA table_info(users)").all() as { name: string }[];
  const colNames = new Set(columns.map(c => c.name));

  const migrations: [string, string][] = [
    ['skill_weights', "ALTER TABLE users ADD COLUMN skill_weights TEXT NOT NULL DEFAULT '[]'"],
    ['domains', "ALTER TABLE users ADD COLUMN domains TEXT NOT NULL DEFAULT '[]'"],
    ['red_flags', "ALTER TABLE users ADD COLUMN red_flags TEXT NOT NULL DEFAULT '[]'"],
    ['company_blacklist', "ALTER TABLE users ADD COLUMN company_blacklist TEXT NOT NULL DEFAULT '[]'"],
    ['search_queries', "ALTER TABLE users ADD COLUMN search_queries TEXT NOT NULL DEFAULT '[]'"],
    ['score_domain', "ALTER TABLE user_vacancies ADD COLUMN score_domain INTEGER NOT NULL DEFAULT 0"],
  ];

  for (const [col, sql] of migrations) {
    if (!colNames.has(col)) {
      try { getDb().exec(sql); } catch { /* column may already exist in user_vacancies */ }
    }
  }

  // Check user_vacancies for score_domain and notified
  const uvCols = getDb().prepare("PRAGMA table_info(user_vacancies)").all() as { name: string }[];
  if (!uvCols.some(c => c.name === 'score_domain')) {
    try { getDb().exec("ALTER TABLE user_vacancies ADD COLUMN score_domain INTEGER NOT NULL DEFAULT 0"); } catch { /* ok */ }
  }
  if (!uvCols.some(c => c.name === 'notified')) {
    try {
      getDb().exec("ALTER TABLE user_vacancies ADD COLUMN notified INTEGER NOT NULL DEFAULT 0");
      getDb().exec("CREATE INDEX IF NOT EXISTS idx_uv_unnotified ON user_vacancies(user_id, notified, score DESC)");
    } catch { /* ok */ }
  }

  logger.info('db', 'Schema initialized');
  seedOwner();
}

/** Seed the owner's profile so they skip onboarding (minimal — fill via /profile) */
function seedOwner() {
  const d = getDb();
  const exists = d.prepare('SELECT id FROM users WHERE telegram_id = ?').get(CONFIG.adminTelegramId);
  if (exists) return;

  d.prepare(`
    INSERT INTO users (telegram_id, name, onboarding_state)
    VALUES (?, 'Admin', 'complete')
  `).run(CONFIG.adminTelegramId);

  logger.info('db', 'Owner profile seeded (minimal)');
}

// --- KV Store ---

export function getKV(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setKV(key: string, value: string): void {
  getDb().prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

// --- Users ---

export function getOrCreateUser(telegramId: number): UserProfile {
  const d = getDb();
  let row = d.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as any;

  if (!row) {
    d.prepare('INSERT INTO users (telegram_id) VALUES (?)').run(telegramId);
    row = d.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as any;
  }

  return rowToUser(row);
}

export function updateUser(telegramId: number, fields: Partial<{
  name: string;
  title: string;
  yearsExperience: number;
  skills: string[];
  skillWeights: SkillWeight[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  preferredFormat: string;
  domains: DomainWeight[];
  redFlags: string[];
  companyBlacklist: string[];
  searchQueries: string[];
  portfolio: string | null;
  about: string | null;
  onboardingState: OnboardingState;
}>): void {
  const d = getDb();
  const sets: string[] = [];
  const values: any[] = [];

  if (fields.name !== undefined) { sets.push('name = ?'); values.push(fields.name); }
  if (fields.title !== undefined) { sets.push('title = ?'); values.push(fields.title); }
  if (fields.yearsExperience !== undefined) { sets.push('years_experience = ?'); values.push(fields.yearsExperience); }
  if (fields.skills !== undefined) { sets.push('skills = ?'); values.push(JSON.stringify(fields.skills)); }
  if (fields.skillWeights !== undefined) { sets.push('skill_weights = ?'); values.push(JSON.stringify(fields.skillWeights)); }
  if (fields.salaryMin !== undefined) { sets.push('salary_min = ?'); values.push(fields.salaryMin); }
  if (fields.salaryMax !== undefined) { sets.push('salary_max = ?'); values.push(fields.salaryMax); }
  if (fields.salaryCurrency !== undefined) { sets.push('salary_currency = ?'); values.push(fields.salaryCurrency); }
  if (fields.preferredFormat !== undefined) { sets.push('preferred_format = ?'); values.push(fields.preferredFormat); }
  if (fields.domains !== undefined) { sets.push('domains = ?'); values.push(JSON.stringify(fields.domains)); }
  if (fields.redFlags !== undefined) { sets.push('red_flags = ?'); values.push(JSON.stringify(fields.redFlags)); }
  if (fields.companyBlacklist !== undefined) { sets.push('company_blacklist = ?'); values.push(JSON.stringify(fields.companyBlacklist)); }
  if (fields.searchQueries !== undefined) { sets.push('search_queries = ?'); values.push(JSON.stringify(fields.searchQueries)); }
  if (fields.portfolio !== undefined) { sets.push('portfolio = ?'); values.push(fields.portfolio); }
  if (fields.about !== undefined) { sets.push('about = ?'); values.push(fields.about); }
  if (fields.onboardingState !== undefined) { sets.push('onboarding_state = ?'); values.push(fields.onboardingState); }

  if (sets.length === 0) return;

  values.push(telegramId);
  d.prepare(`UPDATE users SET ${sets.join(', ')} WHERE telegram_id = ?`).run(...values);
}

function safeJsonParseTyped<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; }
  catch { return fallback; }
}

function rowToUser(row: any): UserProfile {
  return {
    id: row.id,
    telegramId: row.telegram_id,
    name: row.name,
    title: row.title,
    yearsExperience: row.years_experience,
    skills: safeJsonParse(row.skills),
    skillWeights: safeJsonParseTyped<SkillWeight[]>(row.skill_weights, []),
    salaryMin: row.salary_min,
    salaryMax: row.salary_max,
    salaryCurrency: row.salary_currency,
    preferredFormat: row.preferred_format as WorkFormat | 'any',
    domains: safeJsonParseTyped<DomainWeight[]>(row.domains, []),
    redFlags: safeJsonParse(row.red_flags),
    companyBlacklist: safeJsonParse(row.company_blacklist),
    searchQueries: safeJsonParse(row.search_queries),
    portfolio: row.portfolio,
    about: row.about,
    onboardingState: row.onboarding_state as OnboardingState,
    createdAt: new Date(row.created_at),
  };
}

// --- Vacancies ---

export function upsertVacancy(v: Vacancy): { id: number; inserted: boolean } {
  const d = getDb();
  const existing = d.prepare('SELECT id FROM vacancies WHERE source = ? AND external_id = ?')
    .get(v.source, v.externalId) as { id: number } | undefined;

  if (existing) return { id: existing.id, inserted: false };

  const result = d.prepare(`
    INSERT INTO vacancies (source, external_id, title, company, salary_from, salary_to, salary_currency,
      format, city, description, skills, url, published_at, experience)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    v.source, v.externalId, v.title, v.company,
    v.salaryFrom, v.salaryTo, v.salaryCurrency,
    v.format, v.city, v.description, JSON.stringify(v.skills), v.url,
    v.publishedAt.toISOString(), v.experience,
  );

  return { id: Number(result.lastInsertRowid), inserted: true };
}

// --- User-Vacancy scores ---

export function upsertUserVacancy(userId: number, vacancyId: number, score: number, scoreSkills: number, scoreSalary: number, scoreFormat: number, scoreDomain: number = 0): void {
  getDb().prepare(`
    INSERT INTO user_vacancies (user_id, vacancy_id, score, score_skills, score_salary, score_format, score_domain)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, vacancy_id) DO UPDATE SET score = excluded.score,
      score_skills = excluded.score_skills, score_salary = excluded.score_salary,
      score_format = excluded.score_format, score_domain = excluded.score_domain
  `).run(userId, vacancyId, score, scoreSkills, scoreSalary, scoreFormat, scoreDomain);
}

export function getUserVacancies(userId: number, offset: number, limit: number, minScore: number = 40): { vacancies: ScoredVacancy[]; total: number } {
  const d = getDb();
  const total = (d.prepare(`
    SELECT COUNT(*) as c FROM user_vacancies uv
    JOIN vacancies v ON v.id = uv.vacancy_id
    WHERE uv.user_id = ? AND uv.status = 'new' AND uv.score >= ?
  `).get(userId, minScore) as any).c;

  const rows = d.prepare(`
    SELECT v.*, uv.score, uv.score_skills, uv.score_salary, uv.score_format,
           COALESCE(uv.score_domain, 0) as score_domain, uv.status,
           uv.created_at as uv_created_at
    FROM user_vacancies uv
    JOIN vacancies v ON v.id = uv.vacancy_id
    WHERE uv.user_id = ? AND uv.status = 'new' AND uv.score >= ?
    ORDER BY uv.score DESC
    LIMIT ? OFFSET ?
  `).all(userId, minScore, limit, offset) as any[];

  return { vacancies: rows.map(rowToScoredVacancy), total };
}

export function getVacancyById(id: number, userId?: number): ScoredVacancy | null {
  const d = getDb();

  if (userId) {
    const row = d.prepare(`
      SELECT v.*, COALESCE(uv.score, 0) as score, COALESCE(uv.score_skills, 0) as score_skills,
        COALESCE(uv.score_salary, 0) as score_salary, COALESCE(uv.score_format, 0) as score_format,
        COALESCE(uv.score_domain, 0) as score_domain, COALESCE(uv.status, 'new') as status
      FROM vacancies v
      LEFT JOIN user_vacancies uv ON uv.vacancy_id = v.id AND uv.user_id = ?
      WHERE v.id = ?
    `).get(userId, id) as any;
    return row ? rowToScoredVacancy(row) : null;
  }

  const row = d.prepare('SELECT *, 0 as score, 0 as score_skills, 0 as score_salary, 0 as score_format, 0 as score_domain, \'new\' as status FROM vacancies WHERE id = ?')
    .get(id) as any;
  return row ? rowToScoredVacancy(row) : null;
}

export function updateUserVacancyStatus(userId: number, vacancyId: number, status: VacancyStatus): void {
  getDb().prepare('UPDATE user_vacancies SET status = ? WHERE user_id = ? AND vacancy_id = ?')
    .run(status, userId, vacancyId);
}

export function getRecentVacancyIds(): number[] {
  const rows = getDb().prepare(`
    SELECT id FROM vacancies WHERE created_at >= datetime('now', '-3 days')
  `).all() as { id: number }[];
  return rows.map(r => r.id);
}

export function getAllUsers(): UserProfile[] {
  const rows = getDb().prepare("SELECT * FROM users WHERE onboarding_state = 'complete'").all() as any[];
  return rows.map(rowToUser);
}

// --- Scheduler helpers ---

export function getUnnotifiedHighScoreVacancies(userId: number, minScore: number = 70): ScoredVacancy[] {
  const rows = getDb().prepare(`
    SELECT v.*, uv.score, uv.score_skills, uv.score_salary, uv.score_format,
           COALESCE(uv.score_domain, 0) as score_domain, uv.status,
           uv.created_at as uv_created_at
    FROM user_vacancies uv
    JOIN vacancies v ON v.id = uv.vacancy_id
    WHERE uv.user_id = ? AND uv.notified = 0 AND uv.status = 'new' AND uv.score >= ?
    ORDER BY uv.score DESC
  `).all(userId, minScore) as any[];
  return rows.map(rowToScoredVacancy);
}

export function markVacanciesNotified(userId: number, vacancyIds: number[]): void {
  if (vacancyIds.length === 0) return;
  const placeholders = vacancyIds.map(() => '?').join(',');
  getDb().prepare(`
    UPDATE user_vacancies SET notified = 1
    WHERE user_id = ? AND vacancy_id IN (${placeholders})
  `).run(userId, ...vacancyIds);
}

export function getDigestSummary(userId: number): { total: number; highScore: number } {
  const d = getDb();
  const total = (d.prepare(`
    SELECT COUNT(*) as c FROM user_vacancies
    WHERE user_id = ? AND notified = 0 AND status = 'new' AND score >= 40
  `).get(userId) as any).c;

  const highScore = (d.prepare(`
    SELECT COUNT(*) as c FROM user_vacancies
    WHERE user_id = ? AND notified = 0 AND status = 'new' AND score >= 70
  `).get(userId) as any).c;

  return { total, highScore };
}

export interface UserStats {
  total: number;
  relevant: number;
  applied: number;
  rejected: number;
  avgScore: number;
  coverLetters: number;
  sources: Record<string, number>;
}

export function getUserStats(userId: number): UserStats {
  const d = getDb();

  const total = (d.prepare(
    'SELECT COUNT(*) as c FROM user_vacancies WHERE user_id = ?'
  ).get(userId) as any).c;

  const relevant = (d.prepare(
    'SELECT COUNT(*) as c FROM user_vacancies WHERE user_id = ? AND score >= 40'
  ).get(userId) as any).c;

  const applied = (d.prepare(
    "SELECT COUNT(*) as c FROM user_vacancies WHERE user_id = ? AND status = 'applied'"
  ).get(userId) as any).c;

  const rejected = (d.prepare(
    "SELECT COUNT(*) as c FROM user_vacancies WHERE user_id = ? AND status = 'rejected'"
  ).get(userId) as any).c;

  const avgRow = d.prepare(
    'SELECT AVG(score) as avg FROM user_vacancies WHERE user_id = ? AND score > 0'
  ).get(userId) as any;
  const avgScore = Math.round(avgRow?.avg ?? 0);

  const coverLetters = (d.prepare(
    'SELECT COUNT(*) as c FROM cover_letters WHERE user_id = ?'
  ).get(userId) as any).c;

  const sourceRows = d.prepare(`
    SELECT v.source, COUNT(*) as c
    FROM user_vacancies uv JOIN vacancies v ON v.id = uv.vacancy_id
    WHERE uv.user_id = ?
    GROUP BY v.source
  `).all(userId) as { source: string; c: number }[];

  const sources: Record<string, number> = {};
  for (const r of sourceRows) sources[r.source] = r.c;

  return { total, relevant, applied, rejected, avgScore, coverLetters, sources };
}

function rowToScoredVacancy(row: any): ScoredVacancy {
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id,
    title: row.title,
    company: row.company,
    salaryFrom: row.salary_from,
    salaryTo: row.salary_to,
    salaryCurrency: row.salary_currency,
    format: row.format,
    city: row.city,
    description: row.description,
    skills: safeJsonParse(row.skills),
    url: row.url,
    publishedAt: new Date(row.published_at),
    experience: row.experience,
    score: row.score,
    scoreSkills: row.score_skills,
    scoreSalary: row.score_salary,
    scoreFormat: row.score_format,
    scoreDomain: row.score_domain ?? 0,
    status: row.status,
    createdAt: new Date(row.uv_created_at ?? row.created_at),
  };
}
