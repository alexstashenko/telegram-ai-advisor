import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';

const token = process.env.TELEGRAM_BOT_TOKEN;
const appUrl = process.env.NEXT_PUBLIC_APP_URL;

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not defined in .env file');
}

if (!appUrl) {
  throw new Error('NEXT_PUBLIC_APP_URL is not defined in .env file');
}

const bot = new TelegramBot(token);
const webhookUrl = `${appUrl}/api/telegram/webhook`;

bot.setWebHook(webhookUrl)
  .then(() => {
    console.log(`Webhook has been set to ${webhookUrl}`);
  })
  .catch((error) => {
    console.error('Error setting webhook:', error);
  });
