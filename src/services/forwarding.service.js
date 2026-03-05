const axios = require('axios');

class ForwardingService {
    constructor() {
        this.forwardingUrl = process.env.FORWARDING_URL;
        this.isEnabled = !!this.forwardingUrl;
    }

    async forwardSignal(payload) {
        if (!this.isEnabled) {
            return false;
        }

        try {
            // Only forward actual Buy/Sell signals, ignore results
            const signalAction = (payload.signal || '').toLowerCase();
            const isSignal = signalAction.includes('buy') || signalAction.includes('sell') ||
                signalAction.includes('call') || signalAction.includes('put') ||
                signalAction.includes('up') || signalAction.includes('down') ||
                signalAction.includes('long') || signalAction.includes('short');

            const isResult = signalAction.includes('win') || signalAction.includes('loss') ||
                signalAction.includes('won') || signalAction.includes('lost');

            if (isResult && !isSignal) {
                console.log('ℹ️ Forwarding skipped: Payload is a trade result, not a new signal.');
                return false;
            }

            console.log(`↪️ Forwarding signal to ${this.forwardingUrl}...`);
            await axios.post(this.forwardingUrl, payload, {
                timeout: 5000
            });
            console.log('✅ Signal forwarded successfully');
            return true;
        } catch (error) {
            console.error('❌ Failed to forward signal:', error.message);
            return false;
        }
    }
}

const forwardingService = new ForwardingService();
module.exports = forwardingService;
