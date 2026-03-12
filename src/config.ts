import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_ADMIN_USER_ID: z.string().default('85013206'),
  HUNTER_DB_PATH: z.string().default('./hunter.db'),
});

const parsed = envSchema.parse(process.env);

export const CONFIG = {
  telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
  adminUserId: Number(parsed.TELEGRAM_ADMIN_USER_ID),
  dbPath: parsed.HUNTER_DB_PATH,
  // Scraping schedule (Moscow time)
  scrapeIntervals: ['09:00', '13:00', '17:00'] as const,
  digestTime: '20:00' as const,

  // hh.ru API
  hhBaseUrl: 'https://api.hh.ru',
  hhUserAgent: 'HunterBot/0.1 (diyor.khakimov@gmail.com)',

  // Scoring weights
  scoring: {
    skills: 0.40,
    salary: 0.25,
    format: 0.20,
    domain: 0.15,
  },
} as const;
