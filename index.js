const TelegramBot = require('node-telegram-bot-api');
const { Connection, PublicKey } = require('@solana/web3.js');
const axios = require('axios');
require('dotenv').config();

// Initialize bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// Solana connection
const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');

// Your channel/group ID where messages will be posted
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

// Token details
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || 'MEMECOIN';
const TOKEN_MINT = process.env.TOKEN_MINT_ADDRESS;

// GIF URLs - you can rotate through these
const GIFS = [
    'https://media.giphy.com/media/l0HlQ7LRalQqdWfao/giphy.gif', // Money printer
    'https://media.giphy.com/media/67ThRZlYBvibtdF9JH/giphy.gif', // Rocket
    'https://media.giphy.com/media/JpG2A9P3dPHXaTYrwu/giphy.gif', // Celebration
    'https://media.giphy.com/media/5VKbvrjxpVJCM/giphy.gif', // Cash
];

// Emojis for random selection
const BUY_EMOJIS = ['🚀', '💎', '🔥', '💰', '🌙', '⚡', '🎯', '💸', '🏆', '🎰'];
const WHALE_EMOJIS = ['🐋', '🦈', '🐳'];

// Format numbers nicely
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
    return num.toFixed(2);
}

// Get random elements from array
function getRandomEmojis(count = 3) {
    const shuffled = [...BUY_EMOJIS].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count).join(' ');
}

// Create buy alert message
async function createBuyAlert(buyData) {
    const {
        buyer,
        amountSOL,
        amountTokens,
        txSignature,
        marketCap,
        priceChange
    } = buyData;
    
    // Determine if it's a whale buy
    const isWhale = amountSOL >= 10;
    const buyerEmoji = isWhale ? WHALE_EMOJIS[Math.floor(Math.random() * WHALE_EMOJIS.length)] : '🐟';
    
    // Format buyer address
    const shortBuyer = `${buyer.slice(0, 4)}...${buyer.slice(-4)}`;
    
    // Create message
    const message = `
<b>${TOKEN_SYMBOL} Buy!</b>
${getRandomEmojis()}
${buyerEmoji} spent <b>$${formatNumber(amountSOL * 150)}</b> (<b>${amountSOL.toFixed(2)} SOL</b>)
Got <b>${formatNumber(amountTokens)} ${TOKEN_SYMBOL}</b>
Buyer: <code>${shortBuyer}</code>
${priceChange > 0 ? '📈' : '📉'} Position: <b>${priceChange > 0 ? '+' : ''}${priceChange.toFixed(1)}%</b>
💰 Market Cap: <b>$${formatNumber(marketCap)}</b>

<a href="https://dexscreener.com/solana/${TOKEN_MINT}">📊 DexS</a> | <a href="https://birdeye.so/token/${TOKEN_MINT}">🦅 Birdeye</a> | <a href="https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${TOKEN_MINT}">💸 Buy</a> | <a href="https://pump.fun/coin/${TOKEN_MINT}">🎰 Pump</a>
`;
    
    return message;
}

// Send buy alert with GIF
async function sendBuyAlert(buyData) {
    try {
        // Select random GIF
        const gif = GIFS[Math.floor(Math.random() * GIFS.length)];
        
        // Create message
        const message = await createBuyAlert(buyData);
        
        // Send to channel
        await bot.sendAnimation(CHANNEL_ID, gif, {
            caption: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
        
        console.log('✅ Buy alert sent!');
    } catch (error) {
        console.error('❌ Error sending alert:', error);
    }
}

// Monitor transactions (basic example)
async function monitorTransactions() {
    console.log('🔍 Starting transaction monitor...');
    
    if (!TOKEN_MINT) {
        console.error('❌ No token mint address set!');
        return;
    }
    
    const tokenPubkey = new PublicKey(TOKEN_MINT);
    
    // Subscribe to transaction logs
    connection.onLogs(
        tokenPubkey,
        async (logs, context) => {
            try {
                // This is a simplified example
                // In reality, you'd need to parse the transaction to extract buy details
                
                // For testing, let's simulate a buy
                const mockBuyData = {
                    buyer: logs.signature.slice(0, 44), // Using signature as mock buyer
                    amountSOL: Math.random() * 50 + 0.1, // Random amount between 0.1 and 50 SOL
                    amountTokens: Math.random() * 10000000 + 1000, // Random token amount
                    txSignature: logs.signature,
                    marketCap: 150000 + Math.random() * 500000, // Random market cap
                    priceChange: Math.random() * 100 - 20 // Random price change -20% to +80%
                };
                
                // Send alert
                await sendBuyAlert(mockBuyData);
                
            } catch (error) {
                console.error('Error processing transaction:', error);
            }
        },
        'confirmed'
    );
}

// Test command - sends a sample alert
async function sendTestAlert() {
    const testData = {
        buyer: 'Acz1234567890qwertyuiopasdfghjklzxcvbnm',
        amountSOL: 5.5,
        amountTokens: 2500000,
        txSignature: 'test123',
        marketCap: 250000,
        priceChange: 35.2
    };
    
    await sendBuyAlert(testData);
}

// Start the bot
async function start() {
    console.log('🤖 Buy alert bot starting...');
    
    // Test the connection
    try {
        const version = await connection.getVersion();
        console.log('✅ Connected to Solana:', version);
    } catch (error) {
        console.error('❌ Failed to connect to Solana:', error);
    }
    
    // Uncomment to send a test alert on startup
    // await sendTestAlert();
    
    // Start monitoring
    if (TOKEN_MINT) {
        monitorTransactions();
    } else {
        console.log('⚠️  No token mint set. Add TOKEN_MINT_ADDRESS to start monitoring.');
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('👋 Bot shutting down...');
    process.exit();
});

// Start the bot
start();