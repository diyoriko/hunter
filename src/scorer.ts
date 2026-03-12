import { PROFILE } from './profile';
import type { Vacancy } from './types';
import { CONFIG } from './config';

interface ScoreResult {
  total: number;
  skills: number;
  salary: number;
  format: number;
  domain: number;
  redFlagPenalty: boolean;
}

/**
 * Score a vacancy against user profile.
 * Returns 0-100 with breakdown.
 */
export function scoreVacancy(v: Vacancy): ScoreResult {
  const text = normalizeText(`${v.title} ${v.description} ${v.skills.join(' ')}`);

  const skills = scoreSkills(text);
  const salary = scoreSalary(v);
  const format = scoreFormat(v);
  const domain = scoreDomain(text);
  const redFlagPenalty = hasRedFlags(text);

  const w = CONFIG.scoring;
  let total = Math.round(
    skills * w.skills +
    salary * w.salary +
    format * w.format +
    domain * w.domain
  );

  // Red flag penalty: halve the score
  if (redFlagPenalty) {
    total = Math.round(total * 0.5);
  }

  // Experience bonus: senior/lead mentions boost score
  if (v.experience === 'senior' || v.experience === 'lead') {
    total = Math.min(100, total + 5);
  }

  return {
    total: Math.max(0, Math.min(100, total)),
    skills: Math.round(skills),
    salary: Math.round(salary),
    format: Math.round(format),
    domain: Math.round(domain),
    redFlagPenalty,
  };
}

/** Skills score: how many profile skills are mentioned */
function scoreSkills(text: string): number {
  let totalWeight = 0;
  let matchedWeight = 0;

  for (const skill of PROFILE.skills) {
    totalWeight += skill.weight;
    const matched = skill.aliases.some(alias => text.includes(alias.toLowerCase()));
    if (matched) {
      matchedWeight += skill.weight;
    }
  }

  if (totalWeight === 0) return 0;

  // Normalize: if 50%+ skills matched by weight → 100 points
  // Scale non-linearly: matching core skills matters more
  const ratio = matchedWeight / totalWeight;
  return Math.min(100, ratio * 200); // 50% match = 100 points
}

/** Salary score: overlap with desired range */
function scoreSalary(v: Vacancy): number {
  if (!v.salaryFrom && !v.salaryTo) return 50; // Unknown = neutral

  let salaryFrom = v.salaryFrom ?? 0;
  let salaryTo = v.salaryTo ?? salaryFrom * 1.3;

  // Normalize to RUB
  if (v.salaryCurrency === 'USD') {
    salaryFrom *= 90;
    salaryTo *= 90;
  } else if (v.salaryCurrency === 'EUR') {
    salaryFrom *= 95;
    salaryTo *= 95;
  }

  const midVacancy = (salaryFrom + salaryTo) / 2;
  const midProfile = (PROFILE.salaryMin + PROFILE.salaryMax) / 2;

  if (midVacancy >= PROFILE.salaryMin && midVacancy <= PROFILE.salaryMax) {
    return 100; // Perfect match
  }

  if (midVacancy > PROFILE.salaryMax) {
    return 90; // Over budget = still good for us
  }

  // Below minimum — penalize proportionally
  const ratio = midVacancy / PROFILE.salaryMin;
  if (ratio >= 0.8) return 60;
  if (ratio >= 0.6) return 30;
  return 10;
}

/** Format score: remote preference */
function scoreFormat(v: Vacancy): number {
  if (PROFILE.preferredFormat === 'any') return 80;

  switch (v.format) {
    case 'remote': return 100;
    case 'hybrid': return 70;
    case 'office': return 20;
    default: return 50; // unknown
  }
}

/** Domain score: how well the company/vacancy matches preferred domains */
function scoreDomain(text: string): number {
  let best = 0;

  for (const domain of PROFILE.domains) {
    const matched = domain.aliases.some(alias => text.includes(alias.toLowerCase()));
    if (matched && domain.weight > best) {
      best = domain.weight;
    }
  }

  // No domain match = neutral (don't penalize)
  return best > 0 ? best * 100 : 40;
}

/** Check for red flags (disqualifying signals) */
function hasRedFlags(text: string): boolean {
  return PROFILE.redFlags.some(flag => text.includes(flag.toLowerCase()));
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')  // strip HTML
    .replace(/\s+/g, ' ')
    .trim();
}
