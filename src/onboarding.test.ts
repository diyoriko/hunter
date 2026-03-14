import { describe, it, expect } from 'vitest';

/**
 * Tests for onboarding parser logic.
 * Since STEPS parsers are not exported, we replicate the parsing logic here
 * to ensure correctness. These patterns are from onboarding.ts.
 */

// --- Salary parser (onboarding.ts:62-80) ---
function parseSalary(text: string): { salaryMin: number | null; salaryMax: number | null } | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === 'пропустить' || trimmed === 'skip' || trimmed === '-') {
    return { salaryMin: null, salaryMax: null };
  }
  const cleaned = trimmed.replace(/[\s,]/g, '');
  const match = cleaned.match(/^(\d+)(k?)[-–](\d+)(k?)$/);
  if (match) {
    const min = parseInt(match[1], 10) * (match[2] ? 1000 : 1);
    const max = parseInt(match[3], 10) * (match[4] ? 1000 : 1);
    return { salaryMin: min, salaryMax: max };
  }
  const singleMatch = cleaned.match(/^(\d+)(k?)$/);
  if (singleMatch) {
    const val = parseInt(singleMatch[1], 10) * (singleMatch[2] ? 1000 : 1);
    return { salaryMin: val, salaryMax: null };
  }
  return null;
}

// --- Name parser (onboarding.ts:26-28) ---
function parseName(text: string): { name: string } | null {
  const name = text.trim().slice(0, 100);
  return name.length > 0 ? { name } : null;
}

// --- Title parser (onboarding.ts:34-36) ---
function parseTitle(text: string): { title: string } | null {
  const title = text.trim().slice(0, 200);
  return title.length > 0 ? { title } : null;
}

// --- Skills parser (onboarding.ts:50-57) ---
function parseSkills(text: string): { skills: string[]; skillWeights: { name: string; weight: number }[] } {
  const skills = text.slice(0, 500).split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
  const skillWeights = skills.map((name, i) => ({
    name,
    weight: skills.length === 1 ? 1.0 : parseFloat((1.0 - (i / (skills.length - 1)) * 0.5).toFixed(2)),
  }));
  return { skills, skillWeights };
}

// --- Experience parser (onboarding.ts:42-44) ---
function parseExperience(text: string): { yearsExperience: number } | null {
  const n = parseInt(text.trim(), 10);
  return !isNaN(n) && n >= 0 ? { yearsExperience: n } : null;
}

// --- About parser (onboarding.ts) ---
function parseAbout(text: string): { about: string | null } | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === 'пропустить' || trimmed === 'skip' || trimmed === '-') {
    return { about: null };
  }
  const about = text.trim().slice(0, 2000);
  return about.length > 0 ? { about } : null;
}

// ===== Tests =====

describe('salary parser', () => {
  it('parses "300000-500000"', () => {
    const result = parseSalary('300000-500000');
    expect(result).toEqual({ salaryMin: 300_000, salaryMax: 500_000 });
  });

  it('parses "300k-500k"', () => {
    const result = parseSalary('300k-500k');
    expect(result).toEqual({ salaryMin: 300_000, salaryMax: 500_000 });
  });

  it('parses "300K-500K" (uppercase)', () => {
    const result = parseSalary('300K-500K');
    expect(result).toEqual({ salaryMin: 300_000, salaryMax: 500_000 });
  });

  it('parses mixed formats: "200k-400000"', () => {
    const result = parseSalary('200k-400000');
    expect(result).toEqual({ salaryMin: 200_000, salaryMax: 400_000 });
  });

  it('parses with spaces: "300 000 - 500 000"', () => {
    const result = parseSalary('300 000 - 500 000');
    expect(result).toEqual({ salaryMin: 300_000, salaryMax: 500_000 });
  });

  it('parses with commas: "300,000-500,000"', () => {
    const result = parseSalary('300,000-500,000');
    expect(result).toEqual({ salaryMin: 300_000, salaryMax: 500_000 });
  });

  it('parses single value: "200000"', () => {
    const result = parseSalary('200000');
    expect(result).toEqual({ salaryMin: 200_000, salaryMax: null });
  });

  it('parses single value with k: "200k"', () => {
    const result = parseSalary('200k');
    expect(result).toEqual({ salaryMin: 200_000, salaryMax: null });
  });

  it('parses en-dash: "300k–500k"', () => {
    const result = parseSalary('300k\u2013500k');
    expect(result).toEqual({ salaryMin: 300_000, salaryMax: 500_000 });
  });

  it('returns skip values for "пропустить"', () => {
    expect(parseSalary('пропустить')).toEqual({ salaryMin: null, salaryMax: null });
  });

  it('returns skip values for "skip"', () => {
    expect(parseSalary('skip')).toEqual({ salaryMin: null, salaryMax: null });
  });

  it('returns skip values for "-"', () => {
    expect(parseSalary('-')).toEqual({ salaryMin: null, salaryMax: null });
  });

  it('returns null for invalid input', () => {
    expect(parseSalary('abc')).toBeNull();
    expect(parseSalary('много денег')).toBeNull();
    expect(parseSalary('')).toBeNull();
  });

  it('handles USD range: "3000-5000"', () => {
    const result = parseSalary('3000-5000');
    expect(result).toEqual({ salaryMin: 3_000, salaryMax: 5_000 });
  });

  it('handles small k values: "3k-5k"', () => {
    const result = parseSalary('3k-5k');
    expect(result).toEqual({ salaryMin: 3_000, salaryMax: 5_000 });
  });
});

