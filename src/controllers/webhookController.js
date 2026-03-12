const redisService = require('../services/redis.service');
const telegramService = require('../services/telegram.service');
const realTradeResultService = require('../services/realChart.service');
const forwardingService = require('../services/forwarding.service');
const executorService = require('../services/executor.service');

// Local memory fallback for signal tracking (in case Redis is unstable)
const localSignalCache = new Map();

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

            // CRITICAL: Normalize ticker AT THE START (Strip OTC and other junk)
            const ticker = (alertData.ticker || 'EURUSD')
                .toUpperCase()
                .replace('/', '')
                .replace('-OTC', '')
                .replace(' OTC', '')
                .replace('_OTC', '')
                .replace(' ', '');
            
            alertData.ticker = ticker;

            // Strategy detection improvement
            let strategy = alertData.strategy || 'vip';
            if ((!alertData.strategy || alertData.strategy === 'vip') && alertData.chat_id) {
                const foundStrategy = await redisService.findStrategyByChannel(alertData.chat_id);
                if (foundStrategy) {
                    strategy = foundStrategy;
                }
            }
            alertData.strategy = strategy;

            console.log(`🔄 Processing signal for [${strategy.toUpperCase()}] [${ticker}]...`);

            // Improved signal detection
            const rawSignalStr = (alertData.signal || alertData.direction || alertData.action || alertData.result || '').toUpperCase();
            const signal = rawSignalStr;
            console.log(`🔍 Signal Text: "${rawSignalStr}"`);

            // CORE LOGIC: Time-Based Result Comparison (Aggressive)
            // Use a unified key for the pair across all strategies to prevent mismatch
            const pairKey = `global:last_signal:${ticker}`;
            
            // Get last signal data (Time, Price, Direction)
            let lastDataRaw = await redisService.get(pairKey) || localSignalCache.get(pairKey);
            const currentTime = Date.now();
            
            let isTimeBasedResult = false;
            let originalDirection = 'Buy';
            let entryPrice = 0;

            if (lastDataRaw) {
                const lastData = JSON.parse(lastDataRaw);
                const diffSeconds = (currentTime - lastData.timestamp) / 1000;
                
                console.log(`⏱️ [${ticker}] Time gap: ${diffSeconds.toFixed(1)}s (Target: 300s)`);
                
                // AGGRESSIVE WINDOW: 3 minutes to 8 minutes
                // If ANY message comes 3-8 mins after a signal, it is FORCED to be a result.
                if (diffSeconds >= 180 && diffSeconds <= 480) {
                    console.log('🚨 FORCE ALERT: Message detected in result window. Converting to RESULT.');
                    isTimeBasedResult = true;
                    originalDirection = lastData.direction;
                    entryPrice = lastData.price;
                }
            }

            // DETECT IF THIS IS A RESULT BY KEYWORDS
            const containsResultKeywords = signal.includes('WIN') || 
                                           signal.includes('LOSS') || 
                                           signal.includes('WON') || 
                                           signal.includes('LOST') || 
                                           signal.includes('PROFIT') || 
                                           signal.includes('ITM') || 
                                           signal.includes('OTM');

            if (isTimeBasedResult || containsResultKeywords) {
                console.log(`🎯 RESULT MODE: Calculating ${ticker} based on ${originalDirection} entry @ ${entryPrice}`);

                let finalResultText = containsResultKeywords ? signal : 'CALCULATING...';
                
                // Fetch real current price from Yahoo for calculation
                const priceData = await realTradeResultService.getRealPriceData(ticker, 1);
                const currentPrice = priceData && priceData.length > 0 
                                     ? priceData[priceData.length - 1].price 
                                     : parseFloat(alertData.price);

                if (entryPrice && currentPrice) {
                    const isBuy = originalDirection.toUpperCase().includes('BUY') || 
                                  originalDirection.toUpperCase().includes('CALL') || 
                                  originalDirection.toUpperCase().includes('UP') ||
                                  originalDirection.toUpperCase().includes('LONG');
                    
                    if (isBuy) {
                        finalResultText = currentPrice > entryPrice ? 'WIN' : 'LOSS';
                    } else {
                        finalResultText = currentPrice < entryPrice ? 'WIN' : 'LOSS';
                    }
                    console.log(`🧪 Calc: ${entryPrice} vs ${currentPrice} => ${finalResultText}`);
                } else if (!containsResultKeywords) {
                    finalResultText = 'WIN'; 
                }

                await webhookController.processTradeResultWithChart(alertData, originalDirection, strategy, allowExecutor, finalResultText);
                
                // Clear the last signal so we don't double-trigger
                await redisService.set(pairKey, '0');
                localSignalCache.set(pairKey, '0');
                
            } else {
                console.log('⚡ SIGNAL MODE: Sending new signal to Telegram');

                // If price is missing, get it now to have a good entry for the result later
                let currentEntryPrice = parseFloat(alertData.price);
                if (!currentEntryPrice) {
                    const pData = await realTradeResultService.getRealPriceData(ticker, 1);
                    if (pData && pData.length > 0) currentEntryPrice = pData[pData.length - 1].price;
                }

                // STORE FOR THE 5-MINUTE CHECK
                const signalToStore = {
                    timestamp: currentTime,
                    price: currentEntryPrice || 0,
                    direction: signal || 'Buy'
                };
                
                await redisService.set(pairKey, JSON.stringify(signalToStore));
                localSignalCache.set(pairKey, JSON.stringify(signalToStore));
                
                console.log(`💾 Memory Saved: ${ticker} ${signalToStore.direction} @ ${signalToStore.price}`);

                const message = webhookController.formatNewSignal(alertData);
                await telegramService.broadcastToAllChannels(message, strategy, alertData.chat_id);

                if (allowExecutor) {
                    const signalId = await executorService.createSignal(alertData);
                    if (signalId) {
                        const executorKey = `executor:last_id:${ticker}`;
                        await redisService.set(executorKey, signalId);
                    }
                }
                
                forwardingService.forwardSignal(alertData);
            }
        } catch (error) {
            console.error('❌ Alert processing error:', error);
        }
    },

    async processTradeResultWithChart(alertData, originalSignal, strategy, allowExecutor = false, detectedResult) {
        try {
            const finalResultText = detectedResult || (alertData.signal || '').toUpperCase();
            console.log(`🎯 Processing trade result - Original: ${originalSignal}, Result: ${finalResultText}`);

            // CORRECT: Pass BOTH signals to the chart service
            const chartBuffer = await realTradeResultService.generateTradeResult(
                alertData.ticker,
                originalSignal, // "Sell" (from Redis)
                finalResultText, // Normalized result (from TradingView)
                alertData.price
            );

            const message = webhookController.formatTradeResult(alertData, finalResultText);

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
            const message = webhookController.formatTradeResult(alertData, detectedResult);
            // Fallback: broadcast text only
            await telegramService.broadcastToAllChannels(message, strategy, alertData.chat_id);
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

    formatTradeResult(alertData, finalResultText) {
        const signal = (finalResultText || alertData.signal || '').toUpperCase();
        const pair = alertData.ticker || '';

        let resultEmoji = '🎯';
        let resultText = 'RESULT';

        if (signal.includes('WIN') || signal.includes('WON') || signal.includes('PROFIT') || signal.includes('ITM')) {
            resultEmoji = '🏆';
            resultText = 'WIN';
        } else if (signal.includes('LOSS') || signal.includes('LOST') || signal.includes('OTM')) {
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