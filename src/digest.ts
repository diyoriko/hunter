import type { ScoredVacancy } from './types';
import { getTodayNewVacancies, getTopVacancies, getStats } from './db';
import { getCoverLetter } from './cover-letter';

const SCORE_EMOJI: Record<string, string> = {
  hot: '🔥',
  good: '✅',
  ok: '💡',
  meh: '⚪',
};

function scoreEmoji(score: number): string {
  if (score >= 80) return SCORE_EMOJI.hot;
  if (score >= 60) return SCORE_EMOJI.good;
  if (score >= 40) return SCORE_EMOJI.ok;
  return SCORE_EMOJI.meh;
}

function formatSalary(v: ScoredVacancy): string {
  if (!v.salaryFrom && !v.salaryTo) return 'n/a';

  const currency = v.salaryCurrency === 'RUB' ? '₽' : v.salaryCurrency === 'USD' ? '$' : v.salaryCurrency ?? '₽';

  if (v.salaryFrom && v.salaryTo) {
    return `${formatNum(v.salaryFrom)}–${formatNum(v.salaryTo)} ${currency}`;
  }
  if (v.salaryFrom) return `от ${formatNum(v.salaryFrom)} ${currency}`;
  return `до ${formatNum(v.salaryTo!)} ${currency}`;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function formatFormat(v: ScoredVacancy): string {
  switch (v.format) {
    case 'remote': return '🏠 Remote';
    case 'hybrid': return '🔄 Hybrid';
    case 'office': return '🏢 Office';
    default: return '❓';
  }
}

/** Format a single vacancy line for digest */
function formatVacancyLine(v: ScoredVacancy, index: number): string {
  return [
    `${index}. ${scoreEmoji(v.score)} <b>${escapeHtml(v.title)}</b>`,
    `   ${escapeHtml(v.company)} · ${formatSalary(v)} · ${formatFormat(v)}`,
    `   Score: ${v.score}/100 (S:${v.scoreSkills} $:${v.scoreSalary} F:${v.scoreFormat} D:${v.scoreDomain})`,
    `   <a href="${v.url}">Открыть</a> · /cover_${v.id} · /like_${v.id} · /reject_${v.id}`,
  ].join('\n');
}

/** Build daily digest message */
export function buildDigest(): { text: string; count: number } {
  const todayNew = getTodayNewVacancies();
  const stats = getStats();

  if (todayNew.length === 0) {
    return {
      text: `<b>Дайджест</b>\n\nНовых подходящих вакансий сегодня не найдено.\n\nВсего в базе: ${stats.total} | Новых: ${stats.new} | Лайкнуто: ${stats.liked}`,
      count: 0,
    };
  }

  // Group by score tiers
  const hot = todayNew.filter(v => v.score >= 80);
  const good = todayNew.filter(v => v.score >= 60 && v.score < 80);
  const rest = todayNew.filter(v => v.score < 60);

  const lines: string[] = [
    `<b>Дайджест — ${new Date().toLocaleDateString('ru-RU')}</b>`,
    `Новых: ${todayNew.length} | Всего в базе: ${stats.total}`,
    '',
  ];

  let idx = 1;

  if (hot.length > 0) {
    lines.push(`<b>🔥 Горячие (${hot.length})</b>`);
    for (const v of hot) {
      lines.push(formatVacancyLine(v, idx++));
      lines.push('');
    }
  }

  if (good.length > 0) {
    lines.push(`<b>✅ Хорошие (${good.length})</b>`);
    for (const v of good.slice(0, 15)) {
      lines.push(formatVacancyLine(v, idx++));
      lines.push('');
    }
  }

  if (rest.length > 0) {
    lines.push(`<b>💡 Остальные (${rest.length})</b>`);
    for (const v of rest.slice(0, 10)) {
      lines.push(formatVacancyLine(v, idx++));
      lines.push('');
    }
  }

  lines.push(`/stats — статистика | /top30 — топ-30 всех времён`);

  return { text: lines.join('\n'), count: todayNew.length };
}

/** Build top vacancies message */
export function buildTop(limit: number = 30): string {
  const vacancies = getTopVacancies(limit);
  const lines: string[] = [
    `<b>Топ-${limit} вакансий</b>`,
    '',
  ];

  vacancies.forEach((v, i) => {
    lines.push(formatVacancyLine(v, i + 1));
    lines.push('');
  });

  if (vacancies.length === 0) {
    lines.push('Пока нет вакансий. Запусти /scrape для сбора.');
  }

  return lines.join('\n');
}

/** Build stats message */
export function buildStatsMessage(): string {
  const s = getStats();
  const sourceLines = Object.entries(s.sources)
    .map(([source, count]) => `  ${source}: ${count}`)
    .join('\n');

  return [
    '<b>Статистика Hunter</b>',
    '',
    `Всего вакансий: ${s.total}`,
    `Новых: ${s.new}`,
    `Лайкнуто: ${s.liked}`,
    `Откликнулся: ${s.applied}`,
    `Отклонено: ${s.rejected}`,
    `Средний скор: ${s.avgScore}/100`,
    '',
    '<b>По источникам:</b>',
    sourceLines || '  нет данных',
  ].join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
