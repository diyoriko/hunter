import type { Scraper } from '../types';

export type { Scraper };

/** hh.ru API response types */
export interface HhSearchResponse {
  items: HhVacancy[];
  found: number;
  pages: number;
  per_page: number;
  page: number;
}

export interface HhVacancy {
  id: string;
  name: string;
  employer: {
    id: string;
    name: string;
    url: string;
  };
  salary: {
    from: number | null;
    to: number | null;
    currency: string;
    gross: boolean;
  } | null;
  schedule: {
    id: string;
    name: string;
  } | null;
  area: {
    id: string;
    name: string;
  };
  snippet: {
    requirement: string | null;
    responsibility: string | null;
  };
  alternate_url: string;
  published_at: string;
  experience: {
    id: string;
    name: string;
  } | null;
  key_skills?: { name: string }[];
  description?: string;
}

export interface HhVacancyFull extends HhVacancy {
  description: string;
  key_skills: { name: string }[];
}
