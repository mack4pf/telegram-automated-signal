const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function testWebhooks() {
    console.log('🧪 Starting Webhook Verification Tests...\n');

    const tests = [
        {
            name: 'Case 1: GBPUSD to /webhook/vip-2 (No Executor, VIP-2 Channels)',
            url: `${BASE_URL}/webhook/vip-2`,
            body: { ticker: 'GBPUSD', signal: 'buy', price: 1.2650 }
        },
        {
            name: 'Case 2: GBPUSD to /webhook/tradingview (Should hit Executor with GBPUSD)',
            url: `${BASE_URL}/webhook/tradingview`,
            body: { ticker: 'GBPUSD', signal: 'buy', price: 1.2650 }
        },
        {
            name: 'Case 3: Custom Strategy in Body to Legacy Route',
            url: `${BASE_URL}/webhook/tradingview`,
            body: { ticker: 'XAUUSD', signal: 'buy', price: 2045.20, strategy: 'gold' }
        },
        {
            name: 'Case 4: Empty Body (Should log warning and default to EURUSD)',
            url: `${BASE_URL}/webhook/tradingview`,
            body: {}
        }
    ];

    for (const test of tests) {
        console.log(`▶️ Running: ${test.name}`);
        try {
            const response = await axios.post(test.url, test.body, {
                headers: { 'Content-Type': 'application/json' }
            });
            console.log(`✅ Response:`, response.data);
        } catch (error) {
            console.error(`❌ Failed:`, error.response?.data || error.message);
        }
        console.log('-------------------\n');
    }
}

testWebhooks();
