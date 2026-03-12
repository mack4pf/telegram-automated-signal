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

            // Improved signal detection (check all common TradingView fields)
            const rawSignalStr = (alertData.signal || alertData.direction || alertData.action || alertData.result || '').toUpperCase();
            const signal = rawSignalStr;
            console.log(`🔍 Detected raw signal text: "${rawSignalStr}"`);

            // REPLACEMENT CORE LOGIC: Time-Based Result Comparison
            const lastTimeKey = `${strategy}:${ticker}:last_time`;
            const lastPriceKey = `${strategy}:${ticker}:last_price`;
            const lastSignalKey = `${strategy}:${ticker}:last_signal_direction`;
            
            const lastSignalTime = await redisService.get(lastTimeKey);
            const currentTime = Date.now();
            
            // Check if this signal arrived roughly 5 minutes (285-330s) after the last one
            let isTimeBasedResult = false;
            if (lastSignalTime) {
                const diffSeconds = (currentTime - parseInt(lastSignalTime)) / 1000;
                console.log(`⏱️ Time since last signal for ${ticker}: ${diffSeconds.toFixed(1)}s`);
                
                // If message arrives 5 minutes later, it IS a result, even if it looks like a signal
                if (diffSeconds >= 285 && diffSeconds <= 340) {
                    console.log('🎯 Confirmed: Message arrived @ 5min mark. Forcing as RESULT.');
                    isTimeBasedResult = true;
                }
            }

            // Use legacy key for 'vip' to preserve open trades, namespace others
            const redisKey = strategy === 'vip'
                ? `${ticker}:last_signal`
                : `${strategy}:${ticker}:last_signal`;

            // DETECT IF THIS IS A RESULT OR NEW SIGNAL
            const containsResultKeywords = signal.includes('WIN') || 
                                           signal.includes('LOSS') || 
                                           signal.includes('WON') || 
                                           signal.includes('LOST') || 
                                           signal.includes('PROFIT') || 
                                           signal.includes('ITM') || 
                                           signal.includes('OTM');

            if (isTimeBasedResult || containsResultKeywords) {
                console.log('🎯 Processing as TRADE RESULT (Calculation Mode)');

                // 1. Get the original signal and price we stored 5 mins ago
                const originalDirection = await redisService.get(lastSignalKey) || await redisService.get(redisKey) || 'Buy';
                let entryPrice = parseFloat(await redisService.get(lastPriceKey));
                
                // 2. Calculate WIN/LOSS if we don't have explicit result keywords
                let finalResultText = signal;
                if (!containsResultKeywords || isTimeBasedResult) {
                    console.log(`📊 Calculating result for ${originalDirection} started at ${entryPrice}...`);
                    
                    // Fetch current price from Yahoo for calculation
                    const currentPriceData = await realTradeResultService.getRealPriceData(ticker, 1);
                    const currentPrice = currentPriceData && currentPriceData.length > 0 
                                         ? currentPriceData[currentPriceData.length - 1].price 
                                         : parseFloat(alertData.price);

                    if (entryPrice && currentPrice) {
                        const isOriginalBuy = originalDirection.toUpperCase().includes('BUY') || 
                                              originalDirection.toUpperCase().includes('CALL') || 
                                              originalDirection.toUpperCase().includes('UP') ||
                                              originalDirection.toUpperCase().includes('LONG');
                        
                        // Result calculation: price higher = WIN for BUY, lower = WIN for SELL
                        if (isOriginalBuy) {
                            finalResultText = currentPrice > entryPrice ? 'WIN' : 'LOSS';
                        } else {
                            finalResultText = currentPrice < entryPrice ? 'WIN' : 'LOSS';
                        }
                        console.log(`⚖️  Calculation: Entry ${entryPrice} vs Current ${currentPrice} [Signal: ${originalDirection}] => ${finalResultText}`);
                    }
                }

                await webhookController.processTradeResultWithChart(alertData, originalDirection, strategy, allowExecutor, finalResultText);
                
                // Reset timer so next one isn't seen as a result too fast
                await redisService.set(lastTimeKey, '0');
                
            } else {
                console.log('⚡ Processing as NEW SIGNAL');

                // STORE SIGNAL AND PRICE FOR THE 5-MINUTE COMPARISON
                await redisService.set(redisKey, alertData.signal);
                await redisService.set(lastSignalKey, alertData.signal);
                await redisService.set(lastTimeKey, currentTime.toString());
                
                // If price is missing from webhook, fetch it to store a reliable entry
                let entryPrice = parseFloat(alertData.price);
                if (!entryPrice) {
                    const priceData = await realTradeResultService.getRealPriceData(ticker, 1);
                    if (priceData && priceData.length > 0) {
                        entryPrice = priceData[priceData.length - 1].price;
                    }
                }
                await redisService.set(lastPriceKey, (entryPrice || 0).toString());
                
                console.log(`💾 Stored signal "${alertData.signal}" @ ${entryPrice} for ${alertData.ticker}`);

                const message = webhookController.formatNewSignal(alertData);
                // BROADCAST to configured channels for this strategy + explicit chat_id
                const success = await telegramService.broadcastToAllChannels(message, strategy, alertData.chat_id);
                if (success) console.log(`✅ Signal broadcast to [${strategy}] channels`);

                // --- INTEGRATION WITH EXECUTOR ---
                if (allowExecutor) {
                    const signalId = await executorService.createSignal(alertData);
                    if (signalId) {
                        const executorKey = `executor:last_id:${alertData.ticker}`;
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