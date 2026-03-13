import { InlineKeyboard } from 'grammy';
import type { ScoredVacancy } from './types';

function scoreEmoji(score: number): string {
  if (score >= 80) return '\u{1F525}';
  if (score >= 60) return '\u2705';
  if (score >= 40) return '\u{1F4A1}';
  return '\u26AA';
}

export function formatSalary(v: ScoredVacancy): string {
  if (!v.salaryFrom && !v.salaryTo) return 'n/a';

  const currency = v.salaryCurrency === 'RUB' ? '\u20BD' : v.salaryCurrency === 'USD' ? '$' : v.salaryCurrency ?? '\u20BD';

  if (v.salaryFrom && v.salaryTo) {
    return `${formatNum(v.salaryFrom)}\u2013${formatNum(v.salaryTo)} ${currency}`;
  }
  if (v.salaryFrom) return `\u043E\u0442 ${formatNum(v.salaryFrom)} ${currency}`;
  return `\u0434\u043E ${formatNum(v.salaryTo!)} ${currency}`;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function formatFormat(v: ScoredVacancy): string {
  switch (v.format) {
    case 'remote': return '\u{1F3E0}';
    case 'hybrid': return '\u{1F504}';
    case 'office': return '\u{1F3E2}';
    default: return '\u2753';
  }
}

/** Compact vacancy card */
export function formatVacancyCard(v: ScoredVacancy): string {
  return [
    `${scoreEmoji(v.score)} <b>${escapeHtml(v.title)}</b>`,
    `${escapeHtml(v.company)} \u00B7 ${formatSalary(v)} \u00B7 ${formatFormat(v)} \u00B7 ${v.score}/100`,
  ].join('\n');
}

/** Detailed vacancy view */
export function formatVacancyDetail(v: ScoredVacancy): string {
  const skills = v.skills.length > 0 ? v.skills.join(', ') : '\u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D\u044B';

  return [
    `${scoreEmoji(v.score)} <b>${escapeHtml(v.title)}</b>`,
    `${escapeHtml(v.company)}`,
    '',
    `\u0417\u0430\u0440\u043F\u043B\u0430\u0442\u0430: ${formatSalary(v)}`,
    `\u0424\u043E\u0440\u043C\u0430\u0442: ${formatFormat(v)} ${v.format}${v.city ? ' \u00B7 ' + escapeHtml(v.city) : ''}`,
    `\u0421\u043A\u043E\u0440: ${v.score}/100 (\u043D\u0430\u0432\u044B\u043A\u0438 ${v.scoreSkills}, \u0437\u043F ${v.scoreSalary}, \u0444\u043E\u0440\u043C\u0430\u0442 ${v.scoreFormat})`,
    `\u041D\u0430\u0432\u044B\u043A\u0438: ${escapeHtml(skills)}`,
    `\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A: ${v.source}`,
    `<a href="${v.url}">\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0432\u0430\u043A\u0430\u043D\u0441\u0438\u044E</a>`,
  ].join('\n');
}

/** Vacancy detail + cover letter combined */
export function formatVacancyWithLetter(v: ScoredVacancy, letter: string): string {
  return [
    formatVacancyDetail(v),
    '',
    '\u2014 \u2014 \u2014',
    '',
    `<code>${escapeHtml(letter)}</code>`,
  ].join('\n');
}

/** Vacancy detail + loading state */
export function formatVacancyLoading(v: ScoredVacancy, text: string = '\u0413\u0435\u043D\u0435\u0440\u0438\u0440\u0443\u044E \u043F\u0438\u0441\u044C\u043C\u043E...'): string {
  return [
    formatVacancyDetail(v),
    '',
    `<i>${escapeHtml(text)}</i>`,
  ].join('\n');
}

/** Page size for digest pagination */
export const DIGEST_PAGE_SIZE = 15;

// --- Shared inline keyboards ---

export function vacancyButtons(id: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('📝 Письмо', `cover:${id}`)
    .text('❌ Скрыть', `reject:${id}`)
    .row()
    .text('✅ Откликнулся', `applied:${id}`);
}

export function coverLetterButtons(id: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('◀️ Назад', `view:${id}`)
    .text('🔄 Другой вариант', `restyle:${id}`)
    .row()
    .text('✅ Откликнулся', `applied:${id}`);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
