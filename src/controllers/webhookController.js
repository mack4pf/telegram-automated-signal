const redisService = require('../services/redis.service');
const telegramService = require('../services/telegram.service');

// Use a simple object instead of class to avoid "this" issues
const webhookController = {
    async handleTradingViewAlert(req, res) {
        console.log('📨 Received TradingView webhook:', req.body);
        
        try {
            // 1. Immediately respond to TradingView
            res.status(200).json({ status: 'received', processed: true });
            
            // 2. Process the alert - NO "this" context issues
            webhookController.processAlert(req.body);
            
        } catch (error) {
            console.error('❌ Webhook error:', error);
            if (!res.headersSent) {
                res.status(200).json({ status: 'received' });
            }
        }
    },

    async processAlert(alertData) {
        try {
            // Check if system is active
            const systemActive = await redisService.getSystemState();
            if (!systemActive) {
                console.log('⏸️  System inactive - ignoring signal');
                return;
            }

            console.log('🔄 Processing signal for Telegram...');

            // Format for binary options signals
            const message = webhookController.formatBinarySignal(alertData);
            const success = await telegramService.sendToChannel(alertData.chat_id, message);

            if (success) {
                console.log('✅ Signal sent to Telegram');
            } else {
                console.log('❌ Failed to send to Telegram');
            }
            
        } catch (error) {
            console.error('❌ Alert processing error:', error);
        }
    },

    formatBinarySignal(alertData) {
        // Extract pair and determine flag emoji
        const pair = alertData.ticker;
        let flag = '🎯';
        
        if (pair.includes('EUR/USD')) flag = '🇪🇺🇺🇸';
        else if (pair.includes('GBP/USD')) flag = '🇬🇧🇺🇸';
        else if (pair.includes('USD/JPY')) flag = '🇺🇸🇯🇵';
        else if (pair.includes('AUD/USD')) flag = '🇦🇺🇺🇸';
        else if (pair.includes('USD/CAD')) flag = '🇺🇸🇨🇦';
        else if (pair.includes('XAU/USD')) flag = '🥇🇺🇸';
        
        // Extract signal direction and timeframe
        const signal = alertData.signal || 'BUY';
        const timeframe = webhookController.extractTimeframe(alertData);
        
        return `⚡ <b>INCOMING SIGNAL</b> 

${flag} <b>${pair}</b>
🟢 <b>${signal.toUpperCase()}</b>
⏰ <b>${timeframe}</b>

`;
    },

    extractTimeframe(alertData) {
        // Extract timeframe from signal or use default
        if (alertData.signal && alertData.signal.includes('1MIN')) return '1 MINUTE';
        if (alertData.signal && alertData.signal.includes('3MIN')) return '3 MINUTES';
        if (alertData.signal && alertData.signal.includes('5MIN')) return '5 MINUTES';
        return '1 MINUTE'; // Default for binary
    }
};

module.exports = webhookController;