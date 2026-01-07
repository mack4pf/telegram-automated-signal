const axios = require('axios');
const FormData = require('form-data');
// Lazy load redis service to avoid circular dependencies if any
let redisService;

class TelegramService {
    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.isEnabled = !!this.botToken;
        this.queue = [];
        this.isProcessing = false;
        this.lastSentTime = 0;

        // Log configuration on startup
        if (this.isEnabled) {
            const channels = this.getChannelIds();
            console.log(`🤖 Telegram Service Initialized`);
            console.log(`📢 Default Broadcast Channels (VIP):`);
            channels.forEach(id => console.log(`   - ${id}`));
        } else {
            console.log('⚠️  Telegram Service Disabled (TELEGRAM_BOT_TOKEN missing)');
        }
    }

    // Lazy getter for redis service
    getRedis() {
        if (!redisService) {
            redisService = require('./redis.service');
        }
        return redisService;
    }

    // ... existing methods ...

    // Get all configured channel IDs
    // This now serves as the default ("VIP") static config
    getChannelIds() {
        const channelIds = process.env.TELEGRAM_CHANNEL_IDS;
        if (!channelIds) {
            return [];
        }

        // Support comma-separated channel IDs
        return channelIds
            .split(',')
            .map(id => id.trim().replace(/['"]/g, ''))
            .filter(id => id.length > 0);
    }

    // Fetch channels for a specific strategy
    async getStrategyChannels(strategy) {
        if (!strategy) strategy = 'vip'; // Default
        strategy = strategy.toLowerCase();

        const dynamicChannels = await this.getRedis().getChannels(strategy);

        // If strategy is 'vip', include the static env channels for backward compatibility
        if (strategy === 'vip') {
            const staticChannels = this.getChannelIds();
            // Merge and dedup
            return [...new Set([...staticChannels, ...dynamicChannels])];
        }

        return dynamicChannels;
    }

    async sendToChannel(chatId, message) {
        if (!this.isEnabled) {
            console.log('⚠️  Telegram bot token not set - skipping message');
            return false;
        }

        // Add to queue
        this.queue.push({ chatId, message, type: 'text' });
        if (!this.isProcessing) this.processQueue();
        return true;
    }

    async sendPhotoToChannel(chatId, photoBuffer, caption) {
        if (!this.isEnabled) {
            console.log('⚠️  Telegram bot token not set - skipping photo');
            return false;
        }

        // Add to queue
        this.queue.push({ chatId, photoBuffer, caption, type: 'photo' });
        if (!this.isProcessing) this.processQueue();
        return true;
    }

    async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;

        this.isProcessing = true;

        while (this.queue.length > 0) {
            const item = this.queue[0];

            // Rate limiting: wait 1 second between messages
            const now = Date.now();
            const timeSinceLastMessage = now - this.lastSentTime;
            if (timeSinceLastMessage < 1000) {
                await new Promise(resolve => setTimeout(resolve, 1000 - timeSinceLastMessage));
            }

            try {
                if (item.type === 'text') {
                    await this.sendTextMessage(item.chatId, item.message);
                } else if (item.type === 'photo') {
                    await this.sendPhotoMessage(item.chatId, item.photoBuffer, item.caption);
                }

                this.lastSentTime = Date.now();
                this.queue.shift(); // Remove from queue after success

            } catch (error) {
                console.error('❌ Telegram send error:', error.response?.data || error.message);

                if (error.response?.status === 429) {
                    const retryAfter = error.response?.data?.parameters?.retry_after || 5;
                    console.log(`⏳ Rate limited, waiting ${retryAfter} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                } else {
                    this.queue.shift();
                }
            }
        }

        this.isProcessing = false;
    }

    async sendTextMessage(chatId, message) {
        const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
        const response = await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        }, { timeout: 10000 });
        console.log(`✅ Text message sent to ${chatId}`);
        return response.data;
    }

    async sendPhotoMessage(chatId, photoBuffer, caption) {
        const url = `https://api.telegram.org/bot${this.botToken}/sendPhoto`;
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('photo', photoBuffer, { filename: 'chart.png' });
        formData.append('caption', caption);
        formData.append('parse_mode', 'HTML');

        const response = await axios.post(url, formData, {
            headers: formData.getHeaders(),
            timeout: 15000
        });
        console.log(`✅ Photo message sent to ${chatId}`);
        return response.data;
    }

    // Check if Telegram is configured
    isConfigured() {
        return this.isEnabled;
    }

    // Broadcast message to all configured channels for a STRATEGY
    async broadcastToAllChannels(message, strategy = 'vip') {
        const channelIds = await this.getStrategyChannels(strategy);

        if (channelIds.length === 0) {
            console.log(`⚠️  No channels configured for strategy '${strategy}'`);
            return false;
        }

        console.log(`📢 Broadcasting to ${channelIds.length} channel(s) for strategy '${strategy}': ${channelIds.join(', ')}`);

        // Send to all channels
        for (const chatId of channelIds) {
            await this.sendToChannel(chatId, message);
        }

        return true;
    }

    // Broadcast photo to all configured channels for a STRATEGY
    async broadcastPhotoToAllChannels(photoBuffer, caption, strategy = 'vip') {
        const channelIds = await this.getStrategyChannels(strategy);

        if (channelIds.length === 0) {
            console.log(`⚠️  No channels configured for strategy '${strategy}'`);
            return false;
        }

        console.log(`📢 Broadcasting photo to ${channelIds.length} channel(s) for strategy '${strategy}': ${channelIds.join(', ')}`);

        // Send to all channels
        for (const chatId of channelIds) {
            await this.sendPhotoToChannel(chatId, photoBuffer, caption);
        }

        return true;
    }
}

const telegramService = new TelegramService();
module.exports = telegramService;