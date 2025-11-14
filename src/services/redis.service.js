const redis = require('redis');

class RedisService {
    constructor() {
        this.client = null;
        this.isConnected = false;
    }

    // Connect to Redis
    async connect() {
        try {
            this.client = redis.createClient({
                url: process.env.REDIS_URL || 'redis://localhost:6379'
            });

            this.client.on('error', (err) => {
                console.error('Redis Error:', err);
                this.isConnected = false;
            });

            this.client.on('connect', () => {
                console.log('✅ Redis Connected');
                this.isConnected = true;
            });

            await this.client.connect();
            return true;
        } catch (error) {
            console.error('Redis connection failed:', error);
            return false;
        }
    }

    // ADD THESE MISSING METHODS:

    // Set key-value pair
    async set(key, value) {
        if (!this.isConnected) {
            console.log('⚠️  Redis not connected - cannot set value');
            return false;
        }
        
        try {
            await this.client.set(key, value);
            console.log(`💾 Redis SET: ${key} = ${value}`);
            return true;
        } catch (error) {
            console.error('❌ Redis set error:', error);
            return false;
        }
    }

    // Get value by key
    async get(key) {
        if (!this.isConnected) {
            console.log('⚠️  Redis not connected - returning default');
            return null;
        }
        
        try {
            const value = await this.client.get(key);
            console.log(`🔍 Redis GET: ${key} = ${value}`);
            return value;
        } catch (error) {
            console.error('❌ Redis get error:', error);
            return null;
        }
    }

    // Set system state (active/inactive)
    async setSystemState(isActive) {
        return await this.set('system:active', isActive ? 'true' : 'false');
    }

    // Get system state
    async getSystemState() {
        const state = await this.get('system:active');
        return state === 'true';
    }

    // Check if Redis is ready
    isReady() {
        return this.isConnected;
    }
}

// Create single instance
const redisService = new RedisService();
module.exports = redisService;