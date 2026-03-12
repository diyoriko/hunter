/** Normalized vacancy from any source */
export interface Vacancy {
  /** Source platform */
  source: VacancySource;
  /** External ID on the source platform */
  externalId: string;
  /** Job title */
  title: string;
  /** Company name */
  company: string;
  /** Salary range (RUB/month) */
  salaryFrom: number | null;
  salaryTo: number | null;
  /** Currency (RUB, USD, EUR) */
  salaryCurrency: string | null;
  /** Work format */
  format: WorkFormat;
  /** City (null = remote) */
  city: string | null;
  /** Full description HTML */
  description: string;
  /** Required skills/tags */
  skills: string[];
  /** Direct URL to vacancy */
  url: string;
  /** When published */
  publishedAt: Date;
  /** Experience level */
  experience: ExperienceLevel | null;
}

export type VacancySource =
  | 'hh.ru'
  | 'habr'
  | 'designer.ru'
  | 'dprofile'
  | 'telegram'
  | 'arc.dev'
  | 'weloveproduct';

export type WorkFormat = 'remote' | 'office' | 'hybrid' | 'unknown';

export type ExperienceLevel = 'junior' | 'middle' | 'senior' | 'lead' | 'unknown';

/** Stored vacancy with scoring */
export interface ScoredVacancy extends Vacancy {
  id: number;
  /** Total score 0-100 */
  score: number;
  /** Individual score breakdown */
  scoreSkills: number;
  scoreSalary: number;
  scoreFormat: number;
  scoreDomain: number;
  /** User action */
  status: VacancyStatus;
  /** When first scraped */
  createdAt: Date;
}

export type VacancyStatus = 'new' | 'liked' | 'applied' | 'rejected' | 'expired';

/** Scraper interface — all scrapers implement this */
export interface Scraper {
  readonly source: VacancySource;
  scrape(): Promise<Vacancy[]>;
}
