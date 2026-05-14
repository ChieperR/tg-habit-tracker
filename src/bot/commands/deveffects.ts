/**
 * 🚧 DEV-ONLY команда: интерактивный picker всех 200 Telegram premium message
 * effects для visual testing.
 *
 * `/deveffects` — открывает сообщение с inline-keyboard'ой из 40 эмодзи (5
 * рядов по 8). Юзер тапает эмодзи → бот шлёт отдельное тестовое сообщение с
 * этим effect'ом. Кнопки ⬅/➡ навигируют между 5 страницами (200/40=5).
 *
 * НЕ ВЛИВАТЬ В MAIN.
 *
 * @module bot/commands/deveffects
 */

import { InlineKeyboard } from 'grammy';
import { BotContext } from '../../types/index.js';
import { TELEGRAM_EFFECTS } from '../../data/telegramEffects.js';
import { safeEditMessage } from '../../utils/telegram.js';

const PAGE_SIZE = 40;
const COLS = 8;
const TOTAL_PAGES = Math.ceil(TELEGRAM_EFFECTS.length / PAGE_SIZE);

const buildKeyboard = (page: number): InlineKeyboard => {
  const kb = new InlineKeyboard();
  const start = page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, TELEGRAM_EFFECTS.length);

  let countInRow = 0;
  for (let i = start; i < end; i++) {
    kb.text(TELEGRAM_EFFECTS[i]!.emoji, `eff_pick:${i}`);
    countInRow++;
    if (countInRow >= COLS) {
      kb.row();
      countInRow = 0;
    }
  }
  if (countInRow > 0) kb.row();

  if (page > 0) kb.text('⬅', `eff_page:${page - 1}`);
  kb.text(`${page + 1}/${TOTAL_PAGES}`, 'eff_noop');
  if (page < TOTAL_PAGES - 1) kb.text('➡', `eff_page:${page + 1}`);

  return kb;
};

const buildText = (page: number): string => {
  const start = page * PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, TELEGRAM_EFFECTS.length);
  return `🛠 *DEV: Telegram effects picker*\n\nСтраница ${page + 1}/${TOTAL_PAGES} (эффекты ${start}–${end} из ${TELEGRAM_EFFECTS.length})\n\nТапни эмодзи → бот пришлёт сообщение с этим effect'ом.`;
};

export const handleDevEffects = async (ctx: BotContext): Promise<void> => {
  await ctx.reply(buildText(0), {
    parse_mode: 'Markdown',
    reply_markup: buildKeyboard(0),
  });
};

/**
 * Callback handler для eff_pick / eff_page / eff_noop.
 * Регистрируется в bot/index.ts в DEV-режиме.
 */
export const handleDevEffectsCallback = async (ctx: BotContext): Promise<void> => {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  if (data === 'eff_noop') {
    await ctx.answerCallbackQuery();
    return;
  }

  if (data.startsWith('eff_page:')) {
    const page = parseInt(data.slice('eff_page:'.length), 10);
    if (!Number.isFinite(page) || page < 0 || page >= TOTAL_PAGES) {
      await ctx.answerCallbackQuery('Bad page');
      return;
    }
    await ctx.answerCallbackQuery();
    await safeEditMessage(ctx, buildText(page), {
      parse_mode: 'Markdown',
      reply_markup: buildKeyboard(page),
    });
    return;
  }

  if (data.startsWith('eff_pick:')) {
    const idx = parseInt(data.slice('eff_pick:'.length), 10);
    const effect = TELEGRAM_EFFECTS[idx];
    if (!effect) {
      await ctx.answerCallbackQuery('Bad index');
      return;
    }
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    const message = `${effect.emoji}  \`${effect.id}\``;
    try {
      await ctx.api.sendMessage(telegramId.toString(), message, {
        parse_mode: 'Markdown',
        message_effect_id: effect.id,
      } as Parameters<typeof ctx.api.sendMessage>[2]);
    } catch (err) {
      console.error(`[deveffects] failed effect ${effect.id}:`, err);
      await ctx.reply(`Effect ${effect.emoji} (${effect.id}) не сработал: ${(err as Error).message}`);
    }
    return;
  }
};

/** Возвращает true если callback относится к /deveffects (в callback dispatcher'е). */
export const isDevEffectsCallback = (data: string): boolean =>
  data.startsWith('eff_pick:') || data.startsWith('eff_page:') || data === 'eff_noop';
