# Hunter — Multi-User Job Aggregator Bot

## Overview

**Hunter** (@jobhunt_ai_bot) — мультиюзерный Telegram-бот для поиска вакансий с freemium-моделью. Скрейпит hh.ru и Habr, скорит вакансии под профиль каждого пользователя, показывает персонализированный дайджест и генерирует сопроводительные письма через Claude CLI.

**Цель:** платная подписка через Telegram Stars, SaaS-модель.

## Stack

- **Runtime:** Node.js 22 + TypeScript
- **Bot framework:** grammY
- **Database:** SQLite (better-sqlite3, WAL mode)
- **Scrapers:** hh.ru API, Habr Career API (cheerio)
- **AI:** Claude CLI (`claude --print --model claude-sonnet-4-6`)
- **Validation:** zod
- **Scheduler:** node-cron (3x/день скрейп + push + утренний дайджест)
- **Hosting:** Railway 24/7 (автодеплой из main)

## Architecture

```
src/
├── index.ts          # Entry point, bot launch, HTTP server, graceful shutdown
├── bot.ts            # Telegram handlers (commands, buttons, callbacks, freemium guards)
├── db.ts             # SQLite schema, CRUD, multi-user data layer, plan helpers
├── types.ts          # TypeScript interfaces (UserProfile, Vacancy, Plan)
├── config.ts         # Environment config via zod + freemium limits
├── scheduler.ts      # node-cron: auto-scrape, push notifications, morning digest
├── scorer.ts         # Vacancy scoring: skills 40%, salary 25%, format 20%, domain 15% + penalties
├── onboarding.ts     # User profile setup state machine (14 states)
├── digest.ts         # Vacancy formatting for Telegram (cards, detail, letters)
├── cover-letter.ts   # Claude CLI cover letter generation
├── logger.ts         # Structured JSON logging
└── scrapers/
    ├── types.ts      # Scraper interfaces, API response types
    ├── runner.ts     # Orchestrator: queries from user titles, score for all
    ├── hh.ts         # hh.ru API scraper (no area filter, browser UA)
    └── habr.ts       # Habr Career API scraper
```

## Database Schema

- **users** — profiles with onboarding state + plan/credits/letters_used
- **vacancies** — shared pool (deduped by source + external_id)
- **user_vacancies** — per-user scores, status (new/applied/rejected), notified flag
- **cover_letters** — per-user cached letters
- **kv** — key-value store (deploy tracking, scheduler state)

## Freemium Model

| | Free | Pro |
|--|------|-----|
| Cover letters | 5 lifetime | Безлимит |
| Дайджест | 15 вакансий | Безлимит |
| Push-алерты | 2/скрейп | 5/скрейп |
| Credits | Покупаются отдельно | — |

- 1 cover letter = 5 credits (разовая покупка без подписки)
- Pro: 500 Stars/мес, 4800 Stars/год (-20%)
- /subscribe — тарифы и лимиты
- Guards в bot.ts: checkCoverLetterLimit(), consumeCoverLetterQuota()
- Auto-expire: scheduler проверяет plan_expires_at каждый скрейп

## Key Design Decisions

- **No area filter on hh.ru** — users may be international
- **Browser User-Agent** — hh.ru blacklists bot UAs
- **Scoring is per-user** — skills 40%, salary 25%, format 20%, domain 15%, red flags /2, blacklist =0
- **Owner seeded** — ADMIN_TELEGRAM_ID pre-loaded with minimal profile
- **Cover letters via CLI** — no API key needed, uses Max subscription auth
- **Vacancies shown expanded** — full detail + buttons immediately
- **Auto-scrape** — 3x/день (09:00, 13:00, 17:00 MSK), без ручного Поиска

## Bot UX

**Main keyboard:** Дайджест | Профиль | Статистика | Очистить

**Commands:** /start, /digest, /profile, /stats, /subscribe

**Vacancy buttons:** Письмо | Скрыть (row 1), Откликнулся (row 2)

**Cover letter buttons:** Назад | Другой вариант (row 1), Откликнулся (row 2)

## Running

```bash
# Dev
npm run dev

# Build & run
npm run build && npm start
```

## Environment

```
TELEGRAM_BOT_TOKEN=...    # @jobhunt_ai_bot token
JOBS_DB_PATH=./jobs.db    # SQLite path
ADMIN_TELEGRAM_ID=...     # Owner Telegram ID for deploy notifications & seed
```

## Agents

| Agent | Schedule | Purpose |
|-------|----------|---------|
| Strategist | Ежедневно 09:30 MSK | Анализ проекта, фичи, монетизация → BACKLOG.md |

## Quality Gate

- `npx tsc --noEmit` перед каждым деплоем
- Graceful shutdown: SIGTERM → stopScheduler + bot.stop
- Логи: structured JSON via logger.ts
