// --- User Profile (built via onboarding) ---

export interface SkillWeight {
  name: string;
  weight: number;
}

export interface DomainWeight {
  name: string;
  weight: number;
}

export interface UserProfile {
  id: number;
  telegramId: number;
  name: string;
  title: string;
  yearsExperience: number;
  skills: string[];
  /** Skills with weights (auto-assigned from order, top skill = 1.0) */
  skillWeights: SkillWeight[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  preferredFormat: WorkFormat | 'any';
  /** Preferred industry domains with relevance weights */
  domains: DomainWeight[];
  /** Keywords that indicate irrelevant vacancies (e.g. "junior", "3D", "game design") */
  redFlags: string[];
  /** Companies to exclude from results */
  companyBlacklist: string[];
  /** Custom search queries (e.g. "product designer", "UX/UI senior") */
  searchQueries: string[];
  portfolio: string | null;
  /** Free-text about their experience — used in cover letter prompt */
  about: string | null;
  /** Onboarding state machine */
  onboardingState: OnboardingState;
  createdAt: Date;
}

export type OnboardingState =
  | 'new'
  | 'awaiting_name'
  | 'awaiting_title'
  | 'awaiting_experience'
  | 'awaiting_skills'
  | 'awaiting_salary'
  | 'awaiting_format'
  | 'awaiting_domains'
  | 'awaiting_red_flags'
  | 'awaiting_blacklist'
  | 'awaiting_queries'
  | 'awaiting_portfolio'
  | 'awaiting_about'
  | 'complete';

// --- Vacancy ---

export type VacancySource = 'hh.ru' | 'habr';
export type WorkFormat = 'remote' | 'hybrid' | 'office' | 'unknown';
export type ExperienceLevel = 'junior' | 'middle' | 'senior' | 'lead' | 'unknown';
export type VacancyStatus = 'new' | 'applied' | 'rejected';

export interface Vacancy {
  source: VacancySource;
  externalId: string;
  title: string;
  company: string;
  salaryFrom: number | null;
  salaryTo: number | null;
  salaryCurrency: string | null;
  format: WorkFormat;
  city: string | null;
  description: string;
  skills: string[];
  url: string;
  publishedAt: Date;
  experience: ExperienceLevel | null;
}

export interface ScoredVacancy extends Vacancy {
  id: number;
  score: number;
  scoreSkills: number;
  scoreSalary: number;
  scoreFormat: number;
  scoreDomain: number;
  status: VacancyStatus;
  createdAt: Date;
}

export interface Scraper {
  readonly source: VacancySource;
  scrape(): Promise<Vacancy[]>;
}
