// This is a bundle of all relevant source code files for review purposes.
// Each file's content is wrapped in a block with its path.

// =================================================================================
// FILE: /home/user/studio/src/bot.ts
// =================================================================================

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
  await bot.sendChatAction(chatId, 'typing');
  
  const potentialAdvisors = await selectAdvisors({ situationDescription: situation });

  if (!potentialAdvisors || potentialAdvisors.advisors.length < REQUIRED_ADVISORS) {
    await bot.sendMessage(chatId, 'Не удалось подобрать достаточное количество советников для вашей ситуации. Попробуйте переформулировать запрос.');
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
    
    const currentState = userState.get(chatId);
    if (!currentState || currentState.stage !== 'awaiting_advisor_selection' || !currentState.selectedAdvisors) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Сессия истекла. Пожалуйста, начните сначала с /start."});
        return;
    }

    const advisorId = data.split('_')[1];
    const isSelected = currentState.selectedAdvisors.includes(advisorId);

    if (isSelected) {
      // Deselect
      currentState.selectedAdvisors = currentState.selectedAdvisors.filter(id => id !== advisorId);
    } else if (currentState.selectedAdvisors.length < REQUIRED_ADVISORS) {
      // Select
      currentState.selectedAdvisors.push(advisorId);
    } else {
      // Max number of advisors already selected
      await bot.answerCallbackQuery(callbackQuery.id, { text: `Вы можете выбрать только ${REQUIRED_ADVISORS} советников.`, show_alert: true });
      return;
    }
    
    // CRITICAL: Save state AFTER modification.
    userState.set(chatId, currentState);

    // Update keyboard to show checkmarks
    const oldKeyboard = callbackQuery.message!.reply_markup!.inline_keyboard;
    const newKeyboard = oldKeyboard.map(row => row.map(button => {
        const buttonAdvisorId = button.callback_data!.split('_')[1];
        const isButtonSelected = currentState.selectedAdvisors!.includes(buttonAdvisorId);
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
    if (currentState.selectedAdvisors.length === REQUIRED_ADVISORS) {
        await bot.editMessageText(`Отличный выбор! Готовлю персональные советы...`, { chat_id: chatId, message_id: messageId });
        await generateInitialAdvice(chatId, currentState as Required<UserState>);
    }
});


async function generateInitialAdvice(chatId: number, state: Required<UserState>) {
    await bot.sendChatAction(chatId, 'typing');
    
    const result = await simulateAdvisorAdvice({
        situationDescription: state.situation,
        selectedAdvisors: state.selectedAdvisors,
    });
    
    if (!result || !result.advisorAdvices || result.advisorAdvices.length === 0) {
        await bot.sendMessage(chatId, "К сожалению, не удалось сгенерировать совет. Попробуйте переформулировать ваш запрос.");
        resetUserState(chatId);
        return;
    }

    let initialModelResponse = `*Общие рекомендации Совета:*\n${result.synthesis}\n\n`;
    initialModelResponse += '*Мнение каждого советника:*\n';

    const newHistory: DialogueState['history'] = [
        { role: 'user', content: `Моя ситуация: ${state.situation}` },
        { role: 'model', content: result.synthesis },
    ];

    result.advisorAdvices.forEach(advice => {
        const profile = advisorProfiles[advice.advisorId as keyof typeof advisorProfiles];
        const advisorName = profile ? profile.name : advice.advisorId;
        const adviceText = `*${advisorName}:*\n${advice.advice}\n`;
        initialModelResponse += `\n${adviceText}`;
        newHistory.push({ role: 'model', content: `Ответ от ${advisorName}: ${advice.advice}` });
    });

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

// =================================================================================
// FILE: /home/user/studio/src/ai/genkit.ts
// =================================================================================

import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

export const ai = genkit({
  plugins: [googleAI()],
  model: 'googleai/gemini-2.5-flash',
});

// =================================================================================
// FILE: /home/user/studio/src/ai/advisors.ts
// =================================================================================

// This file contains the pool of potential advisors for the bot.

type AdvisorProfile = {
  name: string;
  style: string;
  principles: string;
  tone: string;
};

export const advisorProfiles: Record<string, AdvisorProfile> = {
  NavalRavikant: {
    name: 'Наваль Равикант',
    style: 'Философский, стратегический, долгосрочное мышление, аналогии.',
    principles:
      'Ищите богатство, а не деньги или статус. Создавайте специфические знания. Используйте рычаги: код, медиа, капитал. Читайте то, что любите. Свободные рынки и личная ответственность.',
    tone: 'Спокойный, вдумчивый, проницательный',
  },
  PieterLevels: {
    name: 'Питер Левелс',
    style: 'Практичный, тактический, конкретные шаги, фокус на исполнении.',
    principles:
      'Стройте на публике, запускайте быстро, итерируйте. MVP -> доход -> масштабирование. Автоматизация и соло-предпринимательство. Решения, основанные на данных. Бутстрэппинг.',
    tone: 'Прямой, техничный, с юмором',
  },
  GaryVaynerchuk: {
    name: 'Гэри Вайнерчук',
    style: 'Энергичный, мотивационный, ориентированный на действие, трудовая этика.',
    principles:
      'Максимальное исполнение. Документируйте, а не создавайте. Внимание — главная валюта. Самосознание. Терпение + агрессия. Долгосрочное построение бренда.',
    tone: 'Страстный, интенсивный, реалистичный',
  },
  SteveJobs: {
    name: 'Стив Джобс',
    style: 'Визионерский, одержимый продуктом, интуитивный, бескомпромиссный.',
    principles:
      'Думай иначе. Начинай с пользовательского опыта. Простота — высшая форма сложности. Качество важнее количества. Говори "нет" тысяче вещей. Соединяй точки, глядя назад.',
    tone: 'Требовательный, вдохновляющий, харизматичный',
  },
  JordanPeterson: {
    name: 'Джордан Питерсон',
    style: 'Психологический, философский, аналитический, структурированный.',
    principles:
      'Приведите свой дом в идеальный порядок, прежде чем критиковать мир. Берите на себя ответственность. Говорите правду. Стремитесь к тому, что имеет смысл, а не к тому, что целесообразно.',
    tone: 'Серьезный, академический, прямой',
  },
  PavelDurov: {
    name: 'Павел Дуров',
    style: 'Принципиальный, аскетичный, сфокусированный на свободе и продукте.',
    principles:
      'Независимость и свобода превыше всего. Конкуренция — двигатель прогресса. Продукт должен говорить сам за себя. Небольшая, но эффективная команда. Отказ от излишеств.',
    tone: 'Сдержанный, нонконформистский, уверенный',
  },
  DavidOgilvy: {
    name: 'Дэвид Огилви',
    style: 'Ориентированный на клиента, основанный на исследованиях, элегантный.',
    principles:
      'Потребитель не идиот; она твоя жена. Самое главное — продавать. Никогда не прекращайте тестировать, и ваша реклама никогда не перестанет улучшаться. Пишите так, как вы говорите.',
    tone: 'Авторитетный, остроумный, профессиональный',
  },
  IlyaVarlamov: {
    name: 'Илья Варламов',
    style: 'Урбанистический, критический, ориентированный на детали, визуальный.',
    principles:
      'Город должен быть для людей, а не для машин. Дьявол кроется в деталях (скамейки, урны, плитка). Критикуя, предлагай. Путешествия расширяют кругозор и дают лучшие практики.',
    tone: 'Прямолинейный, саркастичный, неравнодушный',
  },
  ArtemyLebedev: {
    name: 'Артемий Лебедев',
    style: 'Провокационный, прагматичный, системный, с юмором.',
    principles:
      'Дизайн — это не картинка, а решение задачи. Долго, дорого, охуенно. Любой каприз за ваши деньги. Правил нет. здравый смысл и опыт решают.',
    tone: 'Циничный, самоуверенный, образовательный',
  },
  KaterinaLengold: {
    name: 'Катерина Ленгольд',
    style: 'Системный, ориентированный на agile-подход к жизни, практичный.',
    principles:
      'Agile-спринты для жизненных целей. Чередование работы и отдыха. Регулярная рефлексия и корректировка планов. Космос как метафора безграничных возможностей и жестких ограничений.',
    tone: 'Структурированный, спокойный, мотивирующий',
  },
   ElonMusk: {
    name: 'Илон Маск',
    style: 'Инженерный, амбициозный, работа от первых принципов, интенсивный.',
    principles: 'Рассматривайте проблему с точки зрения физики (first principles). Работайте много. Цельтесь в цели, которые вдохновляют человечество. Упрощайте и автоматизируйте.',
    tone: 'Напористый, визионерский, иногда неловкий',
  },
  JeffBezos: {
    name: 'Джефф Безос',
    style: 'Одержимость клиентом, долгосрочное мышление, операционная эффективность.',
    principles: 'Всегда "День 1". Начинайте с клиента и работайте в обратном направлении. Принимайте быстрые решения с 70% информации. Сосредоточьтесь на том, что НЕ изменится.',
    tone: 'Аналитический, методичный, ориентированный на рост',
  }
};

// =================================================================================
// FILE: /home/user/studio/src/ai/flows/select-advisors.ts
// =================================================================================

'use server';
/**
 * @fileOverview Dynamically selects advisors based on the user's situation.
 *
 * - selectAdvisors - A function that selects the most relevant advisors.
 * - SelectAdvisorsInput - The input type for the selectAdvisors function.
 * - SelectAdvisorsOutput - The return type for the selectAdvisors function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import {advisorProfiles} from '@/ai/advisors';

const SelectAdvisorsInputSchema = z.object({
  situationDescription: z.string().describe('The user-provided description of their situation.'),
});
export type SelectAdvisorsInput = z.infer<typeof SelectAdvisorsInputSchema>;

const SelectAdvisorsOutputSchema = z.object({
  advisors: z
    .array(
      z.object({
        id: z.string().describe('The unique identifier for the advisor.'),
        name: z.string().describe('The name of the advisor.'),
        description: z.string().describe('A very brief (3-5 word) description of the advisor\'s expertise relevant to the specific situation.'),
      })
    )
    .length(5)
    .describe('An array of exactly 5 selected advisors.'),
});
export type SelectAdvisorsOutput = z.infer<typeof SelectAdvisorsOutputSchema>;

export async function selectAdvisors(
  input: SelectAdvisorsInput
): Promise<SelectAdvisorsOutput> {
  return selectAdvisorsFlow(input);
}

const selectAdvisorsPrompt = ai.definePrompt({
  name: 'selectAdvisorsPrompt',
  input: {
    schema: z.object({
      situationDescription: z.string(),
      advisorList: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
        })
      ),
    }),
  },
  output: {schema: SelectAdvisorsOutputSchema},
  prompt: `You are an expert at assembling personal advisory boards.
Your task is to select the 5 most relevant advisors from the provided list to help with the user's situation. Ensure a diversity of perspectives. Your response MUST be in Russian.

USER'S SITUATION:
"{{situationDescription}}"

AVAILABLE ADVISORS:
{{#each advisorList}}
- ID: {{this.id}}, Name: {{this.name}}, Expertise: {{this.description}}
{{/each}}

INSTRUCTIONS:
1.  Analyze the user's situation carefully.
2.  Select exactly 5 advisors from the list who would provide the most valuable and diverse insights for this specific problem.
3.  For each of the 5 selected advisors, write a new, very concise (3-5 word) description explaining why they are a good fit for THIS situation.
4.  Output the result in the specified JSON format. The 'id' and 'name' must match the original advisor data exactly.
`,
});

const selectAdvisorsFlow = ai.defineFlow(
  {
    name: 'selectAdvisorsFlow',
    inputSchema: SelectAdvisorsInputSchema,
    outputSchema: SelectAdvisorsOutputSchema,
  },
  async input => {
    // Convert the advisorProfiles object into the format the prompt expects
    const advisorList = Object.entries(advisorProfiles).map(
      ([id, profile]) => ({
        id,
        name: profile.name,
        // The description here is a general one for the model to use for selection
        description: `${profile.style} ${profile.principles}`,
      })
    );
    
    const {output} = await selectAdvisorsPrompt({
      situationDescription: input.situationDescription,
      advisorList,
    });
    
    if (!output) {
      throw new Error('AI model returned no output for advisor selection.');
    }
    
    return output;
  }
);

// =================================================================================
// FILE: /home/user/studio/src/ai/flows/simulate-advisor-advice.ts
// =================================================================================

'use server';

/**
 * @fileOverview Simulates advice from a selected advisory board based on their known philosophies and approaches.
 *
 * - simulateAdvisorAdvice - A function that simulates advice from selected advisors.
 * - SimulateAdvisorAdviceInput - The input type for the simulateAdvisorAdvice function.
 * - SimulateAdvisorAdviceOutput - The return type for the simulateAdvisorAdvice function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import {advisorProfiles} from '@/ai/advisors';

const SimulateAdvisorAdviceInputSchema = z.object({
  situationDescription: z
    .string()
    .describe('The user-provided description of their situation.'),
  selectedAdvisors: z
    .array(z.string())
    .describe('An array of selected advisor IDs (e.g., ["NavalRavikant", "SteveJobs"]).'),
});

export type SimulateAdvisorAdviceInput = z.infer<
  typeof SimulateAdvisorAdviceInputSchema
>;

const SimulateAdvisorAdviceOutputSchema = z.object({
  advisorAdvices: z.array(
    z.object({
      advisorId: z.string().describe("The ID of the advisor (e.g., NavalRavikant)."),
      advice: z.string().describe("The concise advice from this advisor (3-4 sentences)."),
    })
  ),
  synthesis: z.string().describe('A concise synthesis of the advice from all advisors (3-4 sentences).'),
});

export type SimulateAdvisorAdviceOutput = z.infer<
  typeof SimulateAdvisorAdviceOutputSchema
>;

export async function simulateAdvisorAdvice(
  input: SimulateAdvisorAdviceInput
): Promise<SimulateAdvisorAdviceOutput> {
  return simulateAdvisorAdviceFlow(input);
}

const simulateAdvisorAdvicePrompt = ai.definePrompt({
  name: 'simulateAdvisorAdvicePrompt',
  input: {
    schema: z.object({
      situationDescription: z.string(),
      advisorDetails: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          style: z.string(),
          principles: z.string(),
          tone: z.string(),
        })
      ),
    }),
  },
  output: {schema: z.object({
      advisorAdvices: z.array(
        z.object({
          advisorName: z.string().describe("The full name of the advisor."),
          advice: z.string().describe("The concise advice from this advisor (3-4 sentences)."),
        })
      ),
      synthesis: z.string().describe('A concise, actionable summary of all advice (3-4 sentences).'),
    })},
  prompt: `You are a facilitator of a personal advisory board. You will provide advice from each of the selected advisors based on their known philosophies. Your response MUST be in Russian.

  The user's situation is:
  "{{situationDescription}}"

  Here are the advisor profiles you must use:
  {{#each advisorDetails}}
  - Advisor: {{this.name}} (Style: {{this.style}}, Principles: {{this.principles}}, Tone: {{this.tone}})
  {{/each}}
  
  INSTRUCTIONS:
  1. For EACH advisor, provide their specific advice based on their profile. The advice for EACH advisor must be CONCISE (3-4 sentences).
  2. Then, provide a "synthesis": a short, actionable summary of all advice. The synthesis must also be CONCISE (3-4 sentences).
  3. The 'advisorName' in the output JSON must be the original name string for that advisor.

  Output the advice in the specified JSON format.
  `,
});

const simulateAdvisorAdviceFlow = ai.defineFlow(
  {
    name: 'simulateAdvisorAdviceFlow',
    inputSchema: SimulateAdvisorAdviceInputSchema,
    outputSchema: SimulateAdvisorAdviceOutputSchema,
  },
  async input => {
    // 1. Get profiles for the selected advisors.
    const advisorDetails = input.selectedAdvisors.map(id => {
      const profile = advisorProfiles[id as keyof typeof advisorProfiles];
      if (!profile) {
        throw new Error(`Advisor profile for ID "${id}" not found.`);
      }
      return {
        id, // Pass the id through for mapping later
        ...profile
      };
    });

    if (advisorDetails.length === 0) {
        throw new Error('No valid advisors were provided to the flow.');
    }

    // 2. Call the AI model with the prepared details.
    const {output: rawOutput} = await simulateAdvisorAdvicePrompt({
      situationDescription: input.situationDescription,
      advisorDetails: advisorDetails,
    });

    if (!rawOutput || !rawOutput.advisorAdvices) {
      throw new Error('AI model returned invalid or empty output.');
    }

    // 3. Map the results back, ensuring correct ID association.
    const mappedAdvices = rawOutput.advisorAdvices.map(adviceItem => {
      const matchingAdvisor = advisorDetails.find(d => d.name === adviceItem.advisorName);
      
      if (!matchingAdvisor) {
        // This is a safeguard. If the model hallucinates a name, we'll know.
        console.warn(`Could not map advisor name "${adviceItem.advisorName}" back to an ID.`);
        // To prevent a crash, we can either throw or return a placeholder.
        // Let's return a placeholder but the real fix is a good prompt.
        return {
          advisorId: 'unknown',
          advice: adviceItem.advice,
        };
      }

      return {
        advisorId: matchingAdvisor.id, // The crucial mapping back to the original ID
        advice: adviceItem.advice,
      };
    });

    // 4. Return the final, correctly structured output.
    return {
        synthesis: rawOutput.synthesis,
        advisorAdvices: mappedAdvices,
    };
  }
);

// =================================================================================
// FILE: /home/user/studio/src/ai/flows/continue-dialogue.ts
// =================================================================================

'use server';

/**
 * @fileOverview Continues a dialogue with the user, answering follow-up questions.
 *
 * - continueDialogue - A function that handles follow-up questions.
 * - ContinueDialogueInput - The input type for the continueDialogue function.
 * - ContinueDialogueOutput - The return type for the continueDialogue function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ContinueDialogueInputSchema = z.object({
  question: z.string().describe("The user's follow-up question."),
  history: z.array(z.object({
    role: z.enum(['user', 'model']),
    content: z.string(),
  })).describe('The conversation history.'),
});

export type ContinueDialogueInput = z.infer<typeof ContinueDialogueInputSchema>;

const ContinueDialogueOutputSchema = z.object({
  answer: z.string().describe("The AI's response to the follow-up question."),
});

export type ContinueDialogueOutput = z.infer<typeof ContinueDialogueOutputSchema>;

export async function continueDialogue(input: ContinueDialogueInput): Promise<ContinueDialogueOutput> {
  return continueDialogueFlow(input);
}

const continueDialoguePrompt = ai.definePrompt({
  name: 'continueDialoguePrompt',
  input: {schema: ContinueDialogueInputSchema},
  output: {schema: ContinueDialogueOutputSchema},
  prompt: `You are a facilitator for a personal advisory board. Your task is to provide an answer to the user's follow-up question based on the provided conversation history.
Your response MUST be in Russian.

Conversation History:
{{#each history}}
- {{role}}: {{content}}
{{/each}}

User's new question: {{question}}

INSTRUCTIONS:
1.  Examine the "User's new question" and the "Conversation History" to understand which advisor is being addressed, or if it's a general question.
2.  **IF AN ADVISOR IS MENTIONED:** You MUST answer exclusively from that single advisor's perspective, using their known style and principles.
3.  **IF NO ADVISOR IS MENTIONED:** You MUST answer from the perspective of the facilitator, providing a general, helpful, and synthesized response based on the entire conversation.
4.  The answer MUST be concise and to the point (3-4 sentences maximum).
  `,
});

const continueDialogueFlow = ai.defineFlow(
  {
    name: 'continueDialogueFlow',
    inputSchema: ContinueDialogueInputSchema,
    outputSchema: ContinueDialogueOutputSchema,
  },
  async input => {
    const {output} = await continueDialoguePrompt(input);
    return output!;
  }
);
