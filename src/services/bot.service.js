const TelegramBot = require('node-telegram-bot-api');
const redisService = require('./redis.service');

class BotService {
    constructor() {
        this.bot = null;
        this.adminId = process.env.ADMIN_CHAT_ID;
        this.initialize();
    }

    initialize() {
        if (!process.env.TELEGRAM_BOT_TOKEN) {
            console.log('❌ TELEGRAM_BOT_TOKEN not set - bot disabled');
            return;
        }

        this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
        
        this.bot.on('message', (msg) => {
            this.handleMessage(msg);
        });

        console.log('✅ Telegram Bot started with admin controls');
        console.log('👤 Admin ID:', this.adminId);
    }

    async handleMessage(msg) {
        const chatId = msg.chat.id;
        const text = msg.text;

        console.log(`📨 Received message from ${chatId}: ${text}`);

        // Only allow admin to control bot
        if (chatId.toString() !== this.adminId) {
            console.log(`❌ Unauthorized access from: ${chatId}`);
            this.bot.sendMessage(chatId, '❌ Unauthorized. Admin only.');
            return;
        }

        switch(text) {
            case '/start':
                await this.startBot(chatId);
                break;
            case '/stop':
                await this.stopBot(chatId);
                break;
            case '/status':
                await this.getStatus(chatId);
                break;
            default:
                this.bot.sendMessage(chatId, '❌ Unknown command. Use /start, /stop, /status');
        }
    }

    async startBot(chatId) {
        await redisService.setSystemState(true);
        this.bot.sendMessage(chatId, '✅ Bot STARTED - Signals will be sent to channel');
    }

    async stopBot(chatId) {
        await redisService.setSystemState(false);
        this.bot.sendMessage(chatId, '⏸️ Bot STOPPED - Signals will be ignored');
    }

    async getStatus(chatId) {
        const isActive = await redisService.getSystemState();
        const status = isActive ? '🟢 ACTIVE' : '🔴 INACTIVE';
        this.bot.sendMessage(chatId, `Bot Status: ${status}`);
    }
}

const botService = new BotService();
module.exports = botService;