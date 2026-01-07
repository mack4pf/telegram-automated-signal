const redisService = require('../services/redis.service');
const telegramService = require('../services/telegram.service');
const realTradeResultService = require('../services/realChart.service');
const forwardingService = require('../services/forwarding.service');

// Use a simple object instead of class to avoid "this" issues
const webhookController = {
    async handleTradingViewAlert(req, res) {
        console.log('📨 Received TradingView webhook:', req.body);

        // Inject strategy into payload
        req.body.strategy = req.params.strategy || 'vip';

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

            const strategy = alertData.strategy || 'vip';
            console.log(`🔄 Processing signal for [${strategy.toUpperCase()}] strategy...`);

            const signal = (alertData.signal || '').toUpperCase();
            console.log(`🔍 Detected signal: "${signal}"`);

            // Use legacy key for 'vip' to preserve open trades, namespace others
            const redisKey = strategy === 'vip'
                ? `${alertData.ticker}:last_signal`
                : `${strategy}:${alertData.ticker}:last_signal`;

            if (signal.includes('WIN') || signal.includes('LOSS') || signal.includes('WON') || signal.includes('LOST')) {
                console.log('🎯 Processing as TRADE RESULT WITH CHART');

                // GET ORIGINAL SIGNAL FROM REDIS
                const originalSignal = await redisService.get(redisKey) || 'Buy';
                console.log(`📝 Original signal was: ${originalSignal}`);

                await webhookController.processTradeResultWithChart(alertData, originalSignal, strategy);
            } else {
                console.log('⚡ Processing as NEW SIGNAL (text only)');

                // STORE SIGNAL IN REDIS FOR FUTURE RESULTS
                await redisService.set(redisKey, alertData.signal);
                console.log(`💾 Stored signal "${alertData.signal}" for ${alertData.ticker} (Key: ${redisKey})`);

                const message = webhookController.formatNewSignal(alertData);
                // BROADCAST to configured channels for this strategy
                const success = await telegramService.broadcastToAllChannels(message, strategy);
                if (success) console.log(`✅ Signal broadcast to [${strategy}] channels`);
                else console.log(`❌ Failed to broadcast to [${strategy}] channels`);

                // FORWARD to external platform
                forwardingService.forwardSignal(alertData);
            }

        } catch (error) {
            console.error('❌ Alert processing error:', error);
        }
    },

    async processTradeResultWithChart(alertData, originalSignal, strategy) {
        try {
            console.log(`🎯 Processing trade result - Original: ${originalSignal}, Result: ${alertData.signal}`);

            // CORRECT: Pass BOTH signals to the chart service
            const chartBuffer = await realTradeResultService.generateTradeResult(
                alertData.ticker,
                originalSignal, // "Sell" (from Redis)
                alertData.signal, // "Loss" (from TradingView webhook)
                alertData.price
            );

            const message = webhookController.formatTradeResult(alertData);

            if (chartBuffer) {
                // BROADCAST to all configured channels
                const success = await telegramService.broadcastPhotoToAllChannels(chartBuffer, message, strategy);
                if (success) console.log(`✅ Trade result with chart broadcast to [${strategy}] channels`);
                else console.log(`❌ Failed to broadcast trade result with chart`);
            } else {
                // BROADCAST to all configured channels
                const success = await telegramService.broadcastToAllChannels(message, strategy);
                if (success) console.log(`✅ Trade result broadcast to [${strategy}] channels (no chart)`);
                else console.log(`❌ Failed to broadcast trade result`);
            }

            // FORWARD to external platform
            forwardingService.forwardSignal(alertData);

        } catch (error) {
            console.error('❌ Trade result processing error:', error);
            const message = webhookController.formatTradeResult(alertData);
            // Fallback: broadcast text only
            await telegramService.broadcastToAllChannels(message, strategy);
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

<b>Copy Trade and Trade smater</b>
<a href="https://expertoption-track.com/511427857">Click to Start copy trade</a>

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