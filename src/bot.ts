'use server';
import 'dotenv/config';
import './ai/genkit'; // Initialize Genkit
import TelegramBot from 'node-telegram-bot-api';
import { simulateAdvisorAdvice } from '@/ai/flows/simulate-advisor-advice';
import { continueDialogue } from '@/ai/flows/continue-dialogue';
import { selectAdvisors, type AdvisorProfile } from '@/ai/flows/select-advisors';
import { getUser, saveUser, type DbUser } from '@/db';

const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.ADMIN_CHAT_ID;

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not defined in .env file');
}

const bot = new TelegramBot(token, { polling: true });

// -- State Management (in-memory for a single session) --
type DialogueState = {
  history: Array<{ role: 'user' | 'model'; content: string }>;
  followUpsRemaining: number;
};

type UserSessionState = {
  stage: 'awaiting_situation' | 'awaiting_advisor_selection' | 'in_dialogue';
  situation?: string;
  availableAdvisors?: AdvisorProfile[];
  selectedAdvisorIds?: string[];
  selectedAdvisors?: AdvisorProfile[];
  dialogue?: DialogueState;
};

const userSessionState = new Map<number, UserSessionState>();

// --- Constants ---
const MAX_FOLLOW_UPS = 3;
const REQUIRED_ADVISORS = 3;
const MAX_SITUATION_LENGTH = 2000;
const DEMO_CONSULTATIONS_LIMIT = 2;

function resetUserSessionState(chatId: number) {
  userSessionState.set(chatId, { stage: 'awaiting_situation' });
}

// --- Main Message Handler ---
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  // Get or create user in our DB
  const dbUser = await getUser(chatId);
  dbUser.firstName = msg.chat.first_name || '';
  dbUser.lastName = msg.chat.last_name || '';
  dbUser.username = msg.chat.username || '';
  await saveUser(dbUser);


  // Handle /start command separately to reset state
  if (text.startsWith('/start')) {
    resetUserSessionState(chatId);
    await bot.sendMessage(chatId, `Здравствуйте! Это демо-режим персонального "Совета директоров". У вас есть возможность разобрать ${DEMO_CONSULTATIONS_LIMIT} ситуации.\n\nОпишите вашу рабочую или жизненную ситуацию в 2-3 предложениях, и я подберу для вас 5 уникальных советников.`);
    return;
  }

  const currentState = userSessionState.get(chatId) || { stage: 'awaiting_situation' };

  try {
    switch (currentState.stage) {
      case 'awaiting_situation':
        await handleSituation(chatId, text, dbUser);
        break;
      
      case 'in_dialogue':
        if (!currentState.dialogue) {
          resetUserSessionState(chatId);
          await bot.sendMessage(chatId, 'Произошла ошибка в диалоге. Начинаем заново. Опишите вашу ситуацию.');
          return;
        }
        await handleFollowUp(chatId, text, currentState as Required<UserSessionState>, dbUser);
        break;

      case 'awaiting_advisor_selection':
        await bot.sendMessage(chatId, `Пожалуйста, выберите ${REQUIRED_ADVISORS} советников, нажимая на кнопки выше.`);
        break;
        
      default:
        resetUserSessionState(chatId);
        await bot.sendMessage(chatId, 'Произошла ошибка в логике. Начинаем заново. Опишите вашу ситуацию.');
        break;
    }
  } catch (error) {
    console.error('Error processing message:', error);
    resetUserSessionState(chatId);
    await bot.sendMessage(chatId, 'Произошла непредвиденная ошибка. Пожалуйста, начните заново с команды /start.');
  }
});


// --- Logic Flow Handlers ---

