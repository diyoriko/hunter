import { describe, it, expect } from 'vitest';
import { scoreVacancy } from './scorer';
import type { Vacancy, UserProfile } from './types';

// --- Factories ---

function makeUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 1,
    telegramId: 111,
    name: 'Test User',
    title: 'Product Designer',
    yearsExperience: 5,
    skills: ['Figma', 'UI/UX', 'Prototyping'],
    skillWeights: [],
    salaryMin: 200_000,
    salaryMax: 400_000,
    salaryCurrency: 'RUB',
    preferredFormat: 'remote',
    domains: [],
    redFlags: [],
    companyBlacklist: [],
    searchQueries: ['product designer'],
    portfolio: null,
    about: null,
    onboardingState: 'complete',
    createdAt: new Date(),
    plan: 'free',
    planExpiresAt: null,
    lettersUsed: 0,
    credits: 0,
    ...overrides,
  };
}

function makeVacancy(overrides: Partial<Vacancy> = {}): Vacancy {
  return {
    source: 'hh.ru',
    externalId: '123',
    title: 'Product Designer',
    company: 'TechCorp',
    salaryFrom: 250_000,
    salaryTo: 350_000,
    salaryCurrency: 'RUB',
    format: 'remote',
    city: 'Москва',
    description: 'Ищем product designer. Figma, UI/UX, прототипирование.',
    skills: ['Figma', 'UI/UX'],
    url: 'https://hh.ru/vacancy/123',
    publishedAt: new Date(),
    experience: 'middle',
    ...overrides,
  };
}

// --- Tests ---

