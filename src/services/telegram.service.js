const axios = require('axios');
const FormData = require('form-data');

class TelegramService {
    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.isEnabled = !!this.botToken;
        this.queue = [];
        this.isProcessing = false;
        this.lastSentTime = 0;
    }

    async sendToChannel(chatId, message) {
        if (!this.isEnabled) {
            console.log('⚠️  Telegram bot token not set - skipping message');
            return false;
        }

        // Add to queue
        this.queue.push({ chatId, message, type: 'text' });
        
        // Process queue if not already processing
        if (!this.isProcessing) {
            this.processQueue();
        }
        
        return true;
    }

    async sendPhotoToChannel(chatId, photoBuffer, caption) {
        if (!this.isEnabled) {
            console.log('⚠️  Telegram bot token not set - skipping photo');
            return false;
        }

        // Add to queue
        this.queue.push({ chatId, photoBuffer, caption, type: 'photo' });
        
        // Process queue if not already processing
        if (!this.isProcessing) {
            this.processQueue();
        }
        
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
                    // Rate limited - wait and retry
                    const retryAfter = error.response?.data?.parameters?.retry_after || 5;
                    console.log(`⏳ Rate limited, waiting ${retryAfter} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                    // Don't remove from queue - will retry
                } else {
                    // Other error - remove from queue
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
            parse_mode: 'HTML'
        }, {
            timeout: 10000
        });

        console.log('✅ Text message sent to Telegram channel');
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

        console.log('✅ Photo message sent to Telegram channel');
        return response.data;
    }

    // Check if Telegram is configured
    isConfigured() {
        return this.isEnabled;
    }
}

const telegramService = new TelegramService();
module.exports = telegramService;