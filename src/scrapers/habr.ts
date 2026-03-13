import { logger } from '../logger';
import type { Vacancy, WorkFormat, ExperienceLevel } from '../types';
import type { Scraper } from './types';

const BASE_URL = 'https://career.habr.com/api/frontend/vacancies';
const DELAY_MS = 500;
const MAX_PAGES = 3;

interface HabrVacancy {
  id: number;
  href: string;
  title: string;
  remoteWork: boolean;
  company: {
    title: string;
    href: string;
  };
  salary: {
    from: number | null;
    to: number | null;
    currency: string;
    formatted: string;
  } | null;
  qualification: string | null;
  skills: { title: string }[];
  publishedDate: {
    date: string;
  };
  location: {
    title: string;
  } | null;
  employment: string;
}

interface HabrResponse {
  list: HabrVacancy[];
  meta: {
    totalResults: number;
    perPage: number;
    currentPage: number;
    totalPages: number;
  };
}

/**
 * Multi-user Habr scraper.
 * Takes search queries derived from all users' profiles.
 */
export class HabrScraper implements Scraper {
  readonly source = 'habr' as const;

  constructor(private readonly queries: string[]) {}

  async scrape(): Promise<Vacancy[]> {
    const allVacancies: Vacancy[] = [];
    const seenIds = new Set<string>();

    for (const query of this.queries) {
      try {
        const vacancies = await this.searchQuery(query);
        for (const v of vacancies) {
          if (!seenIds.has(v.externalId)) {
            seenIds.add(v.externalId);
            allVacancies.push(v);
          }
        }
        logger.info('habr', `Query "${query}": ${vacancies.length} found, ${seenIds.size} unique total`);
      } catch (err) {
        logger.error('habr', `Query "${query}" failed`, { error: String(err) });
      }

      await sleep(DELAY_MS);
    }

    logger.info('habr', `Scrape complete: ${allVacancies.length} vacancies`);
    return allVacancies;
  }

  private async searchQuery(query: string): Promise<Vacancy[]> {
    const vacancies: Vacancy[] = [];
    let page = 1;

    while (page <= MAX_PAGES) {
      const params = new URLSearchParams({
        q: query,
        type: 'all',
        sort: 'relevance',
        page: String(page),
      });

      const url = `${BASE_URL}?${params}`;

      try {
        const response = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          },
        });

        if (!response.ok) {
          logger.warn('habr', `Search returned ${response.status}`, { query, page });
          break;
        }

        const data = await response.json() as HabrResponse;

        for (const item of data.list) {
          vacancies.push(habrToVacancy(item));
        }

        if (page >= data.meta.totalPages) break;
        page++;
        await sleep(DELAY_MS);
      } catch (err) {
        logger.error('habr', `Page ${page} failed for "${query}"`, { error: String(err) });
        break;
      }
    }

    return vacancies;
  }
}

function habrToVacancy(item: HabrVacancy): Vacancy {
  return {
    source: 'habr',
    externalId: String(item.id),
    title: item.title,
    company: item.company?.title ?? 'Unknown',
    salaryFrom: item.salary?.from ?? null,
    salaryTo: item.salary?.to ?? null,
    salaryCurrency: normalizeCurrency(item.salary?.currency),
    format: item.remoteWork ? 'remote' : 'office',
    city: item.location?.title ?? null,
    description: item.skills.map(s => s.title).join(', '),
    skills: item.skills.map(s => s.title),
    url: `https://career.habr.com${item.href}`,
    publishedAt: new Date(item.publishedDate.date),
    experience: parseQualification(item.qualification),
  };
}

function parseQualification(q: string | null): ExperienceLevel | null {
  if (!q) return null;
  const lower = q.toLowerCase();
  if (lower.includes('junior') || lower.includes('intern')) return 'junior';
  if (lower.includes('middle') || lower.includes('средн')) return 'middle';
  if (lower.includes('senior') || lower.includes('старш')) return 'senior';
  if (lower.includes('lead') || lower.includes('ведущ')) return 'lead';
  return 'unknown';
}

function normalizeCurrency(currency: string | undefined): string | null {
  if (!currency) return null;
  switch (currency.toLowerCase()) {
    case 'rur':
    case 'rub': return 'RUB';
    case 'usd': return 'USD';
    case 'eur': return 'EUR';
    default: return currency.toUpperCase();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