async function handleSituation(chatId: number, situation: string, dbUser: DbUser) {
  // Check if user has reached the demo limit
  if (dbUser.consultationsUsed >= DEMO_CONSULTATIONS_LIMIT) {
    await bot.sendMessage(chatId, `Демо-режим завершен. Для продолжения, пожалуйста, свяжитесь с @alexander_stashenko.`);
    await notifyAdmin(dbUser);
    return;
  }

  if (situation.length > MAX_SITUATION_LENGTH) {
    await bot.sendMessage(chatId, `Слишком длинное описание. Пожалуйста, сократите до ${MAX_SITUATION_LENGTH} символов.`);
    return;
  }

  await bot.sendChatAction(chatId, 'typing');
  await bot.sendMessage(chatId, 'Анализируем ситуацию и подбираем экспертов, 20-30 сек ...');
  
  const result = await selectAdvisors({ situationDescription: situation });

  if (!result || !result.advisors || result.advisors.length < REQUIRED_ADVISORS) {
    resetUserSessionState(chatId);
    await bot.sendMessage(chatId, 'Не удалось подобрать достаточное количество советников для вашей ситуации. Попробуйте переформулировать запрос или нажмите /start для начала.');
    return;
  }
  
  userSessionState.set(chatId, {
    stage: 'awaiting_advisor_selection',
    situation: situation,
    availableAdvisors: result.advisors,
    selectedAdvisorIds: [],
  });

  const keyboard = {
    inline_keyboard: result.advisors.map(advisor => ([{
      text: `${advisor.name} (${advisor.description})`,
      callback_data: `advisor_${advisor.id}`,
    }]))
  };

  await bot.sendMessage(chatId, `Отлично! Мы подобрали для вас 5 экспертов. Выберите ${REQUIRED_ADVISORS} из них:`, {
    reply_markup: keyboard,
  });
}

bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message!.chat.id;
    const data = callbackQuery.data;
    const messageId = callbackQuery.message!.message_id;

    if (!data || !data.startsWith('advisor_')) {
      await bot.answerCallbackQuery(callbackQuery.id);
      return;
    }
    
    const currentState = userSessionState.get(chatId);
    if (!currentState || currentState.stage !== 'awaiting_advisor_selection' || 
        !currentState.selectedAdvisorIds || !currentState.availableAdvisors) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Сессия истекла. Пожалуйста, начните сначала с /start."});
        return;
    }

    const advisorId = data.split('_')[1];
    const isSelected = currentState.selectedAdvisorIds.includes(advisorId);

    let updatedSelectedAdvisorIds: string[];

    if (isSelected) {
      updatedSelectedAdvisorIds = currentState.selectedAdvisorIds.filter(id => id !== advisorId);
    } else if (currentState.selectedAdvisorIds.length < REQUIRED_ADVISORS) {
      updatedSelectedAdvisorIds = [...currentState.selectedAdvisorIds, advisorId];
    } else {
      await bot.answerCallbackQuery(callbackQuery.id, { text: `Вы можете выбрать только ${REQUIRED_ADVISORS} советников.`, show_alert: true });
      return;
    }
    
    const updatedState = {
      ...currentState,
      selectedAdvisorIds: updatedSelectedAdvisorIds
    };
    userSessionState.set(chatId, updatedState);

    const oldKeyboard = callbackQuery.message!.reply_markup!.inline_keyboard;
    const newKeyboard = oldKeyboard.map(row => row.map(button => {
        const buttonAdvisorId = button.callback_data!.split('_')[1];
        const isButtonSelected = updatedSelectedAdvisorIds.includes(buttonAdvisorId);
        const buttonText = button.text.startsWith('✅ ') ? button.text.substring(2) : button.text;
        return {
            ...button,
            text: isButtonSelected ? `✅ ${buttonText}` : buttonText,
        };
    }));

    await bot.editMessageReplyMarkup({ inline_keyboard: newKeyboard }, { chat_id: chatId, message_id: messageId });
    await bot.answerCallbackQuery(callbackQuery.id);
    
    if (updatedSelectedAdvisorIds.length === REQUIRED_ADVISORS) {
        const selectedAdvisors = updatedState.availableAdvisors!.filter(
          advisor => updatedSelectedAdvisorIds.includes(advisor.id)
        );
        
        await bot.editMessageText(`Отличный выбор! Готовим персональные советы...`, { chat_id: chatId, message_id: messageId });
        await generateInitialAdvice(chatId, {
          ...updatedState,
          selectedAdvisors,
        } as Required<UserSessionState>);
    }
});


