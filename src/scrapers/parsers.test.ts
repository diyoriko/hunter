import { describe, it, expect } from 'vitest';

/**
 * Tests for scraper parsing functions.
 * These are replicated from hh.ts and habr.ts since they are not exported.
 */

// --- hh.ts parseFormat (line 132-142) ---
function parseFormat(scheduleId: string | undefined, title: string, snippet: any): 'remote' | 'hybrid' | 'office' | 'unknown' {
  if (scheduleId === 'remote') return 'remote';
  if (scheduleId === 'flexible') return 'hybrid';

  const text = `${title} ${snippet?.requirement ?? ''} ${snippet?.responsibility ?? ''}`.toLowerCase();
  if (text.includes('удалённ') || text.includes('удаленн') || text.includes('remote')) return 'remote';
  if (text.includes('гибрид') || text.includes('hybrid')) return 'hybrid';

  if (scheduleId === 'fullDay') return 'office';
  return 'unknown';
}

// --- hh.ts parseExperience (line 144-152) ---
function parseExperience(expId: string | undefined): 'junior' | 'middle' | 'senior' | 'lead' | null {
  switch (expId) {
    case 'noExperience': return 'junior';
    case 'between1And3': return 'middle';
    case 'between3And6': return 'senior';
    case 'moreThan6': return 'lead';
    default: return null;
  }
}

// --- hh.ts normalizeCurrency (line 154-163) ---
function normalizeHhCurrency(currency: string | undefined): string | null {
  if (!currency) return null;
  switch (currency.toUpperCase()) {
    case 'RUR':
    case 'RUB': return 'RUB';
    case 'USD': return 'USD';
    case 'EUR': return 'EUR';
    default: return currency;
  }
}

// --- habr.ts parseQualification (line 144-152) ---
function parseQualification(q: string | null): 'junior' | 'middle' | 'senior' | 'lead' | 'unknown' | null {
  if (!q) return null;
  const lower = q.toLowerCase();
  if (lower.includes('junior') || lower.includes('intern')) return 'junior';
  if (lower.includes('middle') || lower.includes('средн')) return 'middle';
  if (lower.includes('senior') || lower.includes('старш')) return 'senior';
  if (lower.includes('lead') || lower.includes('ведущ')) return 'lead';
  return 'unknown';
}

// --- habr.ts normalizeCurrency (line 154-163) ---
function normalizeHabrCurrency(currency: string | undefined): string | null {
  if (!currency) return null;
  switch (currency.toLowerCase()) {
    case 'rur':
    case 'rub': return 'RUB';
    case 'usd': return 'USD';
    case 'eur': return 'EUR';
    default: return currency.toUpperCase();
  }
}

// ===== Tests =====

describe('hh.ru parseFormat', () => {
  it('returns "remote" for remote scheduleId', () => {
    expect(parseFormat('remote', '', {})).toBe('remote');
  });

  it('returns "hybrid" for flexible scheduleId', () => {
    expect(parseFormat('flexible', '', {})).toBe('hybrid');
  });

  it('returns "office" for fullDay scheduleId', () => {
    expect(parseFormat('fullDay', '', {})).toBe('office');
  });

  it('returns "unknown" for unrecognized scheduleId', () => {
    expect(parseFormat('shift', '', {})).toBe('unknown');
  });

  it('detects "remote" in title', () => {
    expect(parseFormat(undefined, 'Product Designer (remote)', {})).toBe('remote');
  });

  it('detects "удалённ" in title', () => {
    expect(parseFormat(undefined, 'Дизайнер (удалённо)', {})).toBe('remote');
  });

  it('detects "удаленн" (e without ё) in snippet', () => {
    expect(parseFormat(undefined, 'Дизайнер', { requirement: 'удаленная работа' })).toBe('remote');
  });

  it('detects "гибрид" in snippet', () => {
    expect(parseFormat(undefined, 'Дизайнер', { requirement: 'гибридный формат' })).toBe('hybrid');
  });

  it('detects "hybrid" in title', () => {
    expect(parseFormat(undefined, 'Designer (hybrid)', {})).toBe('hybrid');
  });

  it('returns "unknown" for no info', () => {
    expect(parseFormat(undefined, 'Designer', {})).toBe('unknown');
  });
});

describe('hh.ru parseExperience', () => {
  it('maps noExperience to junior', () => {
    expect(parseExperience('noExperience')).toBe('junior');
  });

  it('maps between1And3 to middle', () => {
    expect(parseExperience('between1And3')).toBe('middle');
  });

  it('maps between3And6 to senior', () => {
    expect(parseExperience('between3And6')).toBe('senior');
  });

  it('maps moreThan6 to lead', () => {
    expect(parseExperience('moreThan6')).toBe('lead');
  });

  it('returns null for undefined', () => {
    expect(parseExperience(undefined)).toBeNull();
  });

  it('returns null for unknown value', () => {
    expect(parseExperience('something')).toBeNull();
  });
});

describe('hh.ru normalizeCurrency', () => {
  it('normalizes RUR to RUB', () => {
    expect(normalizeHhCurrency('RUR')).toBe('RUB');
  });

  it('normalizes RUB', () => {
    expect(normalizeHhCurrency('RUB')).toBe('RUB');
  });

  it('normalizes rub (lowercase)', () => {
    expect(normalizeHhCurrency('rub')).toBe('RUB');
  });

  it('normalizes USD', () => {
    expect(normalizeHhCurrency('USD')).toBe('USD');
  });

  it('normalizes EUR', () => {
    expect(normalizeHhCurrency('EUR')).toBe('EUR');
  });

  it('returns null for undefined', () => {
    expect(normalizeHhCurrency(undefined)).toBeNull();
  });

  it('passes through unknown currency', () => {
    expect(normalizeHhCurrency('KZT')).toBe('KZT');
  });
});

describe('habr parseQualification', () => {
  it('detects junior', () => {
    expect(parseQualification('Junior')).toBe('junior');
  });

  it('detects intern as junior', () => {
    expect(parseQualification('Intern')).toBe('junior');
  });

  it('detects middle', () => {
    expect(parseQualification('Middle')).toBe('middle');
  });

  it('detects "средн" as middle', () => {
    expect(parseQualification('Средний')).toBe('middle');
  });

  it('detects senior', () => {
    expect(parseQualification('Senior')).toBe('senior');
  });

  it('detects "старш" as senior', () => {
    expect(parseQualification('Старший')).toBe('senior');
  });

  it('detects lead', () => {
    expect(parseQualification('Lead')).toBe('lead');
  });

  it('detects "ведущ" as lead', () => {
    expect(parseQualification('Ведущий')).toBe('lead');
  });

  it('returns "unknown" for unrecognized', () => {
    expect(parseQualification('Эксперт')).toBe('unknown');
  });

  it('returns null for null input', () => {
    expect(parseQualification(null)).toBeNull();
  });
});

describe('habr normalizeCurrency', () => {
  it('normalizes rur to RUB', () => {
    expect(normalizeHabrCurrency('rur')).toBe('RUB');
  });

  it('normalizes rub to RUB', () => {
    expect(normalizeHabrCurrency('rub')).toBe('RUB');
  });

  it('normalizes usd to USD', () => {
    expect(normalizeHabrCurrency('usd')).toBe('USD');
  });

  it('normalizes eur to EUR', () => {
    expect(normalizeHabrCurrency('eur')).toBe('EUR');
  });

  it('returns null for undefined', () => {
    expect(normalizeHabrCurrency(undefined)).toBeNull();
  });

  it('uppercases unknown currency', () => {
    expect(normalizeHabrCurrency('kzt')).toBe('KZT');
  });
});
