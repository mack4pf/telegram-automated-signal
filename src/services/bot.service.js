const TelegramBot = require('node-telegram-bot-api');
const redisService = require('./redis.service');

class BotService {
    constructor() {
        this.bot = null;
        this.adminIds = this.getAdminIds();

        // State management for interactive flows (waiting for ID input)
        this.adminStates = {}; // Format: { chatId: { action: 'WAITING_ADD_ID', strategy: 'gold' } }

        this.handleMessage = this.handleMessage.bind(this);
        this.handleCallback = this.handleCallback.bind(this);
        this.startBot = this.startBot.bind(this);
        this.stopBot = this.stopBot.bind(this);
        this.getStatus = this.getStatus.bind(this);
        this.sendAdminMenu = this.sendAdminMenu.bind(this);
        this.listChannels = this.listChannels.bind(this);
        this.promptAddChannel = this.promptAddChannel.bind(this);
        this.processIdInput = this.processIdInput.bind(this);
        this.showRemoveMenu = this.showRemoveMenu.bind(this);
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
        this.bot.on('message', this.handleMessage);
        this.bot.on('callback_query', this.handleCallback);

        console.log('✅ Telegram Bot started with admin controls');
        console.log('👤 Admin IDs:', this.adminIds.join(', '));
    }

    async handleMessage(msg) {
        if (!msg.text) return;

        const chatId = msg.chat.id;
        const text = msg.text.trim();

        console.log(`📨 Received message from ${chatId}: ${text}`);

        if (this.adminIds.length > 0 && !this.adminIds.includes(chatId.toString())) {
            console.log(`❌ Unauthorized access from: ${chatId}`);
            return;
        }

        // Check availability of state for this user
        if (this.adminStates[chatId]) {
            await this.processIdInput(chatId, text);
            return;
        }

        try {
            if (text === '/start') await this.startBot(chatId);
            else if (text === '/stop') await this.stopBot(chatId);
            else if (text === '/status') await this.getStatus(chatId);
            else if (text === '/admin') await this.sendAdminMenu(chatId);
            else if (text === '/list') await this.listChannels(chatId);
        } catch (error) {
            console.error('❌ Error handling message:', error);
            this.bot.sendMessage(chatId, '❌ An error occurred processing your command.');
        }
    }

    async processIdInput(chatId, text) {
        const state = this.adminStates[chatId];

        if (state && state.action === 'WAITING_ADD_ID') {
            const strategy = state.strategy;

            // Validate ID (basic check)
            if (!text.startsWith('-100') && !/^\d+$/.test(text) && !text.startsWith('@')) {
                await this.bot.sendMessage(chatId, '⚠️ Invalid ID format. Usually starts with -100... Try again or type /cancel.');
                return;
            }

            if (text === '/cancel') {
                delete this.adminStates[chatId];
                await this.bot.sendMessage(chatId, '❌ Operation cancelled.');
                return;
            }

            // Perform Add
            const success = await redisService.addChannel(strategy, text);

            if (success) {
                await this.bot.sendMessage(chatId, `✅ Channel <b>${text}</b> added to <b>${strategy.toUpperCase()}</b>!`, { parse_mode: 'HTML' });
            } else {
                await this.bot.sendMessage(chatId, `❌ Failed to add channel. Check logs.`);
            }

            // Clear state
            delete this.adminStates[chatId];
        }
    }

    async startBot(chatId) {
        await redisService.setSystemState(true);
        this.bot.sendMessage(chatId, '✅ <b>System STARTED</b>\nSignals will be processed.', { parse_mode: 'HTML' });
    }

