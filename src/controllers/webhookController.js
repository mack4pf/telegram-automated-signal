const redisService = require('../services/redis.service');
const telegramService = require('../services/telegram.service');
const realChartService = require('../services/realChart.service');

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

            // Check if this is a trade result (WIN/LOSS) - USE NEW CHART LOGIC
            const signal = (alertData.signal || '').toUpperCase();
            console.log(`🔍 Detected signal: "${signal}"`);
            
            if (signal.includes('WIN') || signal.includes('LOSS') || signal.includes('WON') || signal.includes('LOST')) {
                console.log('🎯 Processing as TRADE RESULT WITH CHART');
                await webhookController.processTradeResultWithChart(alertData);
            } else {
                console.log('⚡ Processing as NEW SIGNAL (text only)');
                const message = webhookController.formatNewSignal(alertData);
                const success = await telegramService.sendToChannel(alertData.chat_id, message);
                if (success) console.log('✅ Signal sent to Telegram');
                else console.log('❌ Failed to send to Telegram');
            }
            
        } catch (error) {
            console.error('❌ Alert processing error:', error);
        }
    },

    async processTradeResultWithChart(alertData) {
        try {
            console.log('🎯 Processing trade result with chart...');
            
            // 1. Generate price movement chart
            const chartBuffer = await realChartService.generateTradeChart(alertData.ticker, 5);
            
            // 2. Format trade result message
            const message = webhookController.formatTradeResult(alertData);
            
            // 3. Send to Telegram
            if (chartBuffer) {
                // Send with chart image
                const success = await telegramService.sendPhotoToChannel(alertData.chat_id, chartBuffer, message);
                if (success) console.log('✅ Trade result with chart sent to Telegram');
                else console.log('❌ Failed to send trade result with chart');
            } else {
                // Fallback: send text only if chart fails
                const success = await telegramService.sendToChannel(alertData.chat_id, message);
                if (success) console.log('✅ Trade result sent (no chart)');
                else console.log('❌ Failed to send trade result');
            }
            
        } catch (error) {
            console.error('❌ Trade result processing error:', error);
            // Fallback to text only
            const message = webhookController.formatTradeResult(alertData);
            await telegramService.sendToChannel(alertData.chat_id, message);
        }
    },

    formatNewSignal(alertData) {
        // Extract pair and determine flag emoji
        const pair = alertData.ticker;
        let flag = '🎯';
        
        if (pair.includes('EUR/USD') || pair.includes('EURUSD')) flag = '🇪🇺🇺🇸';
        else if (pair.includes('GBP/USD') || pair.includes('GBPUSD')) flag = '🇬🇧🇺🇸';
        else if (pair.includes('USD/JPY') || pair.includes('USDJPY')) flag = '🇺🇸🇯🇵';
        else if (pair.includes('AUD/USD') || pair.includes('AUDUSD')) flag = '🇦🇺🇺🇸';
        else if (pair.includes('USD/CAD') || pair.includes('USDCAD')) flag = '🇺🇸🇨🇦';
        else if (pair.includes('XAU/USD') || pair.includes('XAUUSD')) flag = '🥇🇺🇸';
        
        // Extract signal direction and REAL timeframe
        const signal = alertData.signal || 'BUY';
        const timeframe = webhookController.extractRealTimeframe(alertData);
        
        return `⚡ <b>INCOMING SIGNAL</b> 

${flag} <b>${pair}</b>
🔔 <b>${signal.toUpperCase()}</b>
⏰ <b>${timeframe}</b>

`;
    },

    formatTradeResult(alertData) {
        const signal = (alertData.signal || '').toUpperCase();
        const pair = alertData.ticker || '';
        
        let resultEmoji = '🎯';
        let resultText = 'RESULT';
        
        if (signal.includes('WIN') || signal.includes('WON')) {
            resultEmoji = '🏆';
            resultText = 'WIN';
        } else if (signal.includes('LOSS') || signal.includes('LOST')) {
            resultEmoji = '🚫';
            resultText = 'LOSS';
        }
        
        return `${resultEmoji} <b>TRADE RESULT : ${resultText}</b> 

📊 <b>${pair}</b>
💰 <b>${alertData.price || 'N/A'}</b>

`;
    },

    extractRealTimeframe(alertData) {
        const signal = alertData.signal || '';
        
        // Look for actual timeframe in the signal
        if (signal.includes('5MIN') || signal.includes('5M')) return '5 MINUTES';
        if (signal.includes('3MIN') || signal.includes('3M')) return '3 MINUTES'; 
        if (signal.includes('1MIN') || signal.includes('1M')) return '1 MINUTE';
        if (signal.includes('15MIN') || signal.includes('15M')) return '15 MINUTES';
        if (signal.includes('30MIN') || signal.includes('30M')) return '30 MINUTES';
        
        // Default to 1 minute if no timeframe detected
        return '5 MINUTES';
    }
};

module.exports = webhookController;