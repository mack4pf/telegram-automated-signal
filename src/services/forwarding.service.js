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
