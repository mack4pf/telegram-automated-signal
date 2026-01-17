const axios = require('axios');

class ExecutorService {
    constructor() {
        this.baseUrl = process.env.EXECUTOR_URL;
        this.secret = process.env.EXECUTOR_SECRET || '1234ea1';
        this.isEnabled = !!this.baseUrl;

        console.log(`🤖 Executor Service Status: ${this.isEnabled ? 'ENABLED' : 'DISABLED'}`);
        if (this.isEnabled) {
            console.log(`🔗 Target URL: ${this.baseUrl}`);
        }
    }

    /**
     * Send a new signal to the execution server
     * @param {Object} alertData - Data from TradingView
     * @returns {Promise<string|null>} signalId from the executor
     */
    async createSignal(alertData) {
        if (!this.isEnabled) {
            console.log('⚠️ Executor service disabled (no URL)');
            return null;
        }

        try {
            // Signal mapping: Call -> buy, Put -> sell
            const rawSignal = (alertData.signal || '').toLowerCase();
            const signalAction = rawSignal.includes('buy') || rawSignal.includes('call') ? 'buy' : 'sell';

            // Time mapping: use alertData.time if available, otherwise parse from signal string
            let timeSeconds = 300;
            if (alertData.time) {
                timeSeconds = parseInt(alertData.time);
            } else if (rawSignal.includes('1min')) {
                timeSeconds = 60;
            } else if (rawSignal.includes('3min')) {
                timeSeconds = 180;
            } else if (rawSignal.includes('15min')) {
                timeSeconds = 900;
            }

            const payload = {
                ticker: (alertData.ticker || 'EURUSD').toUpperCase().replace('-OTC', ''), // Force Real Market
                signal: signalAction,
                price: parseFloat(alertData.price) || 0,
                time: timeSeconds
            };

            console.log('🚀 Sending signal to executor:', payload);

            const response = await axios.post(`${this.baseUrl}/api/signals/create`, payload, {
                headers: {
                    'X-Admin-Secret': this.secret,
                    'Content-Type': 'application/json'
                },
                timeout: 5000
            });

            const signalId = response.data.signalId;
            console.log(`✅ Signal created on executor. ID: ${signalId}`);
            return signalId;

        } catch (error) {
            console.error('❌ Failed to create signal on executor:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Send the trade result to the execution server
     * @param {string} signalId - The ID received from /create
     * @param {string} result - "WIN" or "LOSS"
     */
    async sendResult(signalId, result) {
        if (!this.isEnabled || !signalId) {
            console.log('⚠️ Cannot send result: Service disabled or no signalId');
            return false;
        }

        try {
            // Normalize result to WIN or LOSS
            const normalizedResult = result.toUpperCase().includes('WIN') || result.toUpperCase().includes('WON')
                ? 'WIN'
                : 'LOSS';

            const payload = {
                signalId: signalId,
                signal: normalizedResult
            };

            console.log(`📊 Reporting result to executor [${signalId}]:`, payload);

            await axios.post(`${this.baseUrl}/api/signals/result`, payload, {
                headers: {
                    'X-Admin-Secret': this.secret,
                    'Content-Type': 'application/json'
                },
                timeout: 5000
            });

            console.log(`✅ Result reported to executor: ${normalizedResult}`);
            return true;

        } catch (error) {
            console.error('❌ Failed to report result to executor:', error.response?.data || error.message);
            return false;
        }
    }
}

const executorService = new ExecutorService();
module.exports = executorService;
