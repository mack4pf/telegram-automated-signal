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

        // Handle button clicks
        this.bot.on('callback_query', (query) => {
            this.handleCallback(query);
        });

        console.log('✅ Telegram Bot started with admin controls');
        console.log('👤 Admin ID:', this.adminId);
    }

    async handleMessage(msg) {
        // Handle only text messages and commands
        if (!msg.text) return;

        const chatId = msg.chat.id;
        const text = msg.text;

        console.log(`📨 Received message from ${chatId}: ${text}`);

        // Only allow admin to control bot (simple security)
        // In real multi-channel setup, we might want to allow commands in any admin-authorized channel
        // But for critical commands (stop/start/admin), we check against env.ADMIN_CHAT_ID if set.
        if (this.adminId && chatId.toString() !== this.adminId) {
            console.log(`❌ Unauthorized access from: ${chatId}`);
            // Silent ignorance for non-admins to avoid spamming groups
            return;
        }

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