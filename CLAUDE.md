# CLAUDE.md — Project Guide for Claude Code

> This file is intended for Claude Code and other AI agents working on this codebase.
> Read it before making any changes.

---

## What Is This Project?

**tg-habit-tracker** — Telegram bot for habit tracking with automatic reminders.

Users can create habits with flexible schedules (daily / every N days / specific weekdays), mark them as done via inline buttons, and view statistics (streaks, completion rate, weekly calendar). The bot sends morning and evening reminders at user-configured times, respecting each user's timezone.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 + TypeScript 5 |
| Telegram API | [grammY](https://grammy.dev) + `@grammyjs/conversations` + `@grammyjs/runner` |
| Database | SQLite via [Prisma ORM](https://www.prisma.io) |
| Scheduler | `node-cron` (every-minute poll for reminders) |
| Date utils | `date-fns` + `date-fns-tz` + `geo-tz` |
| Build | `tsc` (production), `tsx watch` (dev) |

---

## Project Structure

```
src/
├── index.ts                    # Entry point — init DB, bot, scheduler, graceful shutdown
├── bot/
│   ├── index.ts                # Bot factory (createBot), middleware setup, setCommands
│   ├── commands/               # /command handlers (one file per command)
│   │   ├── start.ts            # /start — welcome, timezone setup
│   │   ├── habits.ts           # /habits — list with inline toggles
│   │   ├── stats.ts            # /stats — statistics overview
│   │   ├── settings.ts         # /settings — reminders config
│   │   ├── weekly.ts           # /weekly — weekly calendar view
│   │   ├── help.ts             # /help
│   │   └── daily.ts            # /daily — DEV ONLY: simulate morning reminder
│   ├── conversations/          # Multi-step dialogs (@grammyjs/conversations)
│   │   ├── addHabit.ts         # Add habit wizard (name → emoji → frequency → reminder)
│   │   ├── settings.ts         # Settings wizards (morning time, evening time, timezone, habit reminder)
│   │   └── index.ts            # Re-exports
│   ├── callbacks/
│   │   └── index.ts            # Central callback_query router
│   ├── handlers/
│   │   └── timezoneInput.ts    # Free-text / location handler for timezone setup
│   └── keyboards/
│       └── index.ts            # All inline keyboard builders
├── db/
│   └── index.ts                # Prisma client singleton
├── scheduler/
│   └── cron.ts                 # node-cron task: checks reminders every minute
├── services/
│   ├── userService.ts          # findOrCreateUser, updateSettings
│   ├── habitService.ts         # CRUD for habits, isDueToday logic
│   ├── statsService.ts         # getUserStats, formatStatsMessage, streak calc
│   ├── weeklyService.ts        # Weekly calendar: habit rows with DayState per day
│   ├── analyticsService.ts      # Event tracking, retention, segmentation, funnel, habit health
│   └── reminderService.ts      # checkAndSendReminders (morning/evening/habit)
├── types/
│   └── index.ts                # All shared TS types (BotContext, CallbackAction, etc.)
└── utils/
    ├── date.ts                 # getNowInTimezone, getTodayDate, isHabitDueOnDate, etc.
    ├── callback.ts             # serializeCallback / parseCallback (type-safe JSON in callback_data)
    ├── telegram.ts             # Helpers for safe Telegram API calls
    └── timezoneFromLocation.ts # geo-tz: coords → timezone offset
prisma/
└── schema.prisma               # DB schema (User, Habit, HabitLog)
```

---

## Database Schema (Key Points)

### `User`
- `telegramId: BigInt` — unique Telegram user ID
- `timezoneOffset: Int?` — UTC offset in **minutes** (e.g. `180` = UTC+3). `null` means not configured yet
- `morningTime / eveningTime: String` — format `HH:MM` in user's local time
- `morningEnabled / eveningEnabled: Boolean` — reminder toggles
- `lastMorningReminderDate / lastEveningReminderDate: String?` — `YYYY-MM-DD`, used to avoid duplicate reminders
- `lastSeenChangelog: Int` — ID of the last changelog entry the user has seen (default `0`)

### `Habit`
- `frequencyType: String` — `"daily"` | `"interval"` | `"weekdays"`
- `frequencyDays: Int` — only meaningful for `interval`
- `weekdays: String?` — comma-separated JS `getDay()` values: `0=Sun, 1=Mon, ..., 6=Sat`  
  Example: `"1,3,5"` = Mon, Wed, Fri
- `reminderTime: String?` — personal reminder time `HH:MM` in user's local timezone, `null` = no reminder
- `lastHabitReminderDate: String?` — `YYYY-MM-DD`, dedup for habit-specific reminders
- `isActive: Boolean` — soft delete pattern

### `HabitLog`
- `date: String` — `YYYY-MM-DD`
- `completed: Boolean`
- Unique constraint `[habitId, date]` — one record per habit per day (upsert pattern)

---

## Core Concepts

### Timezone Handling
All user-facing dates/times are computed relative to `user.timezoneOffset` (minutes from UTC).  
Default if not set: `180` (UTC+3, Moscow).  
During `/start`, the bot asks the user to share location or manually enter offset. Location → timezone via `geo-tz`.  
**Always pass `timezoneOffset` to date utils — never use raw `new Date()` for user-facing logic.**

### Habit Due Logic (`isHabitDueOnDate`)
Located in `src/utils/date.ts`. Three cases:
- `daily` → always due
- `interval` → due if `daysDiff % frequencyDays === 0` from reference date
- `weekdays` → due if weekday is in the set

For `interval`, the reference date is the first completion date (or `createdAt` if never completed).

### Callback Data
All `callback_data` values are serialized `CallbackAction` objects (JSON).  
Use `serializeCallback` / `parseCallback` from `src/utils/callback.ts`. **Never construct raw strings.**

```typescript
// Good
serializeCallback({ type: 'habit_toggle', habitId: 42 })

// Bad
`habit_toggle:${habitId}`
```

### Conversations (Multi-step Dialogs)
Uses `@grammyjs/conversations`. All external side-effects (DB calls, etc.) inside a conversation **must** be wrapped in `conversation.external()`.

```typescript
const user = await conversation.external(() => findOrCreateUser(telegramId));
```

### Reminder Flow
`cron.ts` runs every minute (with mutex to prevent overlapping runs) → `reminderService.ts`:

**Global reminders** (`checkAndSendReminders`):
1. Finds all users who have the reminder enabled
2. Checks if current time in user's timezone >= their configured time
3. Checks `lastXxxReminderDate` to avoid duplicates
4. Sends message and updates the date

**Per-habit reminders** (`checkAndSendHabitReminders`):
1. Finds all active habits with `reminderTime != null`
2. Checks habit is due today and not yet completed
3. Checks user's current time >= `reminderTime`
4. Checks `lastHabitReminderDate` to avoid duplicates
5. Sends "⏰ Пришло время: {emoji} {name}" with a ✅ toggle button

---

## Coding Conventions

### TypeScript
- Strict mode enabled (`tsconfig.json`)
- All functions must have explicit return types
- Use `type` over `interface` for aliases; `interface` for extension targets
- No `any` — use proper types or `unknown`

### JSDoc
Every exported function and module gets a JSDoc comment:
```typescript
/**
 * Short description.
 * @param ctx - Context description
 * @returns What it returns
 */
export const myFunction = async (ctx: BotContext): Promise<void> => { ... };
```
Module-level: `@module services/myModule`  
Model fields in schema: use `///` triple-slash comments (Prisma convention)

### File Naming
- `camelCase.ts` for all source files
- One logical unit per file
- Commands → `src/bot/commands/<commandName>.ts`
- New services → `src/services/<name>Service.ts`

### Imports
- Always use `.js` extension in imports (ESM + TypeScript Node16 resolution)
  ```typescript
  import { foo } from './bar.js'; // ✅
  import { foo } from './bar';    // ❌
  ```
- Group imports: external libs → internal modules → types

### Prisma
- Use the singleton from `src/db/index.ts` (`import { prisma } from '../db/index.js'`)
- Never instantiate `new PrismaClient()` elsewhere
- Use `upsert` for HabitLog (unique constraint `[habitId, date]`)

### Error Handling
- Bot handlers: wrap in try/catch, send user-friendly message on error
- Services: let errors bubble up; handle at the bot layer
- Never silently swallow errors

---

## Commands & Features Reference

| Command | Handler | Description |
|---------|---------|-------------|
| `/start` | `commands/start.ts` | Welcome + timezone setup |
| `/habits` | `commands/habits.ts` | Habit list with toggle buttons |
| `/stats` | `commands/stats.ts` | Statistics: streaks, completion % |
| `/settings` | `commands/settings.ts` | Reminder times + timezone |
| `/help` | `commands/help.ts` | Help text |
| `/daily` | `commands/daily.ts` | **DEV ONLY** — simulate morning reminder |
| `/admin` | `commands/admin.ts` | Admin only — bot statistics + segmentation (silently ignores non-admin) |
| `/analytics` | `commands/analytics.ts` | Admin only — detailed analytics with period selector + custom date range |
| `/funnel` | `commands/funnel.ts` | Admin only — activation funnel, habit health, reminder effectiveness, streak breaks |
| `/changelog` | `commands/changelog.ts` | Shows new changelog entries since last seen; not in setMyCommands (discoverable via banner only) |

### Callback Actions (all types in `types/index.ts`)
| Type | Description |
|------|-------------|
| `habit_toggle` | Mark habit done/undone for today |
| `habit_add` | Start add-habit conversation |
| `habit_delete` / `habit_confirm_delete` | Two-step delete |
| `habit_details` | Habit detail view (reminder + delete) |
| `habit_reminder_set` | Start set-reminder conversation |
| `habit_reminder_remove` | Remove habit reminder |
| `weekly_show` / `weekly_prev` / `weekly_next` | Weekly calendar navigation |
| `stats` | Refresh stats view |
| `settings_morning` / `settings_evening` | Set reminder time |
| `settings_reminders_toggle` | Toggle all reminders |
| `save_day` | Save daily checklist |
| `back_to_menu` | Return to main menu |
| `noop` | No-op (decorative buttons) |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BOT_TOKEN` | ✅ | Telegram bot token from BotFather |
| `DATABASE_URL` | ✅ | SQLite path, e.g. `file:./database.db` |
| `NODE_ENV` | ❌ | Set to `development` to enable `/daily` command |
| `DEV` | ❌ | Alternative to `NODE_ENV=development` for dev mode |

---

## Development Workflow

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run db:generate

# Apply schema to DB
npm run db:push

# Run in dev mode (hot reload)
npm run dev

# Build for production
npm run build
npm start

# Prisma GUI
npm run db:studio
```

---

## When Adding New Features

1. **New command** → add handler in `src/bot/commands/<name>.ts`, register in `src/bot/index.ts` (`bot.command(...)`) and `setCommands()`
2. **New callback action** → add type to `CallbackAction` union in `types/index.ts`, handle in `src/bot/callbacks/index.ts`
3. **New conversation** → create in `src/bot/conversations/`, register in `createBot()` via `bot.use(createConversation(...))`
4. **New DB field** → edit `prisma/schema.prisma`, then run `npm run db:push` and `npm run db:generate`
5. **New service** → `src/services/<name>Service.ts`, use `prisma` singleton
6. **Date/timezone** → always use utils from `src/utils/date.ts`, never raw `new Date()` for user-facing logic
7. **Changelog** → если изменение затрагивает юзера (новая фича, фикс заметного бага, изменение поведения которое юзер увидит) — добавь запись в `src/changelog.ts` с инкрементированным `id`, текущей датой и текстом без `*` `_` `` ` `` `[` `]`. `LATEST_CHANGELOG_ID` подтягивается автоматически. Не нужно для чисто внутренних изменений (рефакторинг, тесты, infra).

---

## Things to Watch Out For

- **Timezone offset is in minutes**, not hours. UTC+3 = `180`, UTC-5 = `-300`
- **`weekdays` field uses JS `getDay()` convention**: `0 = Sunday`, not Monday
- **grammY conversations**: any side-effect (especially DB) must be in `conversation.external()`
- **Reminder deduplication**: always update `lastMorningReminderDate` / `lastEveningReminderDate` after sending
- **`isActive` soft delete**: never hard-delete habits; set `isActive = false`
- **`callback_data` Telegram limit**: 64 bytes max — keep serialized callbacks short; current JSON approach is fine for existing types but don't bloat it
