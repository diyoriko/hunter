import { logger } from '../logger';
import { scoreVacancy } from '../scorer';
import { upsertVacancy, startScrapeRun, finishScrapeRun, getTodayNewVacancies } from '../db';
import { generateBatch } from '../cover-letter';
import type { Scraper, Vacancy } from '../types';
import { HhScraper } from './hh';

/** All available scrapers */
function createScrapers(): Scraper[] {
  return [
    new HhScraper(),
    // Phase 2: new HabrScraper(),
    // Phase 3: new TelegramScraper(),
  ];
}

export interface ScrapeResult {
  source: string;
  found: number;
  new: number;
  errors: string[];
  topScore: number;
}

/** Run all scrapers, score results, save to DB */
export async function runAllScrapers(): Promise<ScrapeResult[]> {
  const scrapers = createScrapers();
  const results: ScrapeResult[] = [];

  for (const scraper of scrapers) {
    const result = await runScraper(scraper);
    results.push(result);
  }

  // Generate cover letters for top vacancies (score >= 60)
  const topNew = getTodayNewVacancies().filter(v => v.score >= 60);
  if (topNew.length > 0) {
    const generated = await generateBatch(topNew);
    logger.info('runner', `Cover letters generated: ${generated}/${topNew.length}`);
  }

  return results;
}

async function runScraper(scraper: Scraper): Promise<ScrapeResult> {
  const runId = startScrapeRun(scraper.source);
  const result: ScrapeResult = {
    source: scraper.source,
    found: 0,
    new: 0,
    errors: [],
    topScore: 0,
  };

  try {
    logger.info('runner', `Starting ${scraper.source} scraper`);
    const vacancies = await scraper.scrape();
    result.found = vacancies.length;

    for (const vacancy of vacancies) {
      try {
        const score = scoreVacancy(vacancy);
        const { inserted } = upsertVacancy({
          ...vacancy,
          score: score.total,
          scoreSkills: score.skills,
          scoreSalary: score.salary,
          scoreFormat: score.format,
          scoreDomain: score.domain,
        });

        if (inserted) result.new++;
        if (score.total > result.topScore) result.topScore = score.total;
      } catch (err) {
        result.errors.push(`${vacancy.externalId}: ${String(err)}`);
      }
    }

    finishScrapeRun(runId, result.found, result.new);
    logger.info('runner', `${scraper.source}: found=${result.found}, new=${result.new}, top=${result.topScore}`);
  } catch (err) {
    const errMsg = String(err);
    result.errors.push(errMsg);
    finishScrapeRun(runId, 0, 0, errMsg);
    logger.error('runner', `${scraper.source} failed`, { error: errMsg });
  }

  return result;
}
