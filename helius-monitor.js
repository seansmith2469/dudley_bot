const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();

// Initialize bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// Configuration
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || 'MEMECOIN';
const TOKEN_MINT = process.env.TOKEN_MINT_ADDRESS;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

// Photo URLs for buy alerts - replace these with your actual photo URLs
const BUY_PHOTOS = [
    'dudley_photo.jpeg',
];

// Everyone gets the crown
const BUYER_EMOJI = '👑';

// Format numbers
function formatNumber(num) {
    if (num >= 1000000000) return (num / 1000000000).toFixed(2) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
    return num.toFixed(2);
}

// Get SOL price
async function getSolPrice() {
    try {
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
        return response.data.solana.usd;
    } catch (error) {
        console.error('Error fetching SOL price:', error);
        return 150; // Fallback price
    }
}

// Get token info from Birdeye or similar
async function getTokenInfo() {
    // This is a placeholder - you'd integrate with Birdeye API or similar
    return {
        price: 0.00001,
        marketCap: 250000,
        priceChange24h: 15.5
    };
}

// Parse pump.fun transaction
async function parsePumpFunTransaction(signature) {
    try {
        // Use Helius enhanced transaction API
        const response = await axios.post(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_API_KEY}`, {
            transactions: [signature]
        });
        
        const tx = response.data[0];
        
        // Parse the transaction to extract buy details
        // This is pump.fun specific - you'll need to analyze their transactions
        let buyerAddress = null;
        let solAmount = 0;
        let tokenAmount = 0;
        
        // Look for token transfers and SOL transfers
        if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
            const tokenTransfer = tx.tokenTransfers.find(t => t.mint === TOKEN_MINT);
            if (tokenTransfer) {
                buyerAddress = tokenTransfer.toUserAccount;
                tokenAmount = tokenTransfer.tokenAmount;
            }
        }
        
        // Calculate SOL spent from native transfers
        if (tx.nativeTransfers && tx.nativeTransfers.length > 0) {
            const solTransfer = tx.nativeTransfers[0];
            solAmount = solTransfer.amount / 1000000000; // Convert lamports to SOL
        }
        
        return {
            buyer: buyerAddress,
            solAmount,
            tokenAmount,
            signature
        };
    } catch (error) {
        console.error('Error parsing transaction:', error);
        return null;
    }
}

// Create and send buy alert
async function sendBuyAlert(txData) {
    try {
        const solPrice = await getSolPrice();
        const tokenInfo = await getTokenInfo();
        
        const {
            buyer,
            solAmount,
            tokenAmount,
            signature
        } = txData;
        
        // Format values
        const usdValue = solAmount * solPrice;
        const shortBuyer = `${buyer.slice(0, 6)}...${buyer.slice(-4)}`;
        const shortTx = `${signature.slice(0, 6)}...${signature.slice(-4)}`;
        
        // Random buy emojis
        const emojis = ['🚀', '💎', '🔥', '💰', '🌙', '⚡'];
        const randomEmojis = emojis.sort(() => 0.5 - Math.random()).slice(0, 3).join(' ');
        
        // Create message
        const message = `
<b>${TOKEN_SYMBOL} Buy!</b>
${randomEmojis}
${BUYER_EMOJI} spent <b>${formatNumber(usdValue)}</b> (<b>${solAmount.toFixed(3)} SOL</b>)
Got <b>${formatNumber(tokenAmount)} ${TOKEN_SYMBOL}</b>
Buyer: <a href="https://solscan.io/account/${buyer}">${shortBuyer}</a>
TX: <a href="https://solscan.io/tx/${signature}">${shortTx}</a>
${tokenInfo.priceChange24h > 0 ? '📈' : '📉'} 24h: <b>${tokenInfo.priceChange24h > 0 ? '+' : ''}${tokenInfo.priceChange24h.toFixed(1)}%</b>
💰 Market Cap: <b>${formatNumber(tokenInfo.marketCap)}</b>

<a href="https://dexscreener.com/solana/${TOKEN_MINT}">📊 Chart</a> | <a href="https://birdeye.so/token/${TOKEN_MINT}">👁 Birdeye</a> | <a href="https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${TOKEN_MINT}">🛒 Buy</a> | <a href="https://solscan.io/token/${TOKEN_MINT}">🔍 Scan</a>
`;
        
        // Select random photo
        const photo = BUY_PHOTOS[Math.floor(Math.random() * BUY_PHOTOS.length)];
        
        // Send alert with photo instead of GIF
        await bot.sendPhoto(CHANNEL_ID, photo, {
            caption: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
        
        console.log(`✅ Buy alert sent: ${BUYER_EMOJI} bought ${solAmount.toFixed(3)} SOL worth`);
        
    } catch (error) {
        console.error('❌ Error sending alert:', error);
    }
}

// WebSocket monitoring using Helius
async function startWebSocketMonitoring() {
    if (!HELIUS_API_KEY) {
        console.error('❌ No Helius API key provided!');
        return;
    }
    
    const ws = new (require('ws'))(`wss://atlas-mainnet.helius-rpc.com?api-key=${HELIUS_API_KEY}`);
    
    ws.on('open', function open() {
        console.log('✅ Connected to Helius WebSocket');
        
        // Subscribe to token account changes
        const request = {
            jsonrpc: "2.0",
            id: 1,
            method: "logsSubscribe",
            params: [
                {
                    mentions: [TOKEN_MINT]
                },
                {
                    commitment: "confirmed"
                }
            ]
        };
        
        ws.send(JSON.stringify(request));
    });
    
    ws.on('message', async function message(data) {
        try {
            const response = JSON.parse(data);
            
            if (response.params && response.params.result) {
                const signature = response.params.result.value.signature;
                console.log('📥 New transaction:', signature);
                
                // Wait a bit for transaction to be fully confirmed
                setTimeout(async () => {
                    const txData = await parsePumpFunTransaction(signature);
                    if (txData && txData.solAmount > 0.1) { // Only alert for buys > 0.1 SOL
                        await sendBuyAlert(txData);
                    }
                }, 2000);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });
    
    ws.on('error', function error(err) {
        console.error('WebSocket error:', err);
    });
    
    ws.on('close', function close() {
        console.log('❌ WebSocket disconnected. Reconnecting in 5 seconds...');
        setTimeout(startWebSocketMonitoring, 5000);
    });
}

// Alternative: HTTP polling (if WebSocket not available)
async function startPollingMonitoring() {
    console.log('🔄 Starting HTTP polling monitor...');
    
    let lastSignature = null;
    
    setInterval(async () => {
        try {
            const response = await axios.post(`https://api.helius.xyz/v0/addresses/${TOKEN_MINT}/transactions?api-key=${HELIUS_API_KEY}`, {
                limit: 10
            });
            
            const transactions = response.data;
            
            for (const tx of transactions) {
                if (tx.signature === lastSignature) break; // We've seen this one
                
                const txData = await parsePumpFunTransaction(tx.signature);
                if (txData && txData.solAmount > 0.1) {
                    await sendBuyAlert(txData);
                }
            }
            
            if (transactions.length > 0) {
                lastSignature = transactions[0].signature;
            }
            
        } catch (error) {
            console.error('Polling error:', error);
        }
    }, 5000); // Check every 5 seconds
}

// Start monitoring
async function start() {
    console.log('🚀 Starting Buy Alert Bot...');
    console.log(`📢 Channel ID: ${CHANNEL_ID}`);
    console.log(`🪙 Token: ${TOKEN_SYMBOL} (${TOKEN_MINT})`);
    
    if (!TOKEN_MINT) {
        console.error('❌ No token mint address set!');
        return;
    }
    
    if (!CHANNEL_ID) {
        console.error('❌ No channel ID set!');
        return;
    }
    
    // Use WebSocket if Helius API key is available
    if (HELIUS_API_KEY) {
        startWebSocketMonitoring();
    } else {
        console.log('⚠️  No Helius API key - using basic monitoring');
        startPollingMonitoring();
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('👋 Shutting down...');
    process.exit();
});

// Start the bot
start();
