'use server';
import 'dotenv/config';
import './ai/genkit'; // Initialize Genkit
import TelegramBot from 'node-telegram-bot-api';
import { simulateAdvisorAdvice, advisorProfiles } from '@/ai/flows/simulate-advisor-advice';
import { continueDialogue } from '@/ai/flows/continue-dialogue';

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not defined in .env file');
}

const bot = new TelegramBot(token, { polling: true });

interface DialogueState {
  history: Array<{ role: 'user' | 'model'; content: string }>;
  followUpsRemaining: number;
}

const userState = new Map<number, DialogueState>();
const MAX_FOLLOW_UPS = 3;

function resetUserState(chatId: number) {
  userState.delete(chatId);
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) {
    return;
  }

  if (text === '/start') {
    resetUserState(chatId);
    await bot.sendMessage(
      chatId,
      'Здравствуйте! Опишите вашу ситуацию, и я предоставлю вам совет от виртуального совета директоров.'
    );
    return;
  }

  const currentState = userState.get(chatId);
  const isNewConversation = !currentState || currentState.followUpsRemaining <= 0;

  try {
    if (isNewConversation) {
      // Start of a new conversation
      resetUserState(chatId); // Clear any old state
      await bot.sendMessage(chatId, 'Анализирую вашу ситуацию, это может занять некоторое время...');

      const result = await simulateAdvisorAdvice({
        situationDescription: text,
        selectedAdvisors: ['NavalRavikant', 'PieterLevels', 'GaryVaynerchuk'],
      });

      if (!result || !result.advisorAdvices || result.advisorAdvices.length === 0) {
        await bot.sendMessage(chatId, "К сожалению, не удалось сгенерировать совет. Попробуйте переформулировать ваш запрос.");
        return;
      }
      
      let initialModelResponse = `*Синтезированный план действий:*\n${result.synthesis}\n\n`;
      initialModelResponse += '*Рекомендации от каждого советника:*\n';
      
      result.advisorAdvices.forEach(advice => {
        const advisorName = advisorProfiles[advice.advisorName as keyof typeof advisorProfiles].name;
        initialModelResponse += `\n*${advisorName}:*\n${advice.advice}\n`;
      });
      
      const newHistory = [
          { role: 'user' as const, content: `Моя ситуация: ${text}` },
          { role: 'model' as const, content: initialModelResponse },
      ];

      userState.set(chatId, {
        history: newHistory,
        followUpsRemaining: MAX_FOLLOW_UPS,
      });

      await bot.sendMessage(chatId, initialModelResponse, { parse_mode: 'Markdown' });
      await bot.sendMessage(chatId, `Теперь вы можете задать до ${MAX_FOLLOW_UPS} уточняющих вопросов любому из советников. Например: "Наваль, что ты думаешь о..."`);

    } else {
      // Continuation of a dialogue
      await bot.sendMessage(chatId, 'Думаю над вашим вопросом...');

      const followUpResult = await continueDialogue({
          question: text,
          history: currentState.history,
      });

      currentState.history.push({ role: 'user', content: text });
      currentState.history.push({ role: 'model', content: followUpResult.answer });
      currentState.followUpsRemaining--;
      
      userState.set(chatId, currentState);

      await bot.sendMessage(chatId, followUpResult.answer, { parse_mode: 'Markdown' });

      if (currentState.followUpsRemaining > 0) {
        await bot.sendMessage(chatId, `Осталось вопросов: ${currentState.followUpsRemaining}.`);
      } else {
        await bot.sendMessage(chatId, 'Надеюсь, это было полезно! Чтобы начать новую консультацию, просто опишите вашу следующую ситуацию.');
        resetUserState(chatId);
      }
    }
  } catch (error) {
    console.error('Error processing message:', error);
    resetUserState(chatId);
    await bot.sendMessage(chatId, 'Произошла непредвиденная ошибка. Пожалуйста, начните заново с команды /start.');
  }
});

// Suppress the ETELEGRAM error in the development environment
bot.on('polling_error', (error) => {
    if ((error as any).code === 'ETELEGRAM' && (error as any).message.includes('409 Conflict')) {
        // This error happens during development when the server restarts.
        // It's a conflict between the old and new bot instances.
        // We can safely ignore it in a dev environment.
        console.log('Ignoring ETELEGRAM 409 Conflict error during development restart.');
    } else {
        console.error('Polling error:', error);
    }
});

console.log('Telegram bot started...');

// Graceful shutdown
const cleanup = async () => {
  console.log('Stopping Telegram bot...');
  if (bot.isPolling()) {
    await bot.stopPolling();
  }
  console.log('Telegram bot stopped.');
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
