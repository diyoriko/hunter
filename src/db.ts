import Database from 'better-sqlite3';
import { CONFIG } from './config';
import { logger } from './logger';
import type { ScoredVacancy, Vacancy, VacancyStatus, VacancySource } from './types';

let db: Database.Database;

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
      score           INTEGER NOT NULL DEFAULT 0,
      score_skills    INTEGER NOT NULL DEFAULT 0,
      score_salary    INTEGER NOT NULL DEFAULT 0,
      score_format    INTEGER NOT NULL DEFAULT 0,
      score_domain    INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'new',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_vacancies_score ON vacancies(score DESC);
    CREATE INDEX IF NOT EXISTS idx_vacancies_status ON vacancies(status);
    CREATE INDEX IF NOT EXISTS idx_vacancies_created ON vacancies(created_at DESC);

    CREATE TABLE IF NOT EXISTS scrape_runs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      source     TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      found      INTEGER NOT NULL DEFAULT 0,
      new_count  INTEGER NOT NULL DEFAULT 0,
      error      TEXT
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      vacancy_id  INTEGER NOT NULL REFERENCES vacancies(id),
      action      TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cover_letters (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      vacancy_id  INTEGER NOT NULL UNIQUE REFERENCES vacancies(id),
      text        TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  logger.info('db', 'Schema initialized');
}

// --- Vacancy CRUD ---

const upsertStmt = () => getDb().prepare(`
  INSERT INTO vacancies (
    source, external_id, title, company,
    salary_from, salary_to, salary_currency,
    format, city, description, skills, url,
    published_at, experience,
    score, score_skills, score_salary, score_format, score_domain
  ) VALUES (
    @source, @externalId, @title, @company,
    @salaryFrom, @salaryTo, @salaryCurrency,
    @format, @city, @description, @skills, @url,
    @publishedAt, @experience,
    @score, @scoreSkills, @scoreSalary, @scoreFormat, @scoreDomain
  )
  ON CONFLICT(source, external_id) DO UPDATE SET
    title = excluded.title,
    salary_from = excluded.salary_from,
    salary_to = excluded.salary_to,
    score = excluded.score,
    score_skills = excluded.score_skills,
    score_salary = excluded.score_salary,
    score_format = excluded.score_format,
    score_domain = excluded.score_domain
`);

export function upsertVacancy(v: Vacancy & {
  score: number;
  scoreSkills: number;
  scoreSalary: number;
  scoreFormat: number;
  scoreDomain: number;
}): { inserted: boolean } {
  const existing = getDb()
    .prepare('SELECT id FROM vacancies WHERE source = ? AND external_id = ?')
    .get(v.source, v.externalId);

  upsertStmt().run({
    source: v.source,
    externalId: v.externalId,
    title: v.title,
    company: v.company,
    salaryFrom: v.salaryFrom,
    salaryTo: v.salaryTo,
    salaryCurrency: v.salaryCurrency,
    format: v.format,
    city: v.city,
    description: v.description,
    skills: JSON.stringify(v.skills),
    url: v.url,
    publishedAt: v.publishedAt.toISOString(),
    experience: v.experience,
    score: v.score,
    scoreSkills: v.scoreSkills,
    scoreSalary: v.scoreSalary,
    scoreFormat: v.scoreFormat,
    scoreDomain: v.scoreDomain,
  });

  return { inserted: !existing };
}

export function getTopVacancies(limit: number, status: VacancyStatus = 'new'): ScoredVacancy[] {
  const rows = getDb()
    .prepare(`
      SELECT * FROM vacancies
      WHERE status = ?
      ORDER BY score DESC
      LIMIT ?
    `)
    .all(status, limit) as any[];

  return rows.map(rowToVacancy);
}

export function getTodayNewVacancies(): ScoredVacancy[] {
  const rows = getDb()
    .prepare(`
      SELECT * FROM vacancies
      WHERE status = 'new'
        AND created_at >= date('now', 'start of day')
      ORDER BY score DESC
    `)
    .all() as any[];

  return rows.map(rowToVacancy);
}

export function getVacancyById(id: number): ScoredVacancy | null {
  const row = getDb()
    .prepare('SELECT * FROM vacancies WHERE id = ?')
    .get(id) as any;

  return row ? rowToVacancy(row) : null;
}

export function updateVacancyStatus(id: number, status: VacancyStatus): void {
  getDb()
    .prepare('UPDATE vacancies SET status = ? WHERE id = ?')
    .run(status, id);

  getDb()
    .prepare('INSERT INTO feedback (vacancy_id, action) VALUES (?, ?)')
    .run(id, status);
}

export function getStats(): {
  total: number;
  new: number;
  liked: number;
  applied: number;
  rejected: number;
  avgScore: number;
  sources: Record<string, number>;
} {
  const db = getDb();

  const total = (db.prepare('SELECT COUNT(*) as c FROM vacancies').get() as any).c;
  const newCount = (db.prepare("SELECT COUNT(*) as c FROM vacancies WHERE status = 'new'").get() as any).c;
  const liked = (db.prepare("SELECT COUNT(*) as c FROM vacancies WHERE status = 'liked'").get() as any).c;
  const applied = (db.prepare("SELECT COUNT(*) as c FROM vacancies WHERE status = 'applied'").get() as any).c;
  const rejected = (db.prepare("SELECT COUNT(*) as c FROM vacancies WHERE status = 'rejected'").get() as any).c;
  const avgScore = (db.prepare('SELECT AVG(score) as a FROM vacancies').get() as any).a || 0;

  const sourceRows = db.prepare('SELECT source, COUNT(*) as c FROM vacancies GROUP BY source').all() as any[];
  const sources: Record<string, number> = {};
  for (const r of sourceRows) sources[r.source] = r.c;

  return { total, new: newCount, liked, applied, rejected, avgScore: Math.round(avgScore), sources };
}

// --- Scrape runs ---

export function startScrapeRun(source: VacancySource): number {
  const result = getDb()
    .prepare('INSERT INTO scrape_runs (source) VALUES (?)')
    .run(source);
  return Number(result.lastInsertRowid);
}

export function finishScrapeRun(id: number, found: number, newCount: number, error?: string): void {
  getDb()
    .prepare(`
      UPDATE scrape_runs SET
        finished_at = datetime('now'),
        found = ?,
        new_count = ?,
        error = ?
      WHERE id = ?
    `)
    .run(found, newCount, error ?? null, id);
}

// --- Helpers ---

function rowToVacancy(row: any): ScoredVacancy {
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
    skills: JSON.parse(row.skills || '[]'),
    url: row.url,
    publishedAt: new Date(row.published_at),
    experience: row.experience,
    score: row.score,
    scoreSkills: row.score_skills,
    scoreSalary: row.score_salary,
    scoreFormat: row.score_format,
    scoreDomain: row.score_domain,
    status: row.status,
    createdAt: new Date(row.created_at),
  };
}
