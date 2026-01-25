import { Bot, session } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import { BotContext, SessionData } from '../types/index.js';
import { handleStart } from './commands/start.js';
import { handleHelp } from './commands/help.js';
import { handleHabits } from './commands/habits.js';
import { handleStats } from './commands/stats.js';
import { handleSettings } from './commands/settings.js';
import { handleCallback } from './callbacks/index.js';
import { 
  addHabitConversation, 
  setMorningTimeConversation, 
  setEveningTimeConversation, 
  setTimezoneConversation 
} from './conversations/index.js';

/**
 * Создаёт и настраивает бота
 * @module bot
 */

/**
 * Начальные данные сессии
 * @returns Пустой объект сессии
 */
const initialSessionData = (): SessionData => ({});

/**
 * Создаёт инстанс бота с настроенными обработчиками
 * @param token - Токен бота от BotFather
 * @returns Настроенный инстанс бота
 */
export const createBot = (token: string): Bot<BotContext> => {
  const bot = new Bot<BotContext>(token);

  // Middleware: сессии
  bot.use(session({ initial: initialSessionData }));

  // Middleware: conversations
  bot.use(conversations());
  bot.use(createConversation(addHabitConversation, 'addHabit'));
  bot.use(createConversation(setMorningTimeConversation, 'setMorningTime'));
  bot.use(createConversation(setEveningTimeConversation, 'setEveningTime'));
  bot.use(createConversation(setTimezoneConversation, 'setTimezone'));

  // Команды
  bot.command('start', handleStart);
  bot.command('help', handleHelp);
  bot.command('habits', handleHabits);
  bot.command('stats', handleStats);
  bot.command('settings', handleSettings);

  // Callback queries
  bot.on('callback_query:data', handleCallback);

  // Обработка ошибок
  bot.catch((err) => {
    console.error('Ошибка бота:', err);
  });

  return bot;
};

/**
 * Устанавливает команды бота в меню Telegram
 * @param bot - Инстанс бота
 */
export const setCommands = async (bot: Bot<BotContext>): Promise<void> => {
  await bot.api.setMyCommands([
    { command: 'start', description: '🏠 Главное меню' },
    { command: 'habits', description: '📝 Мои привычки' },
    { command: 'stats', description: '📊 Статистика' },
    { command: 'settings', description: '⚙️ Настройки' },
    { command: 'help', description: '📖 Справка' },
  ]);
};