describe('scoreVacancy', () => {
  describe('total score', () => {
    it('returns a score between 0 and 100', () => {
      const result = scoreVacancy(makeVacancy(), makeUser());
      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(result.total).toBeLessThanOrEqual(100);
    });

    it('gives high score for a good match', () => {
      const result = scoreVacancy(makeVacancy(), makeUser());
      expect(result.total).toBeGreaterThanOrEqual(60);
    });

    it('returns all sub-scores', () => {
      const result = scoreVacancy(makeVacancy(), makeUser());
      expect(result).toHaveProperty('skills');
      expect(result).toHaveProperty('salary');
      expect(result).toHaveProperty('format');
      expect(result).toHaveProperty('domain');
    });
  });

  describe('blacklist', () => {
    it('returns 0 for blacklisted company', () => {
      const user = makeUser({ companyBlacklist: ['TechCorp'] });
      const result = scoreVacancy(makeVacancy(), user);
      expect(result.total).toBe(0);
    });

    it('matches case-insensitively', () => {
      const user = makeUser({ companyBlacklist: ['techcorp'] });
      const result = scoreVacancy(makeVacancy({ company: 'TechCorp' }), user);
      expect(result.total).toBe(0);
    });

    it('matches partial company name', () => {
      const user = makeUser({ companyBlacklist: ['Tech'] });
      const result = scoreVacancy(makeVacancy({ company: 'TechCorp' }), user);
      expect(result.total).toBe(0);
    });
  });

  describe('title relevance', () => {
    it('filters out developer vacancies for designer users', () => {
      const result = scoreVacancy(
        makeVacancy({ title: 'Backend Developer' }),
        makeUser({ title: 'UX Designer' }),
      );
      expect(result.total).toBe(0);
    });

    it('keeps UX/UI Developer (has design keywords)', () => {
      const result = scoreVacancy(
        makeVacancy({ title: 'UX/UI Developer' }),
        makeUser({ title: 'UX Designer' }),
      );
      expect(result.total).toBeGreaterThan(0);
    });

    it('does not filter for non-designer users', () => {
      const result = scoreVacancy(
        makeVacancy({ title: 'Backend Developer' }),
        makeUser({ title: 'Backend Developer', skills: ['Node.js', 'TypeScript'] }),
      );
      expect(result.total).toBeGreaterThan(0);
    });
  });

  describe('red flags', () => {
    it('halves the score when red flags found in title', () => {
      const noFlags = scoreVacancy(makeVacancy(), makeUser());
      const withFlags = scoreVacancy(
        makeVacancy({ title: 'Junior Product Designer' }),
        makeUser({ redFlags: ['junior'] }),
      );
      // With red flag the score should be roughly half
      expect(withFlags.total).toBeLessThan(noFlags.total);
      expect(withFlags.total).toBeGreaterThan(0);
    });

    it('halves the score when red flags found in description', () => {
      const result = scoreVacancy(
        makeVacancy({ description: 'Looking for someone for 3D modeling and game design' }),
        makeUser({ redFlags: ['3d'] }),
      );
      // Should be penalized but not zero
      expect(result.total).toBeGreaterThan(0);
    });

    it('no penalty without red flags', () => {
      const user = makeUser({ redFlags: ['3d', 'game design'] });
      const result = scoreVacancy(makeVacancy(), user);
      // No red flags in vacancy, so no penalty
      expect(result.total).toBeGreaterThanOrEqual(60);
    });
  });

  describe('skills scoring', () => {
    it('scores higher with more skill matches', () => {
      const allMatch = scoreVacancy(
        makeVacancy({ description: 'Figma, UI/UX, Prototyping needed', skills: ['Figma', 'UI/UX'] }),
        makeUser({ skills: ['Figma', 'UI/UX', 'Prototyping'] }),
      );
      const noMatch = scoreVacancy(
        makeVacancy({ description: 'Java, Spring Boot, AWS', skills: ['Java'] }),
        makeUser({ skills: ['Figma', 'UI/UX', 'Prototyping'] }),
      );
      expect(allMatch.skills).toBeGreaterThan(noMatch.skills);
    });

    it('returns 50 when user has no skills', () => {
      const result = scoreVacancy(makeVacancy(), makeUser({ skills: [] }));
      expect(result.skills).toBe(50);
    });

    it('uses skillWeights when provided', () => {
      const user = makeUser({
        skills: [],
        skillWeights: [
          { name: 'Figma', weight: 1.0 },
          { name: 'Sketch', weight: 0.5 },
        ],
      });
      const result = scoreVacancy(
        makeVacancy({ description: 'Figma expert needed' }),
        user,
      );
      expect(result.skills).toBeGreaterThan(50);
    });
  });

  describe('salary scoring', () => {
    it('returns 100 when vacancy salary falls within user range', () => {
      const result = scoreVacancy(
        makeVacancy({ salaryFrom: 250_000, salaryTo: 350_000 }),
        makeUser({ salaryMin: 200_000, salaryMax: 400_000 }),
      );
      expect(result.salary).toBe(100);
    });

    it('returns 70 when user has no salary preference', () => {
      const result = scoreVacancy(
        makeVacancy(),
        makeUser({ salaryMin: null, salaryMax: null }),
      );
      expect(result.salary).toBe(70);
    });

    it('returns 50 when vacancy has no salary', () => {
      const result = scoreVacancy(
        makeVacancy({ salaryFrom: null, salaryTo: null }),
        makeUser(),
      );
      expect(result.salary).toBe(50);
    });

    it('tiered penalty for above-range: up to 30% over → 75', () => {
      // User max is 400k, vacancy mid = 500k → 25% over → 75
      const result = scoreVacancy(
        makeVacancy({ salaryFrom: 480_000, salaryTo: 520_000 }),
        makeUser({ salaryMin: 200_000, salaryMax: 400_000 }),
      );
      expect(result.salary).toBe(75);
    });

    it('tiered penalty for above-range: 30-60% over → 50', () => {
      // User max is 400k, vacancy mid = 600k → 50% over → 50
      const result = scoreVacancy(
        makeVacancy({ salaryFrom: 560_000, salaryTo: 640_000 }),
        makeUser({ salaryMin: 200_000, salaryMax: 400_000 }),
      );
      expect(result.salary).toBe(50);
    });

    it('tiered penalty for above-range: 60%+ over → 30', () => {
      // User max is 400k, vacancy mid = 700k → 75% over → 30
      const result = scoreVacancy(
        makeVacancy({ salaryFrom: 680_000, salaryTo: 720_000 }),
        makeUser({ salaryMin: 200_000, salaryMax: 400_000 }),
      );
      expect(result.salary).toBe(30);
    });

    it('penalty for below range', () => {
      const result = scoreVacancy(
        makeVacancy({ salaryFrom: 50_000, salaryTo: 80_000 }),
        makeUser({ salaryMin: 200_000, salaryMax: 400_000 }),
      );
      expect(result.salary).toBeLessThan(60);
    });

    it('converts USD salary to RUB for comparison', () => {
      // $3000-$4000 → 270k-360k RUB, user wants 200k-400k → should be in range
      const result = scoreVacancy(
        makeVacancy({ salaryFrom: 3000, salaryTo: 4000, salaryCurrency: 'USD' }),
        makeUser({ salaryMin: 200_000, salaryMax: 400_000, salaryCurrency: 'RUB' }),
      );
      expect(result.salary).toBe(100);
    });
  });

  describe('format scoring', () => {
    it('returns 100 for exact match', () => {
      const result = scoreVacancy(
        makeVacancy({ format: 'remote' }),
        makeUser({ preferredFormat: 'remote' }),
      );
      expect(result.format).toBe(100);
    });

    it('returns 80 when user prefers "any"', () => {
      const result = scoreVacancy(
        makeVacancy({ format: 'office' }),
        makeUser({ preferredFormat: 'any' }),
      );
      expect(result.format).toBe(80);
    });

    it('returns 10 for office when remote preferred', () => {
      const result = scoreVacancy(
        makeVacancy({ format: 'office' }),
        makeUser({ preferredFormat: 'remote' }),
      );
      expect(result.format).toBe(10);
    });

    it('returns 50 for hybrid when remote preferred', () => {
      const result = scoreVacancy(
        makeVacancy({ format: 'hybrid' }),
        makeUser({ preferredFormat: 'remote' }),
      );
      expect(result.format).toBe(50);
    });

    it('returns 40 for unknown format', () => {
      const result = scoreVacancy(
        makeVacancy({ format: 'unknown' }),
        makeUser({ preferredFormat: 'remote' }),
      );
      expect(result.format).toBe(40);
    });
  });

  describe('domain scoring', () => {
    it('returns 50 when user has no domain preference', () => {
      const result = scoreVacancy(makeVacancy(), makeUser({ domains: [] }));
      expect(result.domain).toBe(50);
    });

    it('scores higher when domain matches', () => {
      const user = makeUser({
        domains: [{ name: 'FinTech', weight: 1.0 }],
      });
      const matched = scoreVacancy(
        makeVacancy({ description: 'финтех компания, банковские продукты' }),
        user,
      );
      const unmatched = scoreVacancy(
        makeVacancy({ description: 'строительство и недвижимость' }),
        user,
      );
      expect(matched.domain).toBeGreaterThan(unmatched.domain);
    });

    it('matches domain keywords in company name', () => {
      const user = makeUser({
        domains: [{ name: 'EdTech', weight: 1.0 }],
      });
      const result = scoreVacancy(
        makeVacancy({ company: 'Skillbox Education' }),
        user,
      );
      expect(result.domain).toBeGreaterThan(50);
    });
  });
});
