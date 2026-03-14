import type { Vacancy, UserProfile } from './types';
import { CONFIG } from './config';

export interface ScoreResult {
  total: number;
  skills: number;
  salary: number;
  format: number;
  domain: number;
}

/**
 * Score a vacancy against a user's profile.
 *
 * Formula (0-100):
 *   Skills  40% — weighted skill matching
 *   Salary  25% — range overlap
 *   Format  20% — remote/hybrid/office preference
 *   Domain  15% — preferred industry match
 *
 * Penalties:
 *   Red flags in title/description → score /2
 *   Company in blacklist → score = 0
 *   Irrelevant title (engineer, developer with no design) → score = 0
 */
export function scoreVacancy(v: Vacancy, user: UserProfile): ScoreResult {
  const text = normalizeText(`${v.title} ${v.description} ${v.skills.join(' ')}`);
  const titleNorm = normalizeText(v.title);

  // Check company blacklist first
  if (isBlacklisted(v.company, user.companyBlacklist)) {
    return { total: 0, skills: 0, salary: 0, format: 0, domain: 0 };
  }

  // Check title relevance — filter out engineer/developer if user is a designer
  if (isTitleIrrelevant(titleNorm, user.title)) {
    return { total: 0, skills: 0, salary: 0, format: 0, domain: 0 };
  }

  const skills = scoreSkills(text, user);
  const salary = scoreSalary(v, user);
  const format = scoreFormat(v, user.preferredFormat);
  const domain = scoreDomain(text, v.company, user.domains);

  const w = CONFIG.scoring;
  let total = Math.round(
    skills * w.skills +
    salary * w.salary +
    format * w.format +
    domain * w.domain
  );

  // Red flags penalty: halve the score
  if (hasRedFlags(text, titleNorm, user.redFlags)) {
    total = Math.round(total / 2);
  }

  return {
    total: Math.max(0, Math.min(100, total)),
    skills: Math.round(skills),
    salary: Math.round(salary),
    format: Math.round(format),
    domain: Math.round(domain),
  };
}

/** Skills score: weighted matching — skills listed first get higher weight */
function scoreSkills(text: string, user: UserProfile): number {
  const weights = user.skillWeights;

  // Use skill weights if available, otherwise fall back to flat skills with auto-weights
  if (weights.length > 0) {
    let weightedScore = 0;
    let totalWeight = 0;

    for (const sw of weights) {
      totalWeight += sw.weight;
      if (text.includes(sw.name.toLowerCase())) {
        weightedScore += sw.weight;
      }
    }

    if (totalWeight === 0) return 50;
    const ratio = weightedScore / totalWeight;
    // Non-linear: 30%+ weighted match = 100 points
    return Math.min(100, ratio * 330);
  }

  // Fallback: flat skills with auto-weights based on position
  const skills = user.skills;
  if (skills.length === 0) return 50;

  let weightedScore = 0;
  let totalWeight = 0;

  for (let i = 0; i < skills.length; i++) {
    // First skill = 1.0, last = 0.5, linear interpolation
    const weight = skills.length === 1 ? 1.0 : 1.0 - (i / (skills.length - 1)) * 0.5;
    totalWeight += weight;
    if (text.includes(skills[i].toLowerCase())) {
      weightedScore += weight;
    }
  }

  const ratio = weightedScore / totalWeight;
  return Math.min(100, ratio * 330);
}

/** Salary score: overlap with user's desired range */
function scoreSalary(v: Vacancy, user: UserProfile): number {
  if (!user.salaryMin && !user.salaryMax) return 70;
  if (!v.salaryFrom && !v.salaryTo) return 50;

  let salaryFrom = v.salaryFrom ?? 0;
  let salaryTo = v.salaryTo ?? salaryFrom * 1.3;

  // Normalize to user's currency
  if (user.salaryCurrency === 'RUB') {
    if (v.salaryCurrency === 'USD') { salaryFrom *= 90; salaryTo *= 90; }
    else if (v.salaryCurrency === 'EUR') { salaryFrom *= 95; salaryTo *= 95; }
  }

  const midVacancy = (salaryFrom + salaryTo) / 2;
  const userMin = user.salaryMin ?? 0;
  const userMax = user.salaryMax ?? userMin * 1.5;

  if (midVacancy >= userMin && midVacancy <= userMax) return 100;

  // Above user's max — tiered penalty
  if (midVacancy > userMax) {
    const overRatio = (midVacancy - userMax) / userMax;
    if (overRatio <= 0.3) return 75;   // up to 30% above
    if (overRatio <= 0.6) return 50;   // 30-60% above
    return 30;                          // 60%+ above
  }

  const ratio = midVacancy / userMin;
  if (ratio >= 0.8) return 60;
  if (ratio >= 0.6) return 30;
  return 10;
}

/** Format score: match user's preference */
function scoreFormat(v: Vacancy, preferred: string): number {
  if (preferred === 'any') return 80;
  if (v.format === preferred) return 100;
  if (v.format === 'hybrid' && preferred === 'remote') return 50;
  if (v.format === 'remote' && preferred === 'hybrid') return 90;
  if (v.format === 'unknown') return 40;
  return 10;
}

