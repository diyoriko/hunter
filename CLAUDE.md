# Hunter — Multi-User Job Aggregator Bot

## Overview

**Hunter** (@jobhunt_ai_bot, "Design Jobs Bot") — мультиюзерный Telegram-бот для поиска вакансий. Скрейпит hh.ru и Habr, скорит вакансии под профиль каждого пользователя, показывает персонализированный дайджест и генерирует сопроводительные письма через Claude CLI.

**Цель:** платная подписка, SaaS-модель.

## Stack

- **Runtime:** Node.js 22 + TypeScript
- **Bot framework:** grammY
- **Database:** SQLite (better-sqlite3, WAL mode)
- **Scrapers:** hh.ru API, Habr Career API (cheerio)
- **AI:** Claude CLI (`claude --print --model claude-sonnet-4-6`)
- **Validation:** zod
- **Hosting (dev):** macOS launchd (KeepAlive)
- **Hosting (prod):** TBD (Railway / VPS)

## Architecture

```
src/
├── index.ts          # Entry point, bot launch, commands registration
├── bot.ts            # Telegram handlers (commands, buttons, callbacks)
├── db.ts             # SQLite schema, CRUD, multi-user data layer
├── types.ts          # TypeScript interfaces (UserProfile, Vacancy, ScoredVacancy)
├── config.ts         # Environment config via zod
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

- **users** — profiles with onboarding state
- **vacancies** — shared pool (deduped by source + external_id)
- **user_vacancies** — per-user scores and status (new/applied/rejected)
- **cover_letters** — per-user cached letters

## Key Design Decisions

- **No area filter on hh.ru** — users may be international (area=113 blocks from Turkey)
- **Browser User-Agent** — hh.ru blacklists bot UAs
- **Scoring is per-user** — skills 40% (weighted), salary 25%, format 20%, domain 15%, red flags penalty (/2), company blacklist (=0)
- **Owner seeded** — ADMIN_TELEGRAM_ID pre-loaded with minimal profile
- **Cover letters via CLI** — no API key needed, uses Max subscription auth
- **Vacancies shown expanded** — no "Открыть" step, full detail + buttons immediately

## Bot UX

**Main keyboard:** Поиск | Дайджест | Профиль | Статистика | Очистить

**Vacancy buttons:** Письмо | Скрыть (row 1), Откликнулся (row 2)

**Cover letter buttons:** Назад | Другой вариант (row 1), Откликнулся (row 2)

**Поиск** auto-shows digest after scrape completes.

## Known Limitations

- **CLI удалён** — `src/cli.ts` и `src/scheduler.ts` удалены при переходе на мультиюзер. Скрейп только через бот.
- **Cover letters через CLI** — `claude --print` медленный (10-15с), для масштабирования нужен Anthropic SDK
- **Admin ID** — через env var ADMIN_TELEGRAM_ID
- **Нет rate limiting** — /search можно спамить, hh.ru может забанить
- **Нет лимитов** — все фичи бесплатны, нет freemium gates
- **Нет scheduler** — автоскрейп не работает, только ручной через кнопку

## Running

```bash
# Dev
npm run dev

# Build & run
npm run build && npm start

# Launchd (production on Mac)
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hunter.bot.plist
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
| Strategist | Ежедневно 10:00 MSK | Анализ проекта, фичи, монетизация → BACKLOG.md |

## Quality Gate

- `npx tsc --noEmit` перед каждым деплоем
- Restart: `launchctl bootout` → `launchctl bootstrap`
- Логи: `~/Library/Logs/Hunter/bot.out.log`
