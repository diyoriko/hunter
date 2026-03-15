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
export function formatVacancyDetail(v: ScoredVacancy, prefix = ''): string {
  const skills = v.skills.length > 0 ? v.skills.join(', ') : 'не указаны';
  const formatLabel = v.format + (v.city ? ' · ' + v.city : '');

  return [
    `${prefix}${scoreEmoji(v.score)} <b>${escapeHtml(v.title)}</b>`,
    `${escapeHtml(v.company)}`,
    '',
    `<code>Зарплата: ${formatSalary(v)}`,
    `Формат:   ${formatFormat(v)} ${escapeHtml(formatLabel)}`,
    `Скор:     ${v.score}/100 (навыки ${v.scoreSkills}, зп ${v.scoreSalary}, формат ${v.scoreFormat})</code>`,
    '',
    `Навыки: <code>${escapeHtml(skills)}</code>`,
    `Источник: ${v.source}`,
    `<a href="${v.url}">Открыть вакансию</a>`,
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
export function formatVacancyLoading(v: ScoredVacancy, text: string = '\u0413\u0435\u043D\u0435\u0440\u0438\u0440\u0443\u044E \u043E\u0442\u043A\u043B\u0438\u043A...'): string {
  return [
    formatVacancyDetail(v),
    '',
    `<i>${escapeHtml(text)}</i>`,
  ].join('\n');
}

/** Page size for digest pagination */
export const DIGEST_PAGE_SIZE = 15;

// --- Shared inline keyboards ---

export function vacancyButtons(id: number, hasSkills = true): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text('\u{1F4DD} \u041E\u0442\u043A\u043B\u0438\u043A', `cover:${id}`)
    .text('\u274C \u0421\u043A\u0440\u044B\u0442\u044C', `reject:${id}`)
    .row();
  if (hasSkills) {
    kb.text('\u{1F4CB} \u0427\u0442\u043E \u0445\u043E\u0442\u044F\u0442', `details:${id}`).row();
  }
  kb.text('\u2705 \u041E\u0442\u043A\u043B\u0438\u043A\u043D\u0443\u043B\u0441\u044F', `applied:${id}`);
  return kb;
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
