const axios = require('axios');

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
        this.queue.push({ chatId, message });
        
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
            const { chatId, message } = this.queue[0];
            
            // Rate limiting: wait 1 second between messages
            const now = Date.now();
            const timeSinceLastMessage = now - this.lastSentTime;
            if (timeSinceLastMessage < 1000) {
                await new Promise(resolve => setTimeout(resolve, 1000 - timeSinceLastMessage));
            }
            
            try {
                const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
                
                const response = await axios.post(url, {
                    chat_id: chatId,
                    text: message,
                    parse_mode: 'HTML'
                }, {
                    timeout: 10000
                });

                console.log('✅ Message sent to Telegram channel');
                this.lastSentTime = Date.now();
                
                // Remove from queue after success
                this.queue.shift();
                
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

    isConfigured() {
        return this.isEnabled;
    }
}

const telegramService = new TelegramService();
module.exports = telegramService;