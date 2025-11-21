'use server';
import 'dotenv/config';
import './ai/genkit'; // Initialize Genkit
import TelegramBot from 'node-telegram-bot-api';
import { simulateAdvisorAdvice } from '@/ai/flows/simulate-advisor-advice';
import { continueDialogue } from '@/ai/flows/continue-dialogue';
import { selectAdvisors, type AdvisorProfile } from '@/ai/flows/select-advisors';

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not defined in .env file');
}

const bot = new TelegramBot(token, { polling: true });

// -- State Management --
type DialogueState = {
  history: Array<{ role: 'user' | 'model'; content: string }>;
  followUpsRemaining: number;
};

type UserState = {
  stage: 'awaiting_situation' | 'awaiting_advisor_selection' | 'in_dialogue';
  situation?: string;
  availableAdvisors?: AdvisorProfile[]; // Все 5 сгенерированных профилей
  selectedAdvisorIds?: string[]; // ID выбранных пользователем
  selectedAdvisors?: AdvisorProfile[]; // Полные профили выбранных
  dialogue?: DialogueState;
};

const userState = new Map<number, UserState>();
const MAX_FOLLOW_UPS = 3;
const REQUIRED_ADVISORS = 3;
const MAX_SITUATION_LENGTH = 2000;

function resetUserState(chatId: number) {
  userState.set(chatId, { stage: 'awaiting_situation' });
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  // Handle /start command separately to reset state
  if (text.startsWith('/start')) {
    resetUserState(chatId);
    await bot.sendMessage(chatId, `Здравствуйте! Опишите вашу ситуацию, и я подберу для вас 5 персон, наиболее подходящих для вашего персонального Совета директоров.`);
    return;
  }

  const currentState = userState.get(chatId) || { stage: 'awaiting_situation' };

  try {
    switch (currentState.stage) {
      case 'awaiting_situation':
        await handleSituation(chatId, text);
        break;
      
      case 'in_dialogue':
        if (!currentState.dialogue) {
          resetUserState(chatId);
          await bot.sendMessage(chatId, 'Произошла ошибка в диалоге. Начинаем заново. Опишите вашу ситуацию.');
          return;
        }
        await handleFollowUp(chatId, text, currentState as Required<UserState>);
        break;

      case 'awaiting_advisor_selection':
        await bot.sendMessage(chatId, `Пожалуйста, выберите ровно ${REQUIRED_ADVISORS} советников, нажимая на кнопки выше.`);
        break;
        
      default:
        resetUserState(chatId);
        await bot.sendMessage(chatId, 'Произошла ошибка в логике. Начинаем заново. Опишите вашу ситуацию.');
        break;
    }
  } catch (error) {
    console.error('Error processing message:', error);
    resetUserState(chatId);
    await bot.sendMessage(chatId, 'Произошла непредвиденная ошибка. Пожалуйста, начните заново с команды /start.');
  }
});

