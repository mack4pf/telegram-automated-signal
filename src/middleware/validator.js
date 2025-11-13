const redisService = require('../services/redis.service');

const tradingViewValidator = async (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    
    // Ultra-fast validation
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Invalid payload' });
    }

    // Check critical fields exist
    const { chat_id, signal, ticker } = req.body;
    if (!chat_id || !signal || !ticker) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // Rate limiting by IP + ticker
    const rateLimitKey = `${clientIP}:${ticker}`;
    const isWithinLimit = await redisService.checkRateLimit(rateLimitKey, 30, 60000); // 30 req/min
    
    if (!isWithinLimit) {
        return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    next();
};

module.exports = { tradingViewValidator };