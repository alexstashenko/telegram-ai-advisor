import 'dotenv/config';
import './ai/genkit'; // Initialize Genkit
import TelegramBot from 'node-telegram-bot-api';
import { simulateAdvisorAdvice } from '@/ai/flows/simulate-advisor-advice';

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not defined in .env file');
}

const bot = new TelegramBot(token, { polling: true });

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) {
    return;
  }

  if (text === '/start') {
    await bot.sendMessage(
      chatId,
      'Здравствуйте! Опишите вашу ситуацию, и я предоставлю вам совет от виртуального совета директоров.'
    );
    return;
  }

  try {
    await bot.sendMessage(chatId, 'Анализирую вашу ситуацию, это может занять некоторое время...');

    const result = await simulateAdvisorAdvice({
      situationDescription: text,
      selectedAdvisors: ['NavalRavikant', 'PieterLevels', 'GaryVaynerchuk'],
    });

    if (!result || !result.advisorAdvices || result.advisorAdvices.length === 0) {
        await bot.sendMessage(chatId, "К сожалению, не удалось сгенерировать совет. Попробуйте переформулировать ваш запрос.");
        return;
    }

    let response = `*Синтезированный план действий:*\n${result.synthesis}\n\n`;
    response += '*Рекомендации от каждого советника:*\n';

    result.advisorAdvices.forEach(advice => {
      let advisorName = '';
      if (advice.advisorName === 'NavalRavikant') advisorName = 'Наваль Равикант';
      if (advice.advisorName === 'PieterLevels') advisorName = 'Питер Левелс';
      if (advice.advisorName === 'GaryVaynerchuk') advisorName = 'Гэри Вайнерчук';

      response += `\n*${advisorName}:*\n${advice.advice}\n`;
    });

    await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error processing message:', error);
    await bot.sendMessage(chatId, 'Произошла непредвиденная ошибка. Пожалуйста, попробуйте позже.');
  }
});

console.log('Telegram bot started...');