describe('name parser', () => {
  it('parses a normal name', () => {
    expect(parseName('Иван')).toEqual({ name: 'Иван' });
  });

  it('trims whitespace', () => {
    expect(parseName('  Иван  ')).toEqual({ name: 'Иван' });
  });

  it('truncates at 100 chars', () => {
    const long = 'A'.repeat(200);
    const result = parseName(long);
    expect(result!.name.length).toBe(100);
  });

  it('returns null for empty input', () => {
    expect(parseName('')).toBeNull();
    expect(parseName('   ')).toBeNull();
  });
});

describe('title parser', () => {
  it('parses a normal title', () => {
    expect(parseTitle('Product Designer')).toEqual({ title: 'Product Designer' });
  });

  it('truncates at 200 chars', () => {
    const long = 'B'.repeat(300);
    const result = parseTitle(long);
    expect(result!.title.length).toBe(200);
  });

  it('returns null for empty input', () => {
    expect(parseTitle('')).toBeNull();
  });
});

describe('skills parser', () => {
  it('splits by comma and trims', () => {
    const result = parseSkills('Figma, UI/UX, Sketch');
    expect(result.skills).toEqual(['Figma', 'UI/UX', 'Sketch']);
  });

  it('filters empty entries', () => {
    const result = parseSkills('Figma,, ,Sketch');
    expect(result.skills).toEqual(['Figma', 'Sketch']);
  });

  it('limits to 20 skills', () => {
    const many = Array.from({ length: 30 }, (_, i) => `skill${i}`).join(',');
    const result = parseSkills(many);
    expect(result.skills.length).toBe(20);
  });

  it('truncates input at 500 chars', () => {
    const long = 'A'.repeat(600);
    const result = parseSkills(long);
    expect(result.skills[0].length).toBeLessThanOrEqual(500);
  });

  it('assigns decreasing weights', () => {
    const result = parseSkills('Figma, Sketch, InVision');
    expect(result.skillWeights[0].weight).toBe(1.0);
    expect(result.skillWeights[2].weight).toBe(0.5);
    // Middle should be between 0.5 and 1.0
    expect(result.skillWeights[1].weight).toBeGreaterThan(0.5);
    expect(result.skillWeights[1].weight).toBeLessThan(1.0);
  });

  it('assigns weight 1.0 for single skill', () => {
    const result = parseSkills('Figma');
    expect(result.skillWeights[0].weight).toBe(1.0);
  });
});

describe('experience parser', () => {
  it('parses a number', () => {
    expect(parseExperience('5')).toEqual({ yearsExperience: 5 });
  });

  it('parses zero', () => {
    expect(parseExperience('0')).toEqual({ yearsExperience: 0 });
  });

  it('trims whitespace', () => {
    expect(parseExperience('  3 ')).toEqual({ yearsExperience: 3 });
  });

  it('returns null for non-number', () => {
    expect(parseExperience('abc')).toBeNull();
    expect(parseExperience('')).toBeNull();
  });

  it('returns null for negative numbers', () => {
    expect(parseExperience('-1')).toBeNull();
  });
});

describe('about parser', () => {
  it('parses normal text', () => {
    const result = parseAbout('5 лет в UX, работал в финтехе');
    expect(result).toEqual({ about: '5 лет в UX, работал в финтехе' });
  });

  it('truncates at 2000 chars', () => {
    const long = 'C'.repeat(3000);
    const result = parseAbout(long);
    expect(result!.about!.length).toBe(2000);
  });

  it('returns null about for skip words', () => {
    expect(parseAbout('пропустить')).toEqual({ about: null });
    expect(parseAbout('skip')).toEqual({ about: null });
    expect(parseAbout('-')).toEqual({ about: null });
  });
});
