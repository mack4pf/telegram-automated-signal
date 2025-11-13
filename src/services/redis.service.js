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

    // ADD THIS FUNCTION - Set system state (active/inactive)
    async setSystemState(isActive) {
        if (!this.isConnected) {
            console.log('⚠️  Redis not connected - cannot set state');
            return false;
        }
        
        try {
            await this.client.set('system:active', isActive ? 'true' : 'false');
            console.log(`📊 System state set to: ${isActive}`);
            return true;
        } catch (error) {
            console.error('❌ Error setting system state:', error);
            return false;
        }
    }

    // ADD THIS FUNCTION - Get system state
    async getSystemState() {
        if (!this.isConnected) {
            console.log('⚠️  Redis not connected - defaulting to active');
            return true; // Default to active if Redis down
        }
        
        try {
            const state = await this.client.get('system:active');
            return state === 'true'; // Convert to boolean
        } catch (error) {
            console.error('❌ Error getting system state:', error);
            return true; // Default to active on error
        }
    }

    // Check if Redis is ready
    isReady() {
        return this.isConnected;
    }
}

// Create single instance
const redisService = new RedisService();
module.exports = redisService;