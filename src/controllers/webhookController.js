const redisService = require('../services/redis.service');
const telegramService = require('../services/telegram.service');
const realTradeResultService = require('../services/realChart.service');
const forwardingService = require('../services/forwarding.service');
const executorService = require('../services/executor.service');

// Use a simple object instead of class to avoid "this" issues
const webhookController = {
    async handleTradingViewAlert(req, res) {
        // Log the incoming request for debugging
        console.log(`📨 [${new Date().toISOString()}] Webhook Received:`, {
            method: req.method,
            url: req.url,
            params: req.params,
            body: req.body
        });

        // Ensure we have a body object
        req.body = req.body || {};
        if (Object.keys(req.body).length === 0) {
            console.warn('⚠️ Warning: Received empty request body. Ticker might default to EURUSD.');
        }

        // Priority for strategy: 1. Body, 2. URL Param, 3. Default 'vip'
        const strategy = req.body.strategy || req.params.strategy || 'vip';
        req.body.strategy = strategy;

        try {
            // 1. Immediately respond to TradingView
            res.status(200).json({ status: 'received', processed: true });

            // 2. Process the alert - pass the allowExecutor flag
            webhookController.processAlert(req.body, req.allowExecutor);

        } catch (error) {
            console.error('❌ Webhook error:', error);
            if (!res.headersSent) {
                res.status(200).json({ status: 'received' });
            }
        }
    },

    async processAlert(alertData, allowExecutor = false) {
        try {
            // Check if system is active
            const systemActive = await redisService.getSystemState();
            if (!systemActive) {
                console.log('⏸️  System inactive - ignoring signal');
                return;
            }

            // Ensure ticker exists
            const ticker = (alertData.ticker || 'EURUSD').toUpperCase().replace('/', '');
            alertData.ticker = ticker;

            // Strategy detection improvement:
            // 1. If strategy is missing but chat_id is present, try to find the strategy in Redis
            let strategy = alertData.strategy || 'vip';
            if ((!alertData.strategy || alertData.strategy === 'vip') && alertData.chat_id) {
                const foundStrategy = await redisService.findStrategyByChannel(alertData.chat_id);
                if (foundStrategy) {
                    strategy = foundStrategy;
                    console.log(`🎯 Reverse lookup found strategy: ${strategy} for chat_id: ${alertData.chat_id}`);
                }
            }
            alertData.strategy = strategy;

            console.log(`🔄 Processing signal for [${strategy.toUpperCase()}] strategy [${ticker}]...`);

            const signal = (alertData.signal || '').toUpperCase();
            console.log(`🔍 Detected signal: "${signal}"`);

            // Use legacy key for 'vip' to preserve open trades, namespace others
            const redisKey = strategy === 'vip'
                ? `${ticker}:last_signal`
                : `${strategy}:${ticker}:last_signal`;

            if (signal.includes('WIN') || signal.includes('LOSS') || signal.includes('WON') || signal.includes('LOST')) {
                console.log('🎯 Processing as TRADE RESULT WITH CHART');

                // GET ORIGINAL SIGNAL FROM REDIS
                const originalSignal = await redisService.get(redisKey) || 'Buy';
                console.log(`📝 Original signal was: ${originalSignal}`);

                await webhookController.processTradeResultWithChart(alertData, originalSignal, strategy, allowExecutor);
            } else {
                console.log('⚡ Processing as NEW SIGNAL (text only)');

                // STORE SIGNAL IN REDIS FOR FUTURE RESULTS
                await redisService.set(redisKey, alertData.signal);
                console.log(`💾 Stored signal "${alertData.signal}" for ${alertData.ticker} (Key: ${redisKey})`);

                const message = webhookController.formatNewSignal(alertData);
                // BROADCAST to configured channels for this strategy + explicit chat_id
                const success = await telegramService.broadcastToAllChannels(message, strategy, alertData.chat_id);
                if (success) console.log(`✅ Signal broadcast to [${strategy}] channels`);
                else console.log(`❌ Failed to broadcast to [${strategy}] channels`);

                // --- INTEGRATION WITH EXECUTOR (LEGACY VIP ROUTE ONLY) ---
                if (allowExecutor) {
                    const signalId = await executorService.createSignal(alertData);
                    if (signalId) {
                        const executorKey = `executor:last_id:${alertData.ticker}`;
                        await redisService.set(executorKey, signalId);
                    }
                }
                // ---------------------------------

                // FORWARD to external platform
                forwardingService.forwardSignal(alertData);
            }

        } catch (error) {
            console.error('❌ Alert processing error:', error);
        }
    },

    async processTradeResultWithChart(alertData, originalSignal, strategy, allowExecutor = false) {
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
                // BROADCAST to all configured channels + explicit chat_id
                const success = await telegramService.broadcastPhotoToAllChannels(chartBuffer, message, strategy, alertData.chat_id);
                if (success) console.log(`✅ Trade result with chart broadcast to [${strategy}] channels`);
                else console.log(`❌ Failed to broadcast trade result with chart`);
            } else {
                // BROADCAST to all configured channels + explicit chat_id
                const success = await telegramService.broadcastToAllChannels(message, strategy, alertData.chat_id);
                if (success) console.log(`✅ Trade result broadcast to [${strategy}] channels (no chart)`);
                else console.log(`❌ Failed to broadcast trade result`);
            }

            // --- INTEGRATION WITH EXECUTOR (DISABLED TO PREVENT GHOST SIGNALS) ---
            /*
            if (allowExecutor) {
                const executorKey = `executor:last_id:${alertData.ticker}`;
                const signalId = await redisService.get(executorKey);
                if (signalId) {
                    await executorService.sendResult(signalId, alertData.signal);
                }
            }
            */
            // ---------------------------------

            // FORWARD to external platform (DISABLED TO PREVENT GHOST SIGNALS)
            // forwardingService.forwardSignal(alertData);

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

        // Robust direction detection for Telegram display
        const rawSignal = (alertData.signal || alertData.direction || alertData.action || '').toLowerCase();
        let displaySignal = 'Unknown';

        if (rawSignal.includes('buy') || rawSignal.includes('call') || rawSignal.includes('long') || rawSignal.includes('up')) {
            displaySignal = 'BUY';
        } else if (rawSignal.includes('sell') || rawSignal.includes('put') || rawSignal.includes('short') || rawSignal.includes('down')) {
            displaySignal = 'SELL';
        } else if (alertData.signal) {
            displaySignal = alertData.signal.toUpperCase();
        }

        const timeframe = webhookController.extractRealTimeframe(alertData);

        return `⚡ <b>INCOMING SIGNAL</b> 

${flag} <b>${pair}</b>
🔔 <b>${displaySignal}</b>
⏰ <b>${timeframe}</b>

<a href="https://affiliate.iqoption.net/redir/?aff=785369&aff_model=revenue&afftrack=">Click to Start copy trade</a>

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
        const signal = (alertData.signal || '').toUpperCase();
        const bodyText = JSON.stringify(alertData).toUpperCase();

        // Look for actual timeframe in the signal or body
        if (bodyText.includes('5MIN') || bodyText.includes('5M')) return '5 MINUTES';
        if (bodyText.includes('3MIN') || bodyText.includes('3M')) return '3 MINUTES';
        if (bodyText.includes('1MIN') || bodyText.includes('1M')) return '1 MINUTE';
        if (bodyText.includes('15MIN') || bodyText.includes('15M')) return '15 MINUTES';
        if (bodyText.includes('30MIN') || bodyText.includes('30M')) return '30 MINUTES';

        // Default to 5 minutes
        return '5 MINUTES';
    }
};

module.exports = webhookController;