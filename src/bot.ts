'use server';
import 'dotenv/config';
import './ai/genkit'; // Initialize Genkit
import TelegramBot from 'node-telegram-bot-api';
import { simulateAdvisorAdvice } from '@/ai/flows/simulate-advisor-advice';
import { continueDialogue } from '@/ai/flows/continue-dialogue';
import { selectAdvisors } from '@/ai/flows/select-advisors';
import { advisorProfiles } from '@/ai/advisors';

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
  selectedAdvisors?: string[];
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
    await bot.sendMessage(chatId, `Здравствуйте! Опишите вашу ситуацию, и я предложу вам 5 персон, наиболее подходящих для вашего персонального Совета директоров.`);
    return; // CRITICAL FIX: Stop further execution for /start command
  }

  const currentState = userState.get(chatId) || { stage: 'awaiting_situation' };

  try {
    switch (currentState.stage) {
      case 'awaiting_situation':
        await handleSituation(chatId, text);
        break;
      
      case 'in_dialogue':
        if (!currentState.dialogue) { // Should not happen
          resetUserState(chatId);
          await bot.sendMessage(chatId, 'Произошла ошибка в диалоге. Начинаем заново. Опишите вашу ситуацию.');
          return;
        }
        await handleFollowUp(chatId, text, currentState as Required<UserState>);
        break;

      case 'awaiting_advisor_selection':
        // If user sends a message while they should be clicking buttons
        await bot.sendMessage(chatId, `Пожалуйста, выберите ровно ${REQUIRED_ADVISORS} советников, нажимая на кнопки выше.`);
        break;
        
      default:
        // Fallback for any unknown state
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
  // FIX #7: Проверка длины входных данных
  if (situation.length > MAX_SITUATION_LENGTH) {
    await bot.sendMessage(chatId, `Слишком длинное описание. Пожалуйста, сократите до ${MAX_SITUATION_LENGTH} символов.`);
    return;
  }

  await bot.sendChatAction(chatId, 'typing');
  
  const potentialAdvisors = await selectAdvisors({ situationDescription: situation });

  // FIX #1: Сброс состояния при ошибке подбора советников
  if (!potentialAdvisors || potentialAdvisors.advisors.length < REQUIRED_ADVISORS) {
    resetUserState(chatId);
    await bot.sendMessage(chatId, 'Не удалось подобрать достаточное количество советников для вашей ситуации. Попробуйте переформулировать запрос или нажмите /start для начала.');
    return;
  }
  
  userState.set(chatId, {
    stage: 'awaiting_advisor_selection',
    situation: situation,
    selectedAdvisors: [],
  });

  const keyboard = {
    inline_keyboard: potentialAdvisors.advisors.map(advisor => ([{
      text: `${advisor.name} (${advisor.description})`,
      callback_data: `advisor_${advisor.id}`,
    }]))
  };

  await bot.sendMessage(chatId, `Отлично, я подобрал для вас 5 потенциальных советников. Выберите ровно ${REQUIRED_ADVISORS} из них:`, {
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
    
    // FIX #6: Читаем свежее состояние перед модификацией
    const currentState = userState.get(chatId);
    if (!currentState || currentState.stage !== 'awaiting_advisor_selection' || !currentState.selectedAdvisors) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Сессия истекла. Пожалуйста, начните сначала с /start."});
        return;
    }

    const advisorId = data.split('_')[1];
    const isSelected = currentState.selectedAdvisors.includes(advisorId);

    // Создаем новый массив для избежания мутации
    let updatedSelectedAdvisors: string[];

    if (isSelected) {
      // Deselect
      updatedSelectedAdvisors = currentState.selectedAdvisors.filter(id => id !== advisorId);
    } else if (currentState.selectedAdvisors.length < REQUIRED_ADVISORS) {
      // Select
      updatedSelectedAdvisors = [...currentState.selectedAdvisors, advisorId];
    } else {
      // Max number of advisors already selected
      await bot.answerCallbackQuery(callbackQuery.id, { text: `Вы можете выбрать только ${REQUIRED_ADVISORS} советников.`, show_alert: true });
      return;
    }
    
    // Обновляем состояние с новым массивом
    const updatedState = {
      ...currentState,
      selectedAdvisors: updatedSelectedAdvisors
    };
    userState.set(chatId, updatedState);

    // Update keyboard to show checkmarks
    const oldKeyboard = callbackQuery.message!.reply_markup!.inline_keyboard;
    const newKeyboard = oldKeyboard.map(row => row.map(button => {
        const buttonAdvisorId = button.callback_data!.split('_')[1];
        const isButtonSelected = updatedSelectedAdvisors.includes(buttonAdvisorId);
        // Clean text first by removing any existing checkmark
        const buttonText = button.text.startsWith('✅ ') ? button.text.substring(2) : button.text;
        return {
            ...button,
            text: isButtonSelected ? `✅ ${buttonText}` : buttonText,
        };
    }));

    await bot.editMessageReplyMarkup({ inline_keyboard: newKeyboard }, { chat_id: chatId, message_id: messageId });
    await bot.answerCallbackQuery(callbackQuery.id);
    
    // Check if we have enough advisors to proceed
    if (updatedSelectedAdvisors.length === REQUIRED_ADVISORS) {
        await bot.editMessageText(`Отличный выбор! Готовлю персональные советы...`, { chat_id: chatId, message_id: messageId });
        await generateInitialAdvice(chatId, updatedState as Required<UserState>);
    }
});


async function generateInitialAdvice(chatId: number, state: Required<UserState>) {
    await bot.sendChatAction(chatId, 'typing');
    
    // FIX #4: Валидация выбранных советников
    const validAdvisors = state.selectedAdvisors.filter(
      id => id in advisorProfiles
    );

    if (validAdvisors.length !== REQUIRED_ADVISORS) {
      resetUserState(chatId);
      await bot.sendMessage(chatId, 'Ошибка валидации советников. Пожалуйста, начните заново с команды /start.');
      return;
    }
    
    const result = await simulateAdvisorAdvice({
        situationDescription: state.situation,
        selectedAdvisors: validAdvisors,
    });
    
    // FIX #5: Улучшено сообщение об ошибке
    if (!result || !result.advisorAdvices || result.advisorAdvices.length === 0) {
        resetUserState(chatId);
        await bot.sendMessage(chatId, "К сожалению, не удалось сгенерировать совет. Попробуйте переформулировать ваш запрос или нажмите /start для начала.");
        return;
    }

    let initialModelResponse = `*Общие рекомендации Совета:*\n${result.synthesis}\n\n`;
    initialModelResponse += '*Мнение каждого советника:*\n';

    // FIX #2: Упрощенная история диалога - одно model сообщение
    const allAdvices: string[] = [];

    result.advisorAdvices.forEach(advice => {
        const profile = advisorProfiles[advice.advisorId as keyof typeof advisorProfiles];
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
    await bot.sendMessage(chatId, `Теперь вы можете задать до ${MAX_FOLLOW_UPS} уточняющих вопросов любому из советников. Например: "Стив, что ты думаешь о..."`);
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
    if ((error as any).code === 'ETELEGRAM' && (error as any).message.includes('409 Conflict')) {
        // console.log('Ignoring ETELEGRAM 409 Conflict error during development restart.');
    } else {
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
