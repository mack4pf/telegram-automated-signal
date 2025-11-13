const axios = require('axios');
const { createCanvas } = require('canvas');

class RealChartService {
    constructor() {
        this.apis = [
            { name: 'twelvedata', priority: 1 },
            { name: 'alphavantage', priority: 2 }, 
            { name: 'yahoo', priority: 3 },
            { name: 'fmp', priority: 4 }
        ];
    }

    async generateTradeChart(ticker, durationMinutes = 5) {
        console.log(`📊 Generating REAL ${durationMinutes}min chart for: ${ticker}`);
        
        try {
            // Try APIs in order until one works
            const priceData = await this.getRealPriceData(ticker, durationMinutes);
            
            if (!priceData || priceData.length === 0) {
                throw new Error('All APIs failed - no real data available');
            }
            
            const chartBuffer = await this.generateLineChart(priceData, ticker);
            console.log('✅ REAL price movement chart generated');
            return chartBuffer;
            
        } catch (error) {
            console.error('❌ ALL real data APIs failed:', error.message);
            return null; // No chart instead of fake data
        }
    }

    async getRealPriceData(ticker, durationMinutes) {
        // Try each API in priority order
        for (const api of this.apis.sort((a, b) => a.priority - b.priority)) {
            try {
                console.log(`🔄 Trying ${api.name} API...`);
                const data = await this[`fetchFrom${this.capitalize(api.name)}`](ticker, durationMinutes);
                
                if (data && data.length > 0) {
                    console.log(`✅ Success with ${api.name} API`);
                    return data;
                }
            } catch (error) {
                console.log(`❌ ${api.name} API failed:`, error.message);
                continue; // Try next API
            }
        }
        
        throw new Error('All data sources failed');
    }

    async fetchFromTwelvedata(ticker, durationMinutes) {
        const symbol = this.formatSymbol(ticker);
        const response = await axios.get(
            `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=1min&outputsize=${durationMinutes}&apikey=demo`
        );
        
        return response.data.values.map(item => ({
            time: item.datetime,
            price: parseFloat(item.close)
        })).reverse();
    }

    async fetchFromAlphavantage(ticker, durationMinutes) {
        const symbol = this.formatSymbol(ticker);
        const response = await axios.get(
            `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${symbol.substring(0,3)}&to_symbol=${symbol.substring(3)}&interval=1min&apikey=demo&outputsize=compact`
        );
        
        const timeSeries = response.data['Time Series FX (1min)'];
        return Object.entries(timeSeries).slice(0, durationMinutes).map(([time, data]) => ({
            time: time,
            price: parseFloat(data['4. close'])
        })).reverse();
    }

    async fetchFromYahoo(ticker, durationMinutes) {
        const symbol = this.formatSymbol(ticker) + '=X';
        const response = await axios.get(
            `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1m`
        );
        
        const quotes = response.data.chart.result[0];
        const prices = quotes.indicators.quote[0].close;
        const timestamps = quotes.timestamp;
        
        return prices.slice(-durationMinutes).map((price, index) => ({
            time: new Date(timestamps[timestamps.length - durationMinutes + index] * 1000).toISOString(),
            price: parseFloat(price)
        }));
    }

    async fetchFromFmp(ticker, durationMinutes) {
        const symbol = this.formatSymbol(ticker);
        const response = await axios.get(
            `https://financialmodelingprep.com/api/v3/historical-chart/1min/${symbol}?apikey=demo`
        );
        
        return response.data.slice(0, durationMinutes).map(item => ({
            time: item.date,
            price: parseFloat(item.close)
        })).reverse();
    }

    generateLineChart(priceData, ticker) {
        const width = 600;
        const height = 300;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, width, height);

        // Chart setup
        const padding = 50;
        const chartWidth = width - (padding * 2);
        const chartHeight = height - (padding * 2);

        // Calculate scales
        const prices = priceData.map(p => p.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const priceRange = maxPrice - minPrice || 1;

        // Draw price line
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 3;
        ctx.beginPath();

        priceData.forEach((point, index) => {
            const x = padding + (index / (priceData.length - 1)) * chartWidth;
            const y = padding + chartHeight - ((point.price - minPrice) / priceRange) * chartHeight;
            
            index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Labels
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px Arial';
        ctx.fillText(`${ticker} - Price Movement`, padding, 25);
        
        ctx.font = '12px Arial';
        ctx.fillText(`Start: ${priceData[0].price.toFixed(5)}`, width - 150, 25);
        ctx.fillText(`End: ${priceData[priceData.length - 1].price.toFixed(5)}`, width - 150, 45);
        
        const priceChange = priceData[priceData.length - 1].price - priceData[0].price;
        ctx.fillText(`Change: ${priceChange.toFixed(5)}`, width - 150, 65);

        return canvas.toBuffer('image/png');
    }

    formatSymbol(ticker) {
        const pairs = {
            'EUR/USD': 'EURUSD', 'EURUSD': 'EURUSD',
            'GBP/USD': 'GBPUSD', 'GBPUSD': 'GBPUSD', 
            'USD/JPY': 'USDJPY', 'USDJPY': 'USDJPY',
            'AUD/USD': 'AUDUSD', 'AUDUSD': 'AUDUSD',
            'XAU/USD': 'XAUUSD', 'XAUUSD': 'XAUUSD'
        };
        return pairs[ticker.toUpperCase()] || ticker.replace('/', '');
    }

    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}

const realChartService = new RealChartService();
module.exports = realChartService;