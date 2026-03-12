import { execFile } from 'child_process';
import { PROFILE } from './profile';
import { logger } from './logger';
import { getDb } from './db';
import type { ScoredVacancy } from './types';

const SYSTEM_PROMPT = `Ты пишешь сопроводительные письма для дизайнера. Формат: короткое, по делу, без пафоса.

Профиль кандидата:
- ${PROFILE.name}, ${PROFILE.title}
- ${PROFILE.yearsExperience} лет опыта
- Ключевые компании: Skyeng, Qlean, Anywayanyday, FloraDelivery, Teletype, Singularity Hub
- Навыки: продуктовый дизайн, брендинг, айдентика, UI/UX, лендинги, дизайн-системы
- Технический бэкграунд: HTML/CSS, TypeScript, автоматизации
- Figma — основной инструмент
- Портфолио: diyor.design

Правила письма:
1. Максимум 4-5 предложений
2. Начинай с конкретной связки "ваша задача → мой опыт"
3. Упоминай 1-2 релевантных проекта из портфолио (только если реально подходят)
4. Не пиши "с уважением", "буду рад обсудить" и прочий шаблон
5. Тон: спокойный, фактический, уверенный
6. Язык: русский, если вакансия на русском. Английский, если на английском
7. НЕ пиши: "мультидисциплинарный", "passionate", "от идеи до результата"`;

function buildUserPrompt(v: ScoredVacancy): string {
  const descClean = v.description
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);

  return `Напиши сопроводительное письмо для этой вакансии:

Позиция: ${v.title}
Компания: ${v.company}
Зарплата: ${formatSalaryRange(v)}
Формат: ${v.format}
Навыки: ${v.skills.join(', ') || 'не указаны'}

Описание:
${descClean}`;
}

function formatSalaryRange(v: ScoredVacancy): string {
  if (!v.salaryFrom && !v.salaryTo) return 'не указана';
  if (v.salaryFrom && v.salaryTo) return `${v.salaryFrom}–${v.salaryTo} ${v.salaryCurrency}`;
  if (v.salaryFrom) return `от ${v.salaryFrom} ${v.salaryCurrency}`;
  return `до ${v.salaryTo} ${v.salaryCurrency}`;
}

/** Run claude CLI with --print flag (uses Max subscription, no API cost) */
function runClaude(prompt: string, systemPrompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fullPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;

    execFile('claude', ['--print', '--model', 'claude-sonnet-4-6', fullPrompt], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`claude CLI failed: ${stderr || error.message}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/** Generate cover letter for a single vacancy */
export async function generateCoverLetter(v: ScoredVacancy): Promise<string> {
  const text = await runClaude(buildUserPrompt(v), SYSTEM_PROMPT);

  // Save to DB
  saveCoverLetter(v.id, text);

  return text;
}

/** Generate cover letters for top vacancies in batch */
export async function generateBatch(vacancies: ScoredVacancy[]): Promise<number> {
  let generated = 0;

  for (const v of vacancies) {
    // Skip if already has a cover letter
    const existing = getCoverLetter(v.id);
    if (existing) continue;

    try {
      await generateCoverLetter(v);
      generated++;
      logger.info('cover', `Generated cover letter for "${v.title}" at ${v.company}`);
    } catch (err) {
      logger.error('cover', `Failed for vacancy ${v.id}`, { error: String(err) });
    }

    // Small pause between CLI calls
    await new Promise(r => setTimeout(r, 500));
  }

  logger.info('cover', `Generated ${generated} cover letters`);
  return generated;
}

// --- DB operations ---

function saveCoverLetter(vacancyId: number, text: string): void {
  getDb()
    .prepare(`
      INSERT INTO cover_letters (vacancy_id, text)
      VALUES (?, ?)
      ON CONFLICT(vacancy_id) DO UPDATE SET text = excluded.text, created_at = datetime('now')
    `)
    .run(vacancyId, text);
}

export function getCoverLetter(vacancyId: number): string | null {
  const row = getDb()
    .prepare('SELECT text FROM cover_letters WHERE vacancy_id = ?')
    .get(vacancyId) as { text: string } | undefined;
  return row?.text ?? null;
}