async function generateInitialAdvice(chatId: number, state: Required<UserSessionState>) {
    await bot.sendChatAction(chatId, 'typing');
    
    if (!state.selectedAdvisors || state.selectedAdvisors.length !== REQUIRED_ADVISORS) {
      resetUserSessionState(chatId);
      await bot.sendMessage(chatId, 'Ошибка валидации советников. Пожалуйста, начните заново с команды /start.');
      return;
    }
    
    const result = await simulateAdvisorAdvice({
        situationDescription: state.situation,
        selectedAdvisors: state.selectedAdvisors,
    });
    
    if (!result || !result.advisorAdvices || result.advisorAdvices.length === 0) {
        resetUserSessionState(chatId);
        await bot.sendMessage(chatId, "К сожалению, не удалось сгенерировать совет. Попробуйте переформулировать ваш запрос или нажмите /start для начала.");
        return;
    }

    let initialModelResponse = `*Общие рекомендации Совета:*\n${result.synthesis}\n\n`;
    initialModelResponse += '*Мнение каждого советника:*\n';

    const allAdvices: string[] = [];

    result.advisorAdvices.forEach(advice => {
        const profile = state.selectedAdvisors!.find(a => a.id === advice.advisorId);
        const advisorName = profile ? profile.name : advice.advisorId;
        const adviceText = `*${advisorName}:*\n${advice.advice}`;
        initialModelResponse += `\n${adviceText}\n`;
        allAdvices.push(`${advisorName}: ${advice.advice}`);
    });

    const combinedModelResponse = `${result.synthesis}\n\n${allAdvices.join('\n\n')}`;

    const newHistory: DialogueState['history'] = [
        { role: 'user', content: `Моя ситуация: ${state.situation}` },
        { role: 'model', content: combinedModelResponse },
    ];

    userSessionState.set(chatId, {
      ...state,
      stage: 'in_dialogue',
      dialogue: {
        history: newHistory,
        followUpsRemaining: MAX_FOLLOW_UPS,
      }
    });

    await bot.sendMessage(chatId, initialModelResponse, { parse_mode: 'Markdown' });
    await bot.sendMessage(chatId, `Теперь вы можете задать до ${MAX_FOLLOW_UPS} уточняющих вопросов любому из советников.`);
}


async function handleFollowUp(chatId: number, text: string, state: Required<UserSessionState>, dbUser: DbUser) {
    await bot.sendChatAction(chatId, 'typing');

    const followUpResult = await continueDialogue({
        question: text,
        history: state.dialogue.history,
    });

    const newHistory: DialogueState['history'] = [
        ...state.dialogue.history,
        { role: 'user', content: text },
        { role: 'model', content: followUpResult.answer }
    ];
    const followUpsRemaining = state.dialogue.followUpsRemaining - 1;

    userSessionState.set(chatId, {
      ...state,
      dialogue: {
        history: newHistory,
        followUpsRemaining: followUpsRemaining,
      }
    });

    await bot.sendMessage(chatId, followUpResult.answer, { parse_mode: 'Markdown' });

    if (followUpsRemaining > 0) {
        await bot.sendMessage(chatId, `Осталось вопросов: ${followUpsRemaining}.`);
    } else {
        // This consultation is now finished, increment the counter.
        dbUser.consultationsUsed++;
        await saveUser(dbUser);
        
        if (dbUser.consultationsUsed >= DEMO_CONSULTATIONS_LIMIT) {
          await bot.sendMessage(chatId, 'Спасибо! Надеемся, это было полезно!\n\nДемо-режим завершен. Для продолжения, пожалуйста, свяжитесь с @alexander_stashenko.');
          await notifyAdmin(dbUser);
        } else {
          await bot.sendMessage(chatId, 'Спасибо! Надеемся, это было полезно! Чтобы начать новую консультацию, просто опишите вашу следующую ситуацию.');
        }

        resetUserSessionState(chatId);
    }
}

async function notifyAdmin(dbUser: DbUser) {
    if (!adminChatId) {
        console.warn("ADMIN_CHAT_ID is not set. Cannot send notification.");
        return;
    }

    const { chatId, firstName, lastName, username, consultationsUsed } = dbUser;
    let userNameString = firstName;
    if (lastName) userNameString += ` ${lastName}`;
    if (username) userNameString += ` (@${username})`;

    const message = `
Пользователь завершил демо-доступ.

- ID: ${chatId}
- Имя: ${userNameString}
- Использовано консультаций: ${consultationsUsed}
    `;

    try {
        await bot.sendMessage(adminChatId, message.trim());
    } catch (error) {
        console.error(`Failed to send notification to admin (${adminChatId}):`, error);
    }
}

// --- Error Handling & Graceful Shutdown ---

bot.on('polling_error', (error) => {
  if ((error as any).code === 'ETELEGRAM' && (error as any).message.includes('409 Conflict')) {
    console.error('CRITICAL: Another instance of the bot is already running. This instance will be terminated.');
    console.error('Please make sure to stop all other running bot processes.');
    process.exit(1); 
  } else {
    console.error('Polling error:', error);
  }
});

console.log('Telegram bot started...');

const cleanup = async () => {
  console.log('Stopping Telegram bot...');
  try {
      if (bot.isPolling()) {
          await bot.stopPolling({ cancel: true });
      }
  } catch (err) {
      console.error('Error stopping polling:', err);
  }
  console.log('Telegram bot stopped.');
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
