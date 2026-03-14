import { logger } from '../logger';
import { scoreVacancy } from '../scorer';
import { upsertVacancy, upsertUserVacancy, getAllUsers, getRecentVacancyIds, getVacancyById } from '../db';
import type { UserProfile, Vacancy } from '../types';
import { HhScraper } from './hh';
import { HabrScraper } from './habr';

export interface ScrapeResult {
  source: string;
  found: number;
  new: number;
  errors: string[];
}

/**
 * Build unique search queries from users' custom queries or titles.
 * Uses user.searchQueries if set, otherwise falls back to title.
 */
function buildSearchQueries(users: UserProfile[]): string[] {
  const queries = new Set<string>();

  for (const user of users) {
    // Prefer custom search queries
    if (user.searchQueries.length > 0) {
      for (const q of user.searchQueries) {
        queries.add(q.trim());
      }
    } else if (user.title) {
      queries.add(user.title.trim());
    }
  }

  return [...queries];
}

/** Run all scrapers with optional progress callback */
export async function runScrapersWithProgress(
  onProgress?: (source: string, step: string) => Promise<void>,
): Promise<ScrapeResult[]> {
  return runAllScrapers(onProgress);
}

/** Run all scrapers, save vacancies, score for all users */
export async function runAllScrapers(
  onProgress?: (source: string, step: string) => Promise<void>,
): Promise<ScrapeResult[]> {
  const users = getAllUsers();

  if (users.length === 0) {
    logger.warn('runner', 'No registered users, skipping scrape');
    return [];
  }

  const queries = buildSearchQueries(users);
  if (queries.length === 0) {
    logger.warn('runner', 'No search queries from users, skipping scrape');
    return [];
  }

  logger.info('runner', `Scraping for ${users.length} users, ${queries.length} queries`, {
    queries: queries.join(', '),
  });

  const results: ScrapeResult[] = [];

  // Run scrapers
  const scrapers = [new HhScraper(queries), new HabrScraper(queries)];

  for (let i = 0; i < scrapers.length; i++) {
    if (i > 0) await sleep(2000);
    if (onProgress) await onProgress(scrapers[i].source, scrapers[i].source);
    const result = await runScraper(scrapers[i]);
    results.push(result);
  }

  // Score recent vacancies for all users
  if (onProgress) await onProgress('scoring', 'scoring');
  scoreForAllUsers(users);

  return results;
}

async function runScraper(scraper: { source: string; scrape(): Promise<Vacancy[]> }): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    source: scraper.source,
    found: 0,
    new: 0,
    errors: [],
  };

  try {
    logger.info('runner', `Starting ${scraper.source} scraper`);
    const vacancies = await scraper.scrape();
    result.found = vacancies.length;

    for (const vacancy of vacancies) {
      try {
        const { inserted } = upsertVacancy(vacancy);
        if (inserted) result.new++;
      } catch (err) {
        result.errors.push(`${vacancy.externalId}: ${String(err)}`);
      }
    }

    logger.info('runner', `${scraper.source}: found=${result.found}, new=${result.new}`);
  } catch (err) {
    const errMsg = String(err);
    result.errors.push(errMsg);
    logger.error('runner', `${scraper.source} failed`, { error: errMsg });
  }

  return result;
}

/** Score recent vacancies for all users */
export function scoreForAllUsers(users?: UserProfile[]): void {
  const allUsers = users ?? getAllUsers();
  const vacancyIds = getRecentVacancyIds();

  if (vacancyIds.length === 0 || allUsers.length === 0) return;

  let scored = 0;

  for (const user of allUsers) {
    for (const vacancyId of vacancyIds) {
      const vacancy = getVacancyById(vacancyId);
      if (!vacancy) continue;

      const result = scoreVacancy(vacancy, user);
      upsertUserVacancy(user.id, vacancyId, result.total, result.skills, result.salary, result.format, result.domain);
      scored++;
    }
  }

  logger.info('runner', `Scored ${scored} user-vacancy pairs (${allUsers.length} users x ${vacancyIds.length} vacancies)`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