    async stopBot(chatId) {
        await redisService.setSystemState(false);
        this.bot.sendMessage(chatId, '🛑 <b>System STOPPED</b>\nSignals will be ignored.', { parse_mode: 'HTML' });
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

    async listChannels(chatId) {
        const strategies = await redisService.getAllStrategies();
        if (Object.keys(strategies).length === 0) {
            await this.bot.sendMessage(chatId, "ℹ️ No custom channels configured.");
            return;
        }

        let message = "📋 <b>Channel List</b>\n\n";
        for (const [strategy, count] of Object.entries(strategies)) {
            message += `<b>${strategy.toUpperCase()} (${count}):</b>\n`;
            const channels = await redisService.getChannels(strategy);
            channels.forEach(id => {
                message += `   • <code>${id}</code>\n`;
            });
            message += "\n";
        }

        await this.bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    }

    async sendAdminMenu(chatId) {
        // Clear any existing state
        if (this.adminStates[chatId]) delete this.adminStates[chatId];

        const strategies = await redisService.getAllStrategies();
        let statusText = "🎛️ <b>Admin Control Panel</b>\n\nSelect an action:";

        const keyboard = {
            inline_keyboard: [
                [
                    { text: "➕ Add Channel", callback_data: "menu_add" },
                    { text: "➖ Remove Channel", callback_data: "menu_remove" }
                ],
                [
                    { text: "📋 List Channels", callback_data: "menu_list" }
                ],
                [
                    { text: "🟢 Start System", callback_data: "sys_start" },
                    { text: "🔴 Stop System", callback_data: "sys_stop" }
                ]
            ]
        };

        await this.bot.sendMessage(chatId, statusText, {
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    }

    async handleCallback(query) {
        const chatId = query.message.chat.id;
        const data = query.data;

        await this.bot.answerCallbackQuery(query.id);

        // Sub-menus
        if (data === 'menu_add') {
            await this.showStrategySelection(chatId, 'add');
        } else if (data === 'menu_remove') {
            await this.showStrategySelection(chatId, 'remove');
        } else if (data === 'menu_list') {
            await this.listChannels(chatId);
        }
        // Strategy Selection
        else if (data.startsWith('sel_add_')) {
            const strategy = data.replace('sel_add_', '');
            await this.promptAddChannel(chatId, strategy);
        } else if (data.startsWith('sel_rem_')) {
            const strategy = data.replace('sel_rem_', '');
            await this.showRemoveMenu(chatId, strategy);
        }
        // Actions
        else if (data.startsWith('do_rem_')) {
            // format: do_rem_ STRATEGY _ ID
            const parts = data.replace('do_rem_', '').split('_');
            const strategy = parts[0];
            const channelId = parts[1]; // Might be risky if ID has underscores, but Telegram IDs usually don't
            // Better parsing: find last underscore? No channel IDs are negative numbers mostly.
            // Let's rely on simple split for now or use a safer separator if needed.
            // Redis IDs are numbers.
            // Actually, wait pattern is `do_rem_vip_-100123`.
            // Correct logic:
            const firstUnderscore = data.indexOf('_', 7); // 'do_rem_' length is 7
            const strat = data.substring(7, firstUnderscore);
            const cid = data.substring(firstUnderscore + 1);

            await this.removeChannel(chatId, strat, cid);
        }
        else if (data === 'sys_start') await this.startBot(chatId);
        else if (data === 'sys_stop') await this.stopBot(chatId);
    }

    async showStrategySelection(chatId, mode) {
        // Show buttons for VIP and GOLD (and maybe others if dynamic? For now hardcode + others)
        // To be dynamic, we could fetch from Redis, but we want to allow adding to NEW strategies too?
        // For simplicity, let's offer VIP, GOLD, and maybe "Custom" (which asks for name).
        // User asked for specific buttons.

        const prefix = mode === 'add' ? 'sel_add_' : 'sel_rem_';

        const keyboard = {
            inline_keyboard: [
                [
                    { text: "VIP", callback_data: `${prefix}vip` },
                    { text: "GOLD", callback_data: `${prefix}gold` }
                ],
                [
                    { text: "SILVER", callback_data: `${prefix}silver` }
                ],
                [
                    { text: "🔙 Cancel", callback_data: "refresh" } // Just reusing refresh/cancel logic
                ]
            ]
        };

        await this.bot.sendMessage(chatId, `Select Strategy to ${mode.toUpperCase()} channel:`, { reply_markup: keyboard });
    }

    async promptAddChannel(chatId, strategy) {
        this.adminStates[chatId] = { action: 'WAITING_ADD_ID', strategy: strategy };
        await this.bot.sendMessage(chatId, `✏️ <b>Enter Channel ID for [${strategy.toUpperCase()}]</b>\n\nExample: -100123456789\n(Type /cancel to abort)`, { parse_mode: 'HTML' });
    }

    async showRemoveMenu(chatId, strategy) {
        const channels = await redisService.getChannels(strategy);

        if (channels.length === 0) {
            await this.bot.sendMessage(chatId, `ℹ️ No channels found for <b>${strategy.toUpperCase()}</b>.`, { parse_mode: 'HTML' });
            return;
        }

        const buttons = channels.map(id => {
            return [{ text: `❌ ${id}`, callback_data: `do_rem_${strategy}_${id}` }];
        });

        const keyboard = { inline_keyboard: buttons };
        await this.bot.sendMessage(chatId, `🗑️ <b>Remove Channel from [${strategy.toUpperCase()}]</b>\nClick to delete:`, { parse_mode: 'HTML', reply_markup: keyboard });
    }

    async removeChannel(chatId, strategy, channelId) {
        const success = await redisService.removeChannel(strategy, channelId);
        if (success) {
            await this.bot.sendMessage(chatId, `✅ Removed ${channelId} from ${strategy}.`);
        } else {
            await this.bot.sendMessage(chatId, `❌ Failed to remove ${channelId}.`);
        }
    }
}

const botService = new BotService();
module.exports = botService;