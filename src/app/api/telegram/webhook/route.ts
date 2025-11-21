import {NextRequest, NextResponse} from 'next/server';
import TelegramBot from 'node-telegram-bot-api';
import {getAdviceAction} from '@/app/actions';

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not defined in .env file');
}

const bot = new TelegramBot(token);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const message = body.message;

    if (message && message.text) {
      const chatId = message.chat.id;

      if (message.text === '/start') {
        await bot.sendMessage(
          chatId,
          'Здравствуйте! Опишите вашу ситуацию, и я предоставлю вам совет от виртуального совета директоров.'
        );
        return NextResponse.json({status: 'ok'});
      }

      await bot.sendMessage(chatId, 'Анализирую вашу ситуацию...');

      const result = await getAdviceAction(message.text);

      if (result.error) {
        await bot.sendMessage(chatId, `Произошла ошибка: ${result.error}`);
      } else if (result.data) {
        let response = `*Синтезированный план действий:*\n${result.data.synthesis}\n\n`;
        response += '*Рекомендации от каждого советника:*\n';
        
        result.data.advisorAdvices.forEach(advice => {
            let advisorName = '';
            if (advice.advisorName === 'NavalRavikant') advisorName = 'Наваль Равикант';
            if (advice.advisorName === 'PieterLevels') advisorName = 'Питер Левелс';
            if (advice.advisorName === 'GaryVaynerchuk') advisorName = 'Гэри Вайнерчук';

            response += `\n*${advisorName}:*\n${advice.advice}\n`;
        });

        await bot.sendMessage(chatId, response, {parse_mode: 'Markdown'});
      }
    }

    return NextResponse.json({status: 'ok'});
  } catch (error) {
    console.error('Error processing telegram update:', error);
    return NextResponse.json(
      {status: 'error', message: 'Internal Server Error'},
      {status: 500}
    );
  }
}
