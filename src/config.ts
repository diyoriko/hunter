import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  JOBS_DB_PATH: z.string().default('./jobs.db'),
  ADMIN_TELEGRAM_ID: z.coerce.number().int().positive(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
});

const parsed = envSchema.parse(process.env);

export const CONFIG = {
  /** Bot version — bump on each deploy */
  version: '0.8.0',

  /** Admin Telegram ID for deploy notifications */
  adminTelegramId: parsed.ADMIN_TELEGRAM_ID,

  /** Human-readable deploy notes (non-technical!) */
  deployNotes: [
    '\u2705 <b>UX polish</b>',
    '      \u00AB\u0412\u0441\u0435 \u043D\u0430\u0432\u044B\u043A\u0438\u00BB \u2192 \u00AB\u0427\u0442\u043E \u0445\u043E\u0442\u044F\u0442\u00BB (\u043E\u043F\u044B\u0442, \u0433\u043E\u0440\u043E\u0434, \u043D\u0430\u0432\u044B\u043A\u0438, \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435)',
    '      Loading \u00AB\u0413\u0435\u043D\u0435\u0440\u0438\u0440\u0443\u044E \u043E\u0442\u043A\u043B\u0438\u043A...\u00BB',
    '      \u0423\u0431\u0440\u0430\u043D\u044B \u0434\u0443\u0431\u043B\u0438 \u043A\u043D\u043E\u043F\u043E\u043A \u0432 /start',
    '',
    '\u2705 <b>Dockerfile deploy</b>',
    '      Node 22 \u043C\u0443\u043B\u044C\u0442\u0438\u044D\u0442\u0430\u043F\u043D\u044B\u0439 \u0431\u0438\u043B\u0434',
  ],

  telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
  dbPath: parsed.JOBS_DB_PATH,
  anthropicApiKey: parsed.ANTHROPIC_API_KEY,

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
