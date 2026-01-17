require('dotenv').config();
const express = require('express');
const redisService = require('./services/redis.service');
const webhookController = require('./controllers/webhookController');
const botService = require('./services/bot.service');

const app = express();
app.use(express.json());

// Initialize Redis connection when server starts
const initializeRedis = async () => {
    console.log('🔄 Connecting to Redis...');
    const connected = await redisService.connect();

    if (connected) {
        console.log('✅ Redis connected successfully');
        // Set default state - bot starts as ACTIVE
        await redisService.setSystemState(true);
    } else {
        console.log('❌ Redis connection failed - running without Redis');
    }
};

// Call initialization
initializeRedis();

// TradingView Webhook Endpoint
// TradingView Webhook Endpoint (Legacy & Dynamic)
// 1. Legacy support (defaults to 'vip')
app.post('/webhook/tradingview', (req, res, next) => {
    req.params.strategy = 'vip'; // Force default strategy
    req.allowExecutor = true;    // Only this legacy route can trigger AutoTrade
    next();
}, webhookController.handleTradingViewAlert);

// 2. Dynamic Strategy Support (e.g., /webhook/gold, /webhook/silver)
app.post('/webhook/:strategy', webhookController.handleTradingViewAlert);

// Basic route - now shows Redis status
app.get('/', (req, res) => {
    res.json({
        status: '✅ Server is running',
        redis: redisService.isReady() ? '✅ Connected' : '❌ Disconnected',
        timestamp: new Date().toISOString()
    });
});

// Health check with Redis status
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        redis_connected: redisService.isReady(),
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Webhook: POST http://localhost:${PORT}/webhook/tradingview`);
    console.log(`📍 Health: http://localhost:${PORT}/health`);
    console.log(`🤖 Bot controls: /start, /stop, /status`);
});

module.exports = app;