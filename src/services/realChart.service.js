const axios = require('axios');
const { createCanvas } = require('canvas');

class RealChartService {
    async generateResultChart(ticker, isWin, currentPrice, durationMinutes = 5) {
        try {
            console.log(`📊 Generating ${isWin ? 'WIN' : 'LOSS'} chart for: ${ticker}`);
            
            // 1. Get REAL price data for the last 5 minutes
            const priceData = await this.getRealPriceData(ticker, durationMinutes);
            
            if (!priceData || priceData.length === 0) {
                throw new Error('No real price data available');
            }
            
            // Use the actual price data for open/close
            const openPrice = priceData[0].price; // First price in the 5-minute period
            const closePrice = currentPrice; // Current price from TradingView
            
            // 2. Generate result chart with win/loss colors
            const chartBuffer = await this.generateResultLineChart(priceData, ticker, isWin, openPrice, closePrice);
            
            console.log('✅ Result chart generated');
            return chartBuffer;
            
        } catch (error) {
            console.error('❌ Chart generation error:', error.message);
            return null;
        }
    }

    async getRealPriceData(ticker, durationMinutes) {
        try {
            console.log(`🔄 Fetching real data from Yahoo for: ${ticker}`);
            const symbol = this.formatSymbol(ticker) + '=X';
            const response = await axios.get(
                `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1m`,
                { timeout: 10000 }
            );
            
            if (!response.data.chart.result[0]) {
                throw new Error('No data from Yahoo');
            }
            
            const result = response.data.chart.result[0];
            const prices = result.indicators.quote[0].close;
            const timestamps = result.timestamp;
            
            // Get last X minutes of data (remove any null values)
            const validData = prices
                .map((price, index) => ({ price, timestamp: timestamps[index] }))
                .filter(item => item.price !== null)
                .slice(-durationMinutes);
            
            return validData.map((item, index) => ({
                time: `${index}min`,
                price: parseFloat(item.price)
            }));
            
        } catch (error) {
            console.error('❌ Yahoo API failed:', error.message);
            throw new Error('Could not fetch real price data');
        }
    }

    async generateResultLineChart(priceData, ticker, isWin, openPrice, closePrice) {
        const width = 600;
        const height = 400;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // Background color based on WIN/LOSS
        const backgroundColor = isWin ? '#011b0bc4' : '#2e0707ff'; // Dark green/red
        const lineColor = isWin ? '#8fe4beff' : '#f78e8eff'; // Bright green/red
        const textColor = '#ffffff';

        // Fill background
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, width, height);

        // Chart area
        const padding = 60;
        const chartWidth = width - (padding * 2);
        const chartHeight = height - (padding * 2);

        // Calculate scales
        const prices = priceData.map(p => p.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const priceRange = maxPrice - minPrice || 0.001;

        // Draw price line
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 4;
        ctx.beginPath();

        priceData.forEach((point, index) => {
            const x = padding + (index / (priceData.length - 1)) * chartWidth;
            const y = padding + chartHeight - ((point.price - minPrice) / priceRange) * chartHeight;
            
            index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Draw start and end points
        ctx.fillStyle = lineColor;
        ctx.beginPath();
        ctx.arc(padding, padding + chartHeight - ((priceData[0].price - minPrice) / priceRange) * chartHeight, 6, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.beginPath();
        ctx.arc(width - padding, padding + chartHeight - ((priceData[priceData.length - 1].price - minPrice) / priceRange) * chartHeight, 6, 0, Math.PI * 2);
        ctx.fill();

        // Add labels
        ctx.fillStyle = textColor;
        ctx.font = 'bold 20px Arial';
        ctx.fillText(`${ticker} • ${isWin ? '🏆 WIN' : '🚫 LOSS'}`, padding, 30);

        ctx.font = 'bold 16px Arial';
        ctx.fillText(`OPEN: ${openPrice.toFixed(5)}`, padding, height - 20);
        ctx.fillText(`CLOSE: ${closePrice.toFixed(5)}`, width - 150, height - 20);

        // Price change
        const change = closePrice - openPrice;
        const changePercent = ((change / openPrice) * 100).toFixed(3);
        const changeText = `CHANGE: ${change >= 0 ? '+' : ''}${change.toFixed(5)} (${changePercent}%)`;
        ctx.fillText(changeText, width / 2 - 100, height - 40);

        // Time labels
        ctx.font = '12px Arial';
        ctx.fillText('5 MIN AGO', padding, height - 60);
        ctx.fillText('NOW', width - padding - 20, height - 60);

        return canvas.toBuffer('image/png');
    }

    formatSymbol(ticker) {
        const pairs = {
            'EUR/USD': 'EURUSD', 'EURUSD': 'EURUSD',
            'GBP/USD': 'GBPUSD', 'GBPUSD': 'GBPUSD', 
            'USD/JPY': 'USDJPY', 'USDJPY': 'USDJPY',
            'AUD/USD': 'AUDUSD', 'AUDUSD': 'AUDUSD',
            'XAU/USD': 'XAUUSD', 'XAUUSD': 'XAUUSD',
            'USD/CAD': 'USDCAD', 'USDCAD': 'USDCAD'
        };
        return pairs[ticker.toUpperCase()] || ticker.replace('/', '');
    }
}

const realChartService = new RealChartService();
module.exports = realChartService;