import Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger';
import { getDb } from './db';
import { CONFIG } from './config';
import type { UserProfile, ScoredVacancy } from './types';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!CONFIG.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }
    client = new Anthropic({ apiKey: CONFIG.anthropicApiKey });
  }
  return client;
}

/**
 * Build a system prompt tailored to the user's profile.
 */
function buildSystemPrompt(user: UserProfile): string {
  const name = user.name ?? 'Кандидат';
  const title = user.title ?? 'Специалист';
  const years = user.yearsExperience ?? 0;
  const skills = user.skills.length > 0 ? user.skills.join(', ') : 'не указаны';
  const portfolio = user.portfolio ? `Портфолио: ${user.portfolio}` : '';
  const domains = user.domains.length > 0
    ? `Предпочтительные отрасли: ${user.domains.map(d => d.name).join(', ')}`
    : '';

  const aboutSection = user.about
    ? `--- ОПЫТ И БЭКГРАУНД ---\n${user.about}`
    : '';

  return `Ты — ghostwriter. Пишешь сопроводительные письма от имени кандидата. Задача — звучать как живой человек, который прочитал вакансию и сразу понял, почему подходит.

=== ПРОФИЛЬ КАНДИДАТА ===

${name}, ${title}, ${years > 0 ? years + ' лет опыта' : 'начинающий специалист'}.
Ключевые навыки: ${skills}.
${portfolio}
${domains}

${aboutSection}

=== ПРАВИЛА ПИСЬМА ===

1. 4-6 предложений, не больше.
2. Пиши как человек в чате — как сообщение знакомому рекрутеру, не как заявление.
3. ПЕРВАЯ СТРОКА = крючок. Сразу связка: что из вакансии → что делал конкретно. Не "Здравствуйте", не "Увидел вакансию".
4. Если в профиле есть описание опыта — выбирай 1-2 САМЫХ релевантных факта для конкретной вакансии.
5. Называй конкретные вещи, не абстракции. Если есть метрики — используй.
6. ${portfolio ? `Последнее предложение ВСЕГДА: "${portfolio}"` : 'Завершай коротко и по делу.'}
7. Язык: русский, если вакансия на русском. Английский, если на английском.

=== ЗАПРЕЩЕНО ===
- "с уважением", "буду рад", "готов к диалогу", "рассмотрите кандидатуру"
- "мультидисциплинарный", "passionate", "от идеи до результата", "закрываю полный цикл"
- Начинать с названия компании или пересказа вакансии
- Общие фразы без конкретики ("большой опыт", "умею работать в команде")
- Выдумывать то, чего нет в профиле выше`;
}

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

/** Generate cover letter via Anthropic API */
async function callAnthropic(prompt: string, systemPrompt: string): Promise<string> {
  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text in Anthropic response');
  }
  return textBlock.text.trim();
}

/** Generate cover letter for a user + vacancy */
export async function generateCoverLetter(user: UserProfile, v: ScoredVacancy, restyle = false): Promise<string> {
  const systemPrompt = buildSystemPrompt(user);
  let prompt = buildUserPrompt(v);

  if (restyle) {
    const prev = getCoverLetter(user.id, v.id);
    if (prev) {
      prompt += `\n\nПредыдущий вариант (НЕ повторяй его, напиши иначе — другая структура, другой заход, другие акценты):\n${prev}`;
    }
  }

  const start = Date.now();
  const text = await callAnthropic(prompt, systemPrompt);
  logger.info('cover-letter', 'Generated', { duration: Date.now() - start, vacancyId: v.id, userId: user.id });

  saveCoverLetter(user.id, v.id, text);
  return text;
}

// --- DB operations ---

function saveCoverLetter(userId: number, vacancyId: number, text: string): void {
  getDb()
    .prepare(`
      INSERT INTO cover_letters (user_id, vacancy_id, text)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, vacancy_id) DO UPDATE SET text = excluded.text, created_at = datetime('now')
    `)
    .run(userId, vacancyId, text);
}

export function getCoverLetter(userId: number, vacancyId: number): string | null {
  const row = getDb()
    .prepare('SELECT text FROM cover_letters WHERE user_id = ? AND vacancy_id = ?')
    .get(userId, vacancyId) as { text: string } | undefined;
  return row?.text ?? null;
}
