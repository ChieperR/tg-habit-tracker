import { BotContext, BotConversation, FrequencyType } from '../../types/index.js';
import { findOrCreateUser } from '../../services/userService.js';
import { createHabit } from '../../services/habitService.js';
import { createMainMenuKeyboard, createFrequencyTypeKeyboard, createEmojiKeyboard, createWeekdaysKeyboard } from '../keyboards/index.js';
import { serializeCallback } from '../../utils/callback.js';

/**
 * Диалог добавления новой привычки
 * @module bot/conversations/addHabit
 */

/** Названия дней недели для отображения */
const WEEKDAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/**
 * Форматирует расписание для отображения
 */
const formatSchedule = (
  frequencyType: FrequencyType,
  frequencyDays?: number,
  weekdays?: number[]
): string => {
  switch (frequencyType) {
    case 'daily':
      return 'ежедневно';
    case 'interval':
      return `раз в ${frequencyDays} дн.`;
    case 'weekdays':
      if (!weekdays || weekdays.length === 0) return 'не выбрано';
      // Сортируем дни начиная с понедельника
      const sorted = [...weekdays].sort((a, b) => {
        const aIdx = a === 0 ? 7 : a;
        const bIdx = b === 0 ? 7 : b;
        return aIdx - bIdx;
      });
      return sorted.map(d => WEEKDAY_NAMES[d]).join(', ');
  }
};

/**
 * Проверяет, является ли строка эмодзи
 */
const isEmoji = (str: string): boolean => {
  // Простая проверка на эмодзи (1-2 символа, не ASCII)
  const emojiRegex = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]{1,2}$/u;
  return emojiRegex.test(str.trim());
};

/**
 * Conversation для добавления привычки
 * @param conversation - Объект диалога
 * @param ctx - Контекст бота
 */
