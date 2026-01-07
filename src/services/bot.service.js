const TelegramBot = require('node-telegram-bot-api');
const redisService = require('./redis.service');

class BotService {
    constructor() {
        this.bot = null;
        this.adminIds = this.getAdminIds(); // Parse multiple IDs

        // Explicitly bind methods to ensure 'this' context is preserved
        this.handleMessage = this.handleMessage.bind(this);
        this.handleCallback = this.handleCallback.bind(this);
        this.startBot = this.startBot.bind(this);
        this.stopBot = this.stopBot.bind(this);
        this.getStatus = this.getStatus.bind(this);
        this.sendAdminMenu = this.sendAdminMenu.bind(this);
        this.addChannelToStrategy = this.addChannelToStrategy.bind(this);

        this.initialize();
    }

    getAdminIds() {
        const adminEnv = process.env.ADMIN_CHAT_ID;
        if (!adminEnv) return [];
        return adminEnv.split(',').map(id => id.trim());
    }

    initialize() {
        if (!process.env.TELEGRAM_BOT_TOKEN) {
            console.log('❌ TELEGRAM_BOT_TOKEN not set - bot disabled');
            return;
        }

        this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

        // Use bound method directly
        this.bot.on('message', this.handleMessage);

        // Handle button clicks
        this.bot.on('callback_query', this.handleCallback);

        console.log('✅ Telegram Bot started with admin controls');
        console.log('👤 Admin IDs:', this.adminIds.join(', '));

        // Debug: Log available methods
        console.log('🔧 BotService Methods Check:', {
            startBot: typeof this.startBot,
            stopBot: typeof this.stopBot,
            getStatus: typeof this.getStatus
        });
    }

    async handleMessage(msg) {
        // Handle only text messages and commands
        if (!msg.text) return;

        const chatId = msg.chat.id;
        const text = msg.text;

        console.log(`📨 Received message from ${chatId}: ${text}`);

        // Check against array of allowed admin IDs
        if (this.adminIds.length > 0 && !this.adminIds.includes(chatId.toString())) {
            console.log(`❌ Unauthorized access from: ${chatId}`);
            return;
        }

        try {
            if (text === '/start') {
                await this.startBot(chatId);
            } else if (text === '/stop') {
                await this.stopBot(chatId);
            } else if (text === '/status') {
                await this.getStatus(chatId);
            } else if (text === '/admin') {
                await this.sendAdminMenu(chatId);
            } else {
                // Check for reply-to interactions or other logic here
            }
        } catch (error) {
            console.error('❌ Error handling message:', error);
            this.bot.sendMessage(chatId, '❌ An error occurred processing your command.');
        }
    }

    async startBot(chatId) {
        await redisService.setSystemState(true);
        this.bot.sendMessage(chatId, '✅ <b>System STARTED</b>\nSignals will be processed.', { parse_mode: 'HTML' });
        console.log('✅ System started by admin');
    }

    async stopBot(chatId) {
        await redisService.setSystemState(false);
        this.bot.sendMessage(chatId, '🛑 <b>System STOPPED</b>\nSignals will be ignored.', { parse_mode: 'HTML' });
        console.log('🛑 System stopped by admin');
    }

    async getStatus(chatId) {
        const isActive = await redisService.getSystemState();
        const statusText = isActive ? '✅ ACTIVE' : '🛑 STOPPED';
        const redisStatus = redisService.isReady() ? '🟢 Connected' : '🔴 Disconnected';

        const message = `📊 <b>System Status</b>\n\n` +
            `🤖 Bot State: ${statusText}\n` +
            `💾 Redis: ${redisStatus}`;

        this.bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    }

    // --- Interactive Admin Menu ---

    async sendAdminMenu(chatId) {
        const strategies = await redisService.getAllStrategies();
        let statusText = "🎛️ <b>Admin Control Panel</b>\n\nCurrent Configuration:\n";

        // List active strategies
        if (Object.keys(strategies).length === 0) {
            statusText += "No custom strategies configured yet.\nDefault: 'vip' (from .env)";
        } else {
            for (const [strategy, count] of Object.entries(strategies)) {
                statusText += `• <b>${strategy.toUpperCase()}</b>: ${count} channel(s)\n`;
            }
        }

        const keyboard = {
            inline_keyboard: [
                [
                    { text: "➕ Add to VIP", callback_data: "add_vip" },
                    { text: "➕ Add to GOLD", callback_data: "add_gold" }
                ],
                [
                    { text: "🟢 Start System", callback_data: "sys_start" },
                    { text: "🔴 Stop System", callback_data: "sys_stop" }
                ],
                [
                    { text: "🔄 Refresh Status", callback_data: "refresh" }
                ]
            ]
        };

        await this.bot.sendMessage(chatId, statusText, {
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    }

    // Handle button clicks
    async handleCallback(query) {
        const chatId = query.message.chat.id;
        const data = query.data;

        // Answer callback to remove loading state
        await this.bot.answerCallbackQuery(query.id);

        if (data.startsWith('add_')) {
            const strategy = data.replace('add_', '');
            await this.addChannelToStrategy(chatId, strategy);
        } else if (data === 'sys_start') {
            await this.startBot(chatId);
        } else if (data === 'sys_stop') {
            await this.stopBot(chatId);
        } else if (data === 'refresh') {
            // Delete old message and send new one to refresh data
            await this.bot.deleteMessage(chatId, query.message.message_id);
            await this.sendAdminMenu(chatId);
        }
    }

    async addChannelToStrategy(chatId, strategy) {
        const formattedStrategy = strategy.toUpperCase();

        // Add THIS channel (where command was clicked) to the strategy
        const success = await redisService.addChannel(strategy, chatId);

        if (success) {
            await this.bot.sendMessage(chatId, `✅ Channel added to <b>${formattedStrategy}</b> list!`, { parse_mode: 'HTML' });
        } else {
            await this.bot.sendMessage(chatId, `❌ Failed to add channel to ${formattedStrategy}. Check logs.`);
        }
    }
}

const botService = new BotService();
module.exports = botService;