import { spawn } from 'child_process';
import { logger } from './logger';
import { getDb } from './db';
import type { UserProfile, ScoredVacancy } from './types';

/**
 * Build a system prompt tailored to the user's profile.
 * Unlike Hunter's hardcoded prompt, this generates dynamically from user data.
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

/** Run claude CLI with --print flag */
function runClaude(prompt: string, systemPrompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fullPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;

    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn('claude', ['--print', '--model', 'claude-sonnet-4-6'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude CLI failed (code ${code}): ${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });

    child.on('error', (err) => {
      reject(new Error(`claude CLI failed: ${err.message}`));
    });

    child.stdin.write(fullPrompt);
    child.stdin.end();

    setTimeout(() => {
      child.kill();
      reject(new Error('claude CLI timeout (60s)'));
    }, 60_000);
  });
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

  const text = await runClaude(prompt, systemPrompt);
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
