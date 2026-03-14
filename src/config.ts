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
  version: '0.5.0',

  /** Admin Telegram ID for deploy notifications */
  adminTelegramId: parsed.ADMIN_TELEGRAM_ID,

  /** Human-readable deploy notes (non-technical!) */
  deployNotes: [
    '\u2705 <b>Cover letter resilience</b>',
    '      \u0422\u0430\u0439\u043C\u0430\u0443\u0442 15\u0441 + fallback \u0441 \u043A\u043D\u043E\u043F\u043A\u043E\u0439 \u00AB\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C\u00BB',
    '',
    '\u2705 <b>UX polish</b>',
    '      \u041F\u0430\u0433\u0438\u043D\u0430\u0446\u0438\u044F 1\u201315 \u0438\u0437 N, \u043F\u0443\u0441\u0442\u043E\u0439 \u0434\u0430\u0439\u0434\u0436\u0435\u0441\u0442 \u2192 \u0441\u043E\u0432\u0435\u0442, \u041E\u0442\u043A\u043B\u0438\u043A\u043D\u0443\u043B\u0441\u044F \u2192 \u2705',
    '      \u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0447\u0430\u0442 \u0441 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u0435\u043C, \u043C\u043E\u043D\u043E\u0448\u0438\u0440\u0438\u043D\u043D\u044B\u0435 \u043F\u043E\u043B\u044F',
    '',
    '\u2705 <b>\u0417\u0430\u0449\u0438\u0442\u0430</b>',
    '      \u0412\u0430\u043B\u0438\u0434\u0430\u0446\u0438\u044F \u0432\u0432\u043E\u0434\u0430, salary parser (300k-500k), random delays \u0432 \u0441\u043A\u0440\u0435\u0439\u043F\u0435\u0440\u0430\u0445',
    '',
    '\u2705 <b>\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430</b>',
    '      /adminstats, \u043F\u043E\u043B\u0438\u0440\u043E\u0432\u043A\u0430 \u044D\u043A\u0440\u0430\u043D\u0430, \u043F\u0440\u043E\u0444\u0438\u043B\u044C \u0441 \u043F\u043E\u044F\u0441\u043D\u0435\u043D\u0438\u044F\u043C\u0438',
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

  /** Telegram Stars pricing */
  stars: {
    proMonthly: 700,           // ~$7.70
    proYearly: 6720,           // ~20% off vs 700×12
    creditsSmall: { stars: 100, letters: 3 },   // 100 Stars = 15 credits (3 letters)
    creditsLarge: { stars: 300, letters: 10 },   // 300 Stars = 50 credits (10 letters)
  },
} as const;
