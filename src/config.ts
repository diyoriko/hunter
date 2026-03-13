import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  JOBS_DB_PATH: z.string().default('./jobs.db'),
  ADMIN_TELEGRAM_ID: z.coerce.number().int().positive(),
});

const parsed = envSchema.parse(process.env);

export const CONFIG = {
  /** Bot version — bump on each deploy */
  version: '0.2.0',

  /** Admin Telegram ID for deploy notifications */
  adminTelegramId: parsed.ADMIN_TELEGRAM_ID,

  /** Human-readable deploy notes (non-technical!) */
  deployNotes: [
    '✅ <b>Онбординг стал удобнее</b>',
    '      Кнопки «Пропустить» и «Назад» на каждом шаге — больше не нужно набирать текст вручную',
    '',
    '✅ <b>Редактирование профиля</b>',
    '      Меняй любое поле по отдельности — не нужно проходить весь онбординг заново',
    '',
    '✅ <b>22 отрасли + своя</b>',
    '      Расширенный список индустрий на выбор, а если нужной нет — добавь свою текстом',
    '',
    '✅ <b>Уведомления о деплое</b>',
    '      После каждого обновления бот присылает отчёт с описанием изменений (это оно!)',
  ],

  telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
  dbPath: parsed.JOBS_DB_PATH,

  hhBaseUrl: 'https://api.hh.ru',
  hhUserAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',

  /** Scoring weights (must sum to 1.0) */
  scoring: {
    skills: 0.40,
    salary: 0.25,
    format: 0.20,
    domain: 0.15,
  },

  /** Common industry domains for onboarding selection */
  domains: [
    'SaaS/B2B', 'EdTech', 'FinTech',
    'AI/ML', 'E-commerce', 'HealthTech',
    'Travel', 'Media', 'GameDev',
    'HRTech', 'Banking', 'Crypto/Web3',
    'FoodTech', 'Social', 'Entertainment',
    'Retail', 'Telecom', 'Logistics',
    'Real Estate', 'Government', 'Legal', 'Auto',
  ] as const,

  /** Page size for digest pagination */
  pageSize: 15,
} as const;
