'use server';
import 'dotenv/config';
import './ai/genkit'; // Initialize Genkit
import TelegramBot from 'node-telegram-bot-api';
import { simulateAdvisorAdvice } from '@/ai/flows/simulate-advisor-advice';
import { continueDialogue } from '@/ai/flows/continue-dialogue';
import { selectAdvisors, type AdvisorProfile } from '@/ai/flows/select-advisors';

const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.ADMIN_CHAT_ID;

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not defined in .env file');
}

if (!adminChatId) {
  throw new Error('ADMIN_CHAT_ID is not defined in .env file');
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
  completedSessions?: number; // Количество завершенных сессий (для демо-режима)
  username?: string; // Username пользователя для отчета админу
  firstName?: string; // Имя пользователя для отчета админу
  maxSessions?: number; // Максимальное количество сессий (по умолчанию MAX_DEMO_SESSIONS)
};

const userState = new Map<number, UserState>();
const MAX_FOLLOW_UPS = 3;
const REQUIRED_ADVISORS = 3;
const MAX_SITUATION_LENGTH = 2000;
const MAX_DEMO_SESSIONS = 2;

function resetUserState(chatId: number, preserveSessionCount: boolean = false) {
  const currentState = userState.get(chatId);
  const completedSessions = preserveSessionCount && currentState?.completedSessions
    ? currentState.completedSessions
    : 0;
  const maxSessions = preserveSessionCount ? currentState?.maxSessions : undefined;
  const username = preserveSessionCount ? currentState?.username : undefined;
  const firstName = preserveSessionCount ? currentState?.firstName : undefined;

  userState.set(chatId, {
    stage: 'awaiting_situation',
    completedSessions,
    maxSessions,
    username,
    firstName
  });
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  // Handle admin commands
  if (text.startsWith('/grant10') && chatId.toString() === adminChatId) {
    const parts = text.split(' ');
    if (parts.length !== 2) {
      await bot.sendMessage(chatId, '✅ Использование: /grant10 <user_id>');
      return;
    }
    const targetUserId = parseInt(parts[1]);
    if (isNaN(targetUserId)) {
      await bot.sendMessage(chatId, '❌ Неверный User ID');
      return;
    }
    const targetState = userState.get(targetUserId) || { stage: 'awaiting_situation' as const };
    const currentMax = targetState.maxSessions || MAX_DEMO_SESSIONS;
    userState.set(targetUserId, {
      ...targetState,
      maxSessions: currentMax + 10
    });
    await bot.sendMessage(chatId, `✅ Пользователю ${targetUserId} добавлено 10 сессий. Новый лимит: ${currentMax + 10}`);
    return;
  }

  // Handle /start command separately to reset state
  if (text.startsWith('/start')) {
    resetUserState(chatId, true); // Сохраняем счетчик сессий чтобы предотвратить обход лимита демо
    await bot.sendMessage(chatId,
      `Здравствуйте! 👋\n\n` +
      `Опишите вашу рабочую или жизненную ситуацию в 3-4 предложениях, и мы подберем для вас 5 экспертов для вашего персонального Совета директоров.`
    );
    return;
  }

  const currentState = userState.get(chatId) || { stage: 'awaiting_situation' };

  try {
    switch (currentState.stage) {
      case 'awaiting_situation':
        await handleSituation(chatId, text, msg.from?.username, msg.from?.first_name);
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
        await bot.sendMessage(chatId, `Пожалуйста, выберите ${REQUIRED_ADVISORS} советников, нажимая на кнопки выше.`);
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

async function handleSituation(chatId: number, situation: string, username?: string, firstName?: string) {
  // Проверка лимита демо-сессий
  const currentState = userState.get(chatId);
  const completedSessions = currentState?.completedSessions || 0;
  const maxSessions = currentState?.maxSessions || MAX_DEMO_SESSIONS;

  if (completedSessions >= maxSessions) {
    await bot.sendMessage(chatId,
      `🎯 Демо-версия завершена!

` +
      `Вы прошли ${MAX_DEMO_SESSIONS} консультации. ` +
      `Надеемся, это было полезно! Если вы хотите продолжить общение с Советом - свяжитесь с @alexander_stashenko`
    );
    return;
  }

  if (situation.length > MAX_SITUATION_LENGTH) {
    await bot.sendMessage(chatId, `Слишком длинное описание. Пожалуйста, сократите до ${MAX_SITUATION_LENGTH} символов.`);
    return;
  }

  await bot.sendChatAction(chatId, 'typing');
  await bot.sendMessage(chatId, 'Анализируем ситуацию и подбираем экспертов, 20-30 сек...');

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
    username: username,
    firstName: firstName,
    completedSessions: currentState?.completedSessions || 0,
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

  const currentState = userState.get(chatId);
  if (!currentState || currentState.stage !== 'awaiting_advisor_selection' ||
    !currentState.selectedAdvisorIds || !currentState.availableAdvisors) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: "Сессия истекла. Пожалуйста, начните сначала с /start." });
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

    await bot.editMessageText(`Отличный выбор! Готовим персональные советы...`, { chat_id: chatId, message_id: messageId });
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
    await bot.sendMessage(chatId, "К сожалению, не удалось сгенерировать Совет. Попробуйте переформулировать ваш запрос или нажмите /start для начала.");
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
  await bot.sendMessage(chatId, `Теперь вы можете задать до ${MAX_FOLLOW_UPS} уточняющих вопросов любому из советников. Укажите его имя в начале вопроса.`);
}

// Отправка отчета администратору
async function sendAdminReport(
  chatId: number,
  sessionNumber: number,
  situation: string,
  allAdvisors: AdvisorProfile[],
  selectedAdvisorIds: string[],
  username?: string,
  firstName?: string
) {
  try {
    let report = `📊 *Отчет о завершенной сессии*\n\n`;
    report += `👤 *User:* ${firstName || 'Без имени'}`;
    if (username) {
      report += ` (@${username})`;
    }
    report += `\n🆔 *ID:* \`${chatId}\`\n`;
    report += `🔑 *Grant:* \`/grant10 ${chatId}\`\n`;
    report += `🔢 *Сессия:* ${sessionNumber}/${MAX_DEMO_SESSIONS}\n\n`;
    report += `📝 *Исходный запрос пользователя:*\n${situation}\n\n`;
    report += `👥 *Предложенные эксперты:*\n`;

    allAdvisors.forEach((advisor, index) => {
      const isSelected = selectedAdvisorIds.includes(advisor.id);
      const marker = isSelected ? '✅' : '▫️';
      report += `${index + 1}. ${marker} *${advisor.name}* — ${advisor.description}\n`;
    });

    await bot.sendMessage(adminChatId!, report, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error sending admin report:', error);
  }
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

  await bot.sendMessage(chatId, followUpResult.answer, { parse_mode: 'Markdown' });

  if (followUpsRemaining > 0) {
    // Еще есть вопросы - обновляем state с новым диалогом
    userState.set(chatId, {
      ...state,
      dialogue: {
        history: newHistory,
        followUpsRemaining: followUpsRemaining,
      }
    });
    await bot.sendMessage(chatId, `Осталось вопросов: ${followUpsRemaining}.`);
  } else {
    // Сессия завершена
    const completedSessions = (state.completedSessions || 0) + 1;
    const maxSessions = state.maxSessions || MAX_DEMO_SESSIONS;

    // Обновить счетчик сессий в state
    userState.set(chatId, {
      ...state,
      completedSessions: completedSessions,
    });

    // Отправить отчет админу (всегда, независимо от номера сессии)
    if (state.situation && state.availableAdvisors && state.selectedAdvisorIds) {
      await sendAdminReport(
        chatId,
        completedSessions,
        state.situation,
        state.availableAdvisors,
        state.selectedAdvisorIds,
        state.username,
        state.firstName
      );
    }

    if (completedSessions < maxSessions) {
      await bot.sendMessage(chatId,
        `Надеемся, это было полезно! ✨\n\n` +
        `Вы завершили ${completedSessions} из ${maxSessions} демо-сессий. ` +
        `Чтобы начать новую консультацию, просто опишите вашу следующую ситуацию.`
      );
      resetUserState(chatId, true); // Сохраняем счетчик сессий
    } else {
      await bot.sendMessage(chatId,
        `🎯 Демо-версия завершена!

` +
        `Вы прошли ${maxSessions} консультации. ` +
        `Надеемся, это было полезно! Если вы хотите продолжить общение с Советом - свяжитесь с @alexander_stashenko`
      );
      resetUserState(chatId, true); // Сохраняем счетчик для блокировки
    }
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


