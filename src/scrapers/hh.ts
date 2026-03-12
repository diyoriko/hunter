import { CONFIG } from '../config';
import { PROFILE } from '../profile';
import { logger } from '../logger';
import type { Vacancy, WorkFormat, ExperienceLevel } from '../types';
import type { Scraper, HhSearchResponse, HhVacancyFull } from './types';

const AREA_RUSSIA = '113';
const PER_PAGE = 100;
const MAX_PAGES = 5; // 500 vacancies max per query
const DELAY_MS = 300; // be nice to the API

export class HhScraper implements Scraper {
  readonly source = 'hh.ru' as const;

  async scrape(): Promise<Vacancy[]> {
    const allVacancies: Vacancy[] = [];
    const seenIds = new Set<string>();

    for (const query of PROFILE.searchQueries) {
      try {
        const vacancies = await this.searchQuery(query);
        for (const v of vacancies) {
          if (!seenIds.has(v.externalId)) {
            seenIds.add(v.externalId);
            allVacancies.push(v);
          }
        }
        logger.info('hh', `Query "${query}": ${vacancies.length} found, ${seenIds.size} unique total`);
      } catch (err) {
        logger.error('hh', `Query "${query}" failed`, { error: String(err) });
      }

      await sleep(DELAY_MS);
    }

    // Fetch full descriptions for top candidates (based on snippet pre-scoring)
    const withDescriptions = await this.enrichDescriptions(allVacancies);

    logger.info('hh', `Scrape complete: ${withDescriptions.length} vacancies`);
    return withDescriptions;
  }

  private async searchQuery(query: string): Promise<Vacancy[]> {
    const vacancies: Vacancy[] = [];
    let page = 0;

    while (page < MAX_PAGES) {
      const params = new URLSearchParams({
        text: query,
        area: AREA_RUSSIA,
        per_page: String(PER_PAGE),
        page: String(page),
        order_by: 'relevance',
        period: '3', // last 3 days
        only_with_salary: 'false',
        search_field: 'name', // search in title only for precision
      });

      // Prefer remote
      const url = `${CONFIG.hhBaseUrl}/vacancies?${params}`;
      const response = await fetchWithRetry(url);

      if (!response.ok) {
        logger.warn('hh', `Search returned ${response.status}`, { query, page });
        break;
      }

      const data = await response.json() as HhSearchResponse;

      for (const item of data.items) {
        vacancies.push(hhToVacancy(item));
      }

      if (page >= data.pages - 1) break;
      page++;
      await sleep(DELAY_MS);
    }

    return vacancies;
  }

  /**
   * Fetch full vacancy descriptions for better scoring.
   * Only fetches for vacancies that look promising based on snippet.
   */
  private async enrichDescriptions(vacancies: Vacancy[]): Promise<Vacancy[]> {
    let enriched = 0;
    const BATCH_SIZE = 20; // Don't hammer the API

    for (const v of vacancies) {
      if (enriched >= BATCH_SIZE) break;

      try {
        const url = `${CONFIG.hhBaseUrl}/vacancies/${v.externalId}`;
        const response = await fetchWithRetry(url);

        if (response.ok) {
          const full = await response.json() as HhVacancyFull;
          v.description = full.description || v.description;
          v.skills = full.key_skills?.map(s => s.name) ?? v.skills;
          enriched++;
        }

        await sleep(DELAY_MS);
      } catch {
        // Skip enrichment on error, snippet is enough
      }
    }

    logger.info('hh', `Enriched ${enriched}/${vacancies.length} descriptions`);
    return vacancies;
  }
}

function hhToVacancy(item: any): Vacancy {
  return {
    source: 'hh.ru',
    externalId: item.id,
    title: item.name,
    company: item.employer?.name ?? 'Unknown',
    salaryFrom: item.salary?.from ?? null,
    salaryTo: item.salary?.to ?? null,
    salaryCurrency: normalizeCurrency(item.salary?.currency),
    format: parseFormat(item.schedule?.id, item.name, item.snippet),
    city: item.area?.name ?? null,
    description: [item.snippet?.requirement, item.snippet?.responsibility]
      .filter(Boolean)
      .join('\n'),
    skills: [],
    url: item.alternate_url,
    publishedAt: new Date(item.published_at),
    experience: parseExperience(item.experience?.id),
  };
}

function parseFormat(scheduleId: string | undefined, title: string, snippet: any): WorkFormat {
  if (scheduleId === 'remote') return 'remote';
  if (scheduleId === 'flexible') return 'hybrid';

  // Check title and description for remote signals
  const text = `${title} ${snippet?.requirement ?? ''} ${snippet?.responsibility ?? ''}`.toLowerCase();
  if (text.includes('удалённ') || text.includes('удаленн') || text.includes('remote')) return 'remote';
  if (text.includes('гибрид') || text.includes('hybrid')) return 'hybrid';

  if (scheduleId === 'fullDay') return 'office';
  return 'unknown';
}

function parseExperience(expId: string | undefined): ExperienceLevel | null {
  switch (expId) {
    case 'noExperience': return 'junior';
    case 'between1And3': return 'middle';
    case 'between3And6': return 'senior';
    case 'moreThan6': return 'lead';
    default: return null;
  }
}

function normalizeCurrency(currency: string | undefined): string | null {
  if (!currency) return null;
  switch (currency.toUpperCase()) {
    case 'RUR':
    case 'RUB': return 'RUB';
    case 'USD': return 'USD';
    case 'EUR': return 'EUR';
    default: return currency;
  }
}

async function fetchWithRetry(url: string, retries = 2): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': CONFIG.hhUserAgent,
          'Accept': 'application/json',
        },
      });

      if (response.status === 429) {
        // Rate limited — wait and retry
        const wait = Math.pow(2, i) * 1000;
        logger.warn('hh', `Rate limited, waiting ${wait}ms`);
        await sleep(wait);
        continue;
      }

      return response;
    } catch (err) {
      if (i === retries) throw err;
      await sleep(1000);
    }
  }
  throw new Error('fetchWithRetry exhausted');
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
