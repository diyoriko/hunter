import { describe, it, expect } from 'vitest';
import { formatSalary, formatVacancyCard, formatVacancyDetail, formatVacancyWithLetter, formatVacancyLoading, escapeHtml, DIGEST_PAGE_SIZE } from './digest';
import type { ScoredVacancy } from './types';

function makeScored(overrides: Partial<ScoredVacancy> = {}): ScoredVacancy {
  return {
    id: 1,
    source: 'hh.ru',
    externalId: '123',
    title: 'Product Designer',
    company: 'TechCorp',
    salaryFrom: 200_000,
    salaryTo: 400_000,
    salaryCurrency: 'RUB',
    format: 'remote',
    city: 'Москва',
    description: 'Описание вакансии',
    skills: ['Figma', 'UI/UX'],
    url: 'https://hh.ru/vacancy/123',
    publishedAt: new Date(),
    experience: 'middle',
    score: 75,
    scoreSkills: 80,
    scoreSalary: 100,
    scoreFormat: 100,
    scoreDomain: 50,
    status: 'new',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('escapes &, <, >', () => {
    expect(escapeHtml('A & B < C > D')).toBe('A &amp; B &lt; C &gt; D');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('handles already safe string', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });
});

describe('formatSalary', () => {
  it('formats range as "200K–400K ₽"', () => {
    const v = makeScored({ salaryFrom: 200_000, salaryTo: 400_000, salaryCurrency: 'RUB' });
    const result = formatSalary(v);
    expect(result).toContain('200K');
    expect(result).toContain('400K');
    expect(result).toContain('\u20BD'); // ₽
  });

  it('formats "от" when only salaryFrom', () => {
    const v = makeScored({ salaryFrom: 300_000, salaryTo: null });
    const result = formatSalary(v);
    expect(result).toMatch(/от\s+300K/);
  });

  it('formats "до" when only salaryTo', () => {
    const v = makeScored({ salaryFrom: null, salaryTo: 500_000 });
    const result = formatSalary(v);
    expect(result).toMatch(/до\s+500K/);
  });

  it('returns "n/a" when no salary', () => {
    const v = makeScored({ salaryFrom: null, salaryTo: null });
    expect(formatSalary(v)).toBe('n/a');
  });

  it('uses $ for USD', () => {
    const v = makeScored({ salaryFrom: 5000, salaryTo: 8000, salaryCurrency: 'USD' });
    expect(formatSalary(v)).toContain('$');
  });

  it('formats millions with M suffix', () => {
    const v = makeScored({ salaryFrom: 1_000_000, salaryTo: 2_000_000, salaryCurrency: 'RUB' });
    const result = formatSalary(v);
    expect(result).toContain('1.0M');
    expect(result).toContain('2.0M');
  });

  it('formats small numbers as-is', () => {
    const v = makeScored({ salaryFrom: 500, salaryTo: 800, salaryCurrency: 'USD' });
    const result = formatSalary(v);
    expect(result).toContain('500');
    expect(result).toContain('800');
  });
});

describe('formatVacancyCard', () => {
  it('contains title and company', () => {
    const result = formatVacancyCard(makeScored());
    expect(result).toContain('Product Designer');
    expect(result).toContain('TechCorp');
  });

  it('contains score', () => {
    const result = formatVacancyCard(makeScored({ score: 85 }));
    expect(result).toContain('85/100');
  });

  it('escapes HTML in title', () => {
    const result = formatVacancyCard(makeScored({ title: 'Design & Dev' }));
    expect(result).toContain('Design &amp; Dev');
  });
});

describe('formatVacancyDetail', () => {
  it('contains all key fields', () => {
    const result = formatVacancyDetail(makeScored());
    expect(result).toContain('Product Designer');
    expect(result).toContain('TechCorp');
    expect(result).toContain('Figma');
    expect(result).toContain('hh.ru');
    expect(result).toContain('75/100');
  });

  it('wraps fields in <code> tags', () => {
    const result = formatVacancyDetail(makeScored());
    expect(result).toContain('<code>');
  });

  it('shows "не указаны" when no skills', () => {
    const result = formatVacancyDetail(makeScored({ skills: [] }));
    expect(result).toContain('не указаны');
  });

  it('applies prefix', () => {
    const result = formatVacancyDetail(makeScored(), '✅ ');
    expect(result).toMatch(/^✅/);
  });

  it('includes city when present', () => {
    const result = formatVacancyDetail(makeScored({ city: 'Москва' }));
    expect(result).toContain('Москва');
  });

  it('contains link to vacancy', () => {
    const result = formatVacancyDetail(makeScored({ url: 'https://hh.ru/vacancy/123' }));
    expect(result).toContain('<a href="https://hh.ru/vacancy/123">');
  });
});

describe('formatVacancyWithLetter', () => {
  it('contains both vacancy detail and letter', () => {
    const result = formatVacancyWithLetter(makeScored(), 'Привет, я крутой дизайнер');
    expect(result).toContain('Product Designer');
    expect(result).toContain('Привет, я крутой дизайнер');
  });

  it('escapes HTML in letter text', () => {
    const result = formatVacancyWithLetter(makeScored(), 'A & B < C');
    expect(result).toContain('A &amp; B &lt; C');
  });
});

describe('formatVacancyLoading', () => {
  it('shows default loading text', () => {
    const result = formatVacancyLoading(makeScored());
    expect(result).toContain('<i>');
    expect(result).toContain('Генерирую отклик');
  });

  it('shows custom loading text', () => {
    const result = formatVacancyLoading(makeScored(), 'Загрузка...');
    expect(result).toContain('Загрузка...');
  });
});

describe('DIGEST_PAGE_SIZE', () => {
  it('equals 15', () => {
    expect(DIGEST_PAGE_SIZE).toBe(15);
  });
});