/** Domain score: match preferred industries */
function scoreDomain(text: string, company: string, domains: UserProfile['domains']): number {
  if (domains.length === 0) return 50; // No preference = neutral

  const combined = normalizeText(`${text} ${company}`);

  // Domain keywords mapping for better matching
  const domainKeywords: Record<string, string[]> = {
    'saas/b2b': ['saas', 'b2b', 'crm', 'erp', 'enterprise', 'platform'],
    'edtech': ['edtech', 'education', 'обучение', 'образование', 'школа', 'курсы', 'lms'],
    'fintech': ['fintech', 'банк', 'bank', 'платежи', 'payment', 'финанс', 'finance', 'trading'],
    'ai/ml': ['ai', 'ml', 'machine learning', 'нейросет', 'искусственный интеллект', 'gpt', 'llm'],
    'e-commerce': ['ecommerce', 'e-commerce', 'магазин', 'shop', 'marketplace', 'торговля', 'ритейл', 'retail'],
    'healthtech': ['healthtech', 'health', 'медицин', 'здоровье', 'pharma', 'телемедицин'],
    'travel': ['travel', 'туризм', 'путешеств', 'бронирован', 'booking', 'hotel'],
    'media': ['media', 'медиа', 'контент', 'content', 'стриминг', 'streaming', 'видео', 'news'],
    'gamedev': ['gamedev', 'game', 'игр', 'gaming'],
    'hrtech': ['hrtech', 'hr', 'рекрутинг', 'recruiting', 'найм', 'hiring', 'кадр'],
    'banking': ['банк', 'bank', 'banking', 'кредит', 'credit', 'ипотек', 'mortgage', 'вклад'],
    'crypto/web3': ['crypto', 'web3', 'blockchain', 'блокчейн', 'nft', 'defi', 'token', 'dao'],
    'foodtech': ['foodtech', 'food', 'еда', 'доставка', 'delivery', 'ресторан', 'restaurant'],
    'social': ['social', 'соцсет', 'мессенджер', 'messenger', 'community', 'dating'],
    'entertainment': ['entertainment', 'развлечен', 'кино', 'музык', 'music', 'event', 'concert'],
    'retail': ['retail', 'ритейл', 'магазин', 'shop', 'торговля', 'склад', 'warehouse'],
    'telecom': ['telecom', 'телеком', 'связь', 'оператор', 'mobile', 'мобильн'],
    'logistics': ['logistics', 'логистик', 'доставк', 'транспорт', 'transport', 'грузоперевоз'],
    'real estate': ['real estate', 'недвижимость', 'proptech', 'строительств', 'девелопер'],
    'government': ['government', 'госуслуг', 'gov', 'муниципал', 'цифровизац', 'госсектор'],
    'legal': ['legal', 'legaltech', 'юридическ', 'право', 'law', 'адвокат'],
    'auto': ['auto', 'авто', 'automotive', 'каршеринг', 'carsharing', 'такси', 'taxi'],
  };

  let bestMatch = 0;

  for (const domain of domains) {
    const key = domain.name.toLowerCase();
    const keywords = domainKeywords[key] || [key];
    const matched = keywords.some(kw => combined.includes(kw));
    if (matched) {
      bestMatch = Math.max(bestMatch, domain.weight);
    }
  }

  // Scale: 0 = no match (30 pts), 0.5 = partial (65 pts), 1.0 = full (100 pts)
  return Math.round(30 + bestMatch * 70);
}

/** Check if company is in user's blacklist */
function isBlacklisted(company: string, blacklist: string[]): boolean {
  if (blacklist.length === 0) return false;
  const companyLower = company.toLowerCase();
  return blacklist.some(b => companyLower.includes(b.toLowerCase()));
}

/** Check for red flag keywords in title or description */
function hasRedFlags(text: string, title: string, redFlags: string[]): boolean {
  if (redFlags.length === 0) return false;
  return redFlags.some(flag => {
    const f = flag.toLowerCase();
    // Red flags in title are more significant
    return title.includes(f) || text.includes(f);
  });
}

/**
 * Title relevance check.
 * If user is a designer but vacancy title says "developer", "engineer", "analyst" etc.
 * with no design-related terms, it's irrelevant.
 */
function isTitleIrrelevant(titleNorm: string, userTitle: string): boolean {
  if (!userTitle) return false;

  const userTitleNorm = normalizeText(userTitle);

  // Only apply to design-related users
  const designIndicators = ['design', 'дизайн', 'ux', 'ui', 'brand', 'бренд'];
  const isDesigner = designIndicators.some(d => userTitleNorm.includes(d));
  if (!isDesigner) return false;

  // Non-design titles that should be filtered
  const devTitles = ['developer', 'разработчик', 'engineer', 'инженер', 'analyst', 'аналитик', 'backend', 'frontend', 'devops', 'qa', 'тестировщик'];
  const hasDevTitle = devTitles.some(d => titleNorm.includes(d));
  if (!hasDevTitle) return false;

  // But if title also has design keywords, it's fine (e.g. "UX/UI Developer")
  const hasDesignInTitle = designIndicators.some(d => titleNorm.includes(d));
  return !hasDesignInTitle;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