export const addHabitConversation = async (
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> => {
  const telegramId = ctx.from?.id;

  if (!telegramId) {
    await ctx.reply('❌ Не удалось определить пользователя');
    return;
  }

  const user = await conversation.external(() => findOrCreateUser(telegramId));

  // ===== Шаг 1: Название привычки =====
  await ctx.reply(
    '✨ *Добавление новой привычки*\n\nВведи название привычки:',
    { parse_mode: 'Markdown' }
  );

  const nameResponse = await conversation.waitFor('message:text');
  const habitName = nameResponse.message.text;

  if (habitName.startsWith('/')) {
    await ctx.reply('❌ Добавление отменено', {
      reply_markup: createMainMenuKeyboard(),
    });
    return;
  }

  // ===== Шаг 2: Выбор эмодзи =====
  await ctx.reply(
    `📝 Привычка: *${habitName}*\n\nВыбери эмодзи или отправь свой:`,
    {
      parse_mode: 'Markdown',
      reply_markup: createEmojiKeyboard(),
    }
  );

  let emoji = '✨';
  
  // Ждём либо callback (выбор из списка), либо текст (свой эмодзи)
  const emojiCtx = await conversation.wait();
  
  if (emojiCtx.callbackQuery?.data) {
    const emojiData = emojiCtx.callbackQuery.data;
    
    if (emojiData === serializeCallback({ type: 'back_to_menu' })) {
      await emojiCtx.answerCallbackQuery('❌ Отменено');
      await emojiCtx.editMessageText('🏠 *Главное меню*\n\nВыбери действие:', {
        parse_mode: 'Markdown',
        reply_markup: createMainMenuKeyboard(),
      });
      return;
    }
    
    if (emojiData.startsWith('emoji:')) {
      emoji = emojiData.slice(6);
      await emojiCtx.answerCallbackQuery(`Выбрано: ${emoji}`);
    }
  } else if (emojiCtx.message?.text) {
    const inputEmoji = emojiCtx.message.text.trim();
    if (isEmoji(inputEmoji)) {
      emoji = inputEmoji;
    }
    // Если не эмодзи — используем дефолтный
  }

  // ===== Шаг 3: Выбор типа частоты =====
  const freqTypeMsg = await ctx.reply(
    `${emoji} *${habitName}*\n\nКак часто выполнять?`,
    {
      parse_mode: 'Markdown',
      reply_markup: createFrequencyTypeKeyboard(),
    }
  );

  const freqTypeResponse = await conversation.waitFor('callback_query:data');
  const freqTypeData = freqTypeResponse.callbackQuery.data;

  if (freqTypeData === serializeCallback({ type: 'back_to_menu' })) {
    await freqTypeResponse.answerCallbackQuery('❌ Отменено');
    await freqTypeResponse.editMessageText('🏠 *Главное меню*\n\nВыбери действие:', {
      parse_mode: 'Markdown',
      reply_markup: createMainMenuKeyboard(),
    });
    return;
  }

  let frequencyType: FrequencyType = 'daily';
  let frequencyDays = 1;
  let weekdays: string | undefined;

  if (freqTypeData === 'freqtype:daily') {
    frequencyType = 'daily';
    await freqTypeResponse.answerCallbackQuery('📅 Ежедневно');
    
  } else if (freqTypeData === 'freqtype:interval') {
    frequencyType = 'interval';
    await freqTypeResponse.answerCallbackQuery('🔄 Раз в N дней');
    
    // Спрашиваем количество дней
    await freqTypeResponse.editMessageText(
      `${emoji} *${habitName}*\n\nВведи число дней (например: 3):`,
      { parse_mode: 'Markdown' }
    );
    
    const daysResponse = await conversation.waitFor('message:text');
    const daysInput = parseInt(daysResponse.message.text, 10);
    
    if (isNaN(daysInput) || daysInput < 1 || daysInput > 365) {
      frequencyDays = 1; // Дефолт если ввели ерунду
    } else {
      frequencyDays = daysInput;
    }
    
  } else if (freqTypeData === 'freqtype:weekdays') {
    frequencyType = 'weekdays';
    await freqTypeResponse.answerCallbackQuery('📆 Дни недели');
    
    // Выбор дней недели
    const selectedDays: number[] = [];
    
    await freqTypeResponse.editMessageText(
      `${emoji} *${habitName}*\n\nВыбери дни недели:`,
      {
        parse_mode: 'Markdown',
        reply_markup: createWeekdaysKeyboard(selectedDays),
      }
    );
    
    // Цикл выбора дней
    while (true) {
      const dayResponse = await conversation.waitFor('callback_query:data');
      const dayData = dayResponse.callbackQuery.data;
      
      if (dayData === serializeCallback({ type: 'back_to_menu' })) {
        await dayResponse.answerCallbackQuery('❌ Отменено');
        await dayResponse.editMessageText('🏠 *Главное меню*\n\nВыбери действие:', {
          parse_mode: 'Markdown',
          reply_markup: createMainMenuKeyboard(),
        });
        return;
      }
      
      if (dayData === 'weekdays:done') {
        if (selectedDays.length === 0) {
          await dayResponse.answerCallbackQuery('⚠️ Выбери хотя бы один день');
          continue;
        }
        await dayResponse.answerCallbackQuery('✅ Дни выбраны');
        break;
      }
      
      if (dayData.startsWith('weekday:')) {
        const day = parseInt(dayData.slice(8), 10);
        const idx = selectedDays.indexOf(day);
        
        if (idx === -1) {
          selectedDays.push(day);
          await dayResponse.answerCallbackQuery(`✅ ${WEEKDAY_NAMES[day]}`);
        } else {
          selectedDays.splice(idx, 1);
          await dayResponse.answerCallbackQuery(`⬜ ${WEEKDAY_NAMES[day]}`);
        }
        
        // Обновляем клавиатуру
        await dayResponse.editMessageText(
          `${emoji} *${habitName}*\n\nВыбери дни недели:`,
          {
            parse_mode: 'Markdown',
            reply_markup: createWeekdaysKeyboard(selectedDays),
          }
        );
      }
    }
    
    weekdays = selectedDays.join(',');
  }

  // ===== Создаём привычку =====
  await conversation.external(() =>
    createHabit({
      name: habitName,
      emoji,
      frequencyType,
      frequencyDays,
      weekdays,
      userId: user.id,
    })
  );

  const scheduleText = formatSchedule(frequencyType, frequencyDays, weekdays?.split(',').map(Number));

  await ctx.reply(
    `✅ *Привычка добавлена!*\n\n${emoji} ${habitName}\n📅 ${scheduleText}\n\nТеперь она появится в твоём списке.`,
    {
      parse_mode: 'Markdown',
      reply_markup: createMainMenuKeyboard(),
    }
  );
};