async function handleSituation(chatId: number, situation: string) {
  if (situation.length > MAX_SITUATION_LENGTH) {
    await bot.sendMessage(chatId, `Слишком длинное описание. Пожалуйста, сократите до ${MAX_SITUATION_LENGTH} символов.`);
    return;
  }

  await bot.sendChatAction(chatId, 'typing');
  await bot.sendMessage(chatId, 'Анализирую ситуацию и подбираю экспертов...');
  
  const result = await selectAdvisors({ situationDescription: situation });

  if (!result || !result.advisors || result.advisors.length < REQUIRED_ADVISORS) {
    resetUserState(chatId);
    await bot.sendMessage(chatId, 'Не удалось подобрать достаточное количество советников для вашей ситуации. Попробуйте переформулировать запрос или нажмите /start для начала.');
    return;
  }
  
  userState.set(chatId, {
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

  await bot.sendMessage(chatId, `Отлично! Я подобрал для вас 5 экспертов. Выберите ровно ${REQUIRED_ADVISORS} из них:`, {
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
    
    const currentState = userState.get(chatId);
    if (!currentState || currentState.stage !== 'awaiting_advisor_selection' || 
        !currentState.selectedAdvisorIds || !currentState.availableAdvisors) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Сессия истекла. Пожалуйста, начните сначала с /start."});
        return;
    }

    const advisorId = data.split('_')[1];
    const isSelected = currentState.selectedAdvisorIds.includes(advisorId);

    let updatedSelectedAdvisorIds: string[];

    if (isSelected) {
      // Deselect
      updatedSelectedAdvisorIds = currentState.selectedAdvisorIds.filter(id => id !== advisorId);
    } else if (currentState.selectedAdvisorIds.length < REQUIRED_ADVISORS) {
      // Select
      updatedSelectedAdvisorIds = [...currentState.selectedAdvisorIds, advisorId];
    } else {
      // Max number already selected
      await bot.answerCallbackQuery(callbackQuery.id, { text: `Вы можете выбрать только ${REQUIRED_ADVISORS} советников.`, show_alert: true });
      return;
    }
    
    const updatedState = {
      ...currentState,
      selectedAdvisorIds: updatedSelectedAdvisorIds
    };
    userState.set(chatId, updatedState);

    // Update keyboard to show checkmarks
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
    
    // Check if we have enough advisors to proceed
    if (updatedSelectedAdvisorIds.length === REQUIRED_ADVISORS) {
        // Get full profiles of selected advisors
        const selectedAdvisors = updatedState.availableAdvisors!.filter(
          advisor => updatedSelectedAdvisorIds.includes(advisor.id)
        );
        
        await bot.editMessageText(`Отличный выбор! Готовлю персональные советы...`, { chat_id: chatId, message_id: messageId });
        await generateInitialAdvice(chatId, {
          ...updatedState,
          selectedAdvisors,
        } as Required<UserState>);
    }
});


async function generateInitialAdvice(chatId: number, state: Required<UserState>) {
    await bot.sendChatAction(chatId, 'typing');
    
    // Validate selected advisors
    if (!state.selectedAdvisors || state.selectedAdvisors.length !== REQUIRED_ADVISORS) {
      resetUserState(chatId);
      await bot.sendMessage(chatId, 'Ошибка валидации советников. Пожалуйста, начните заново с команды /start.');
      return;
    }
    
    const result = await simulateAdvisorAdvice({
        situationDescription: state.situation,
        selectedAdvisors: state.selectedAdvisors,
    });
    
    if (!result || !result.advisorAdvices || result.advisorAdvices.length === 0) {
        resetUserState(chatId);
        await bot.sendMessage(chatId, "К сожалению, не удалось сгенерировать совет. Попробуйте переформулировать ваш запрос или нажмите /start для начала.");
        return;
    }

    let initialModelResponse = `*Общие рекомендации Совета:*\n${result.synthesis}\n\n`;
    initialModelResponse += '*Мнение каждого советника:*\n';

    const allAdvices: string[] = [];

    result.advisorAdvices.forEach(advice => {
        // Find advisor profile by id
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

    userState.set(chatId, {
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


async function handleFollowUp(chatId: number, text: string, state: Required<UserState>) {
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

    userState.set(chatId, {
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
        await bot.sendMessage(chatId, 'Надеемся, это было полезно! Чтобы начать новую консультацию, просто опишите вашу следующую ситуацию.');
        resetUserState(chatId);
    }
}


// Suppress the ETELEGRAM error in the development environment
bot.on('polling_error', (error) => {
  // ETELEGRAM error 409: Conflict - Another instance of the bot is already running.
  if ((error as any).code === 'ETELEGRAM' && (error as any).message.includes('409 Conflict')) {
    console.error('CRITICAL: Another instance of the bot is already running. This instance will be terminated.');
    console.error('Please make sure to stop all other running bot processes.');
    process.exit(1); // Exit with a failure code
  } else {
    // For any other polling error, just log it.
    console.error('Polling error:', error);
  }
});

console.log('Telegram bot started...');

// Graceful shutdown
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

    