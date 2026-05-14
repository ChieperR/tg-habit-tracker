/**
 * 🚧 DEV-ONLY команда: рассылает все 200 Telegram premium message effects
 * чтобы юзер мог визуально оценить какой effect выбрать для milestone'ов.
 *
 * Использование:
 *   /deveffects — шлёт по одному сообщению на каждый из 200 effects
 *   /deveffects 50 — шлёт только первые 50
 *   /deveffects 50 100 — отрезок 50-100 включительно
 *
 * Каждое сообщение содержит эмодзи + ID effect'а в подписи, чтобы можно было
 * скопировать ID понравившегося.
 *
 * НЕ ВЛИВАТЬ В MAIN.
 *
 * @module bot/commands/deveffects
 */

import { BotContext } from '../../types/index.js';
import { TELEGRAM_EFFECTS } from '../../data/telegramEffects.js';

const SEND_DELAY_MS = 300; // 200 / 0.3s = ~60 секунд, лимит TG ~30 msg/sec

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const handleDevEffects = async (ctx: BotContext): Promise<void> => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const text = typeof ctx.match === 'string' ? ctx.match.trim() : '';
  const args = text ? text.split(/\s+/) : [];
  let start = 0;
  let end = TELEGRAM_EFFECTS.length;

  if (args.length === 1) {
    const n = parseInt(args[0]!, 10);
    if (Number.isFinite(n) && n > 0) {
      end = Math.min(n, TELEGRAM_EFFECTS.length);
    }
  } else if (args.length >= 2) {
    const s = parseInt(args[0]!, 10);
    const e = parseInt(args[1]!, 10);
    if (Number.isFinite(s) && Number.isFinite(e) && s > 0 && e >= s) {
      start = s - 1;
      end = Math.min(e, TELEGRAM_EFFECTS.length);
    }
  }

  await ctx.reply(
    `🛠 Отправляю ${end - start} effects (с ${start + 1} по ${end}). ` +
      `Задержка ${SEND_DELAY_MS}мс между сообщениями, итого ~${Math.ceil(
        ((end - start) * SEND_DELAY_MS) / 1000
      )} сек.`
  );

  let failed = 0;
  for (let i = start; i < end; i++) {
    const effect = TELEGRAM_EFFECTS[i]!;
    const message = `${i + 1}. ${effect.emoji}\n\`${effect.id}\``;
    try {
      await ctx.api.sendMessage(telegramId.toString(), message, {
        parse_mode: 'Markdown',
        message_effect_id: effect.id,
      } as Parameters<typeof ctx.api.sendMessage>[2]);
    } catch (err) {
      failed++;
      console.error(`[deveffects] failed effect ${effect.id}:`, err);
    }
    await sleep(SEND_DELAY_MS);
  }

  await ctx.reply(`✅ Готово. Отправлено: ${end - start - failed}, fail: ${failed}.`);
};
