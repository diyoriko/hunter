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
  version: '0.3.0',

  /** Admin Telegram ID for deploy notifications */
  adminTelegramId: parsed.ADMIN_TELEGRAM_ID,

  /** Human-readable deploy notes (non-technical!) */
  deployNotes: [
    '✅ <b>Freemium-модель</b>',
    '      Free: 5 писем, 15 вакансий в дайджесте, 2 push-алерта',
    '      Pro: безлимит всего + полные push-алерты',
    '',
    '✅ <b>Команда /subscribe</b>',
    '      Посмотри тарифы и лимиты прямо в боте',
    '',
    '✅ <b>Paywall</b>',
    '      Когда лимит закончится — подсказка с тарифами',
    '',
    '✅ <b>Кредиты</b>',
    '      Разовая покупка кредитов для генерации писем без подписки',
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

  /** Scheduler settings */
  scheduler: {
    scrapeCron: '0 9,13,17 * * *',  // 09:00, 13:00, 17:00 MSK
    digestCron: '15 9 * * *',       // 09:15 MSK (after scrape)
    timezone: 'Europe/Moscow',
    pushMinScore: 70,
    pushMaxCards: 5,
    enabled: process.env.SCHEDULER_ENABLED !== 'false',
  },

  /** Freemium limits */
  freemium: {
    free: {
      coverLetters: 5,         // lifetime total
      digestPageSize: 15,      // max vacancies in digest
      pushMaxCards: 2,          // push notifications per scrape
    },
    pro: {
      coverLetters: Infinity,
      digestPageSize: Infinity, // uses default pageSize
      pushMaxCards: 5,
    },
    creditsPerLetter: 5,       // 1 cover letter = 5 credits
  },
} as const;
