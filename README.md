# Telegram AI Advisor Bot

This is a Telegram bot that provides advice from a virtual advisory board powered by AI.

## Getting Started

1.  **Install dependencies:**
    ```bash
    npm install
    ```

2.  **Set up environment variables:**
    Create a `.env` file in the root of the project and add your Telegram bot token:
    ```
    TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
    GEMINI_API_KEY=your_gemini_api_key_here
    ADMIN_CHAT_ID=your_admin_chat_id_here
    ```
    You can get a `TELEGRAM_BOT_TOKEN` from [@BotFather](https://t.me/BotFather) in Telegram.
    You can get a `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/app/apikey).
    `ADMIN_CHAT_ID` is your Telegram chat ID for receiving session reports.


3.  **Run the bot:**
    ```bash
    npm run dev
    ```

Now you can interact with your bot in Telegram.
