const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();

// Initialize bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// Configuration
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || 'DUDLEY';
const TOKEN_MINT = '3an5tHZm8Yc1ieDaqH68oXZHTV7qsNqCSaTVNEBCpump'; // Your token address
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

// Photo URLs for buy alerts - replace these with your actual photo URLs
const BUY_PHOTOS = [
    'https://raw.githubusercontent.com/seansmith2469/dudley_bot/main/photo1.jpg',
    'https://raw.githubusercontent.com/seansmith2469/dudley_bot/main/photo2.jpg',
    'https://raw.githubusercontent.com/seansmith2469/dudley_bot/main/photo3.jpg',
];

// Everyone gets the crown
const BUYER_EMOJI = '👑';

// Cache for token data to avoid hitting API too often
let tokenDataCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 30000; // 30 seconds

// Format numbers nicely
function formatNumber(num) {
    if (num >= 1000000000) return (num / 1000000000).toFixed(2) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
    return num.toFixed(2);
}

// Format price with appropriate decimals
function formatPrice(price) {
    if (price < 0.00001) return price.toFixed(8);
    if (price < 0.001) return price.toFixed(6);
    if (price < 1) return price.toFixed(4);
    return price.toFixed(2);
}

// Get token data from DexScreener
async function getTokenData() {
    try {
        // Use cache if fresh
        if (tokenDataCache && Date.now() - cacheTimestamp < CACHE_DURATION) {
            return tokenDataCache;
        }

        const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${TOKEN_MINT}`);
        
        if (response.data && response.data.pairs && response.data.pairs.length > 0) {
            // Get the main pair (usually the one with most liquidity)
            const mainPair = response.data.pairs[0];
            
            tokenDataCache = {
                price: parseFloat(mainPair.priceUsd) || 0,
                marketCap: parseFloat(mainPair.fdv) || 0,
                liquidity: parseFloat(mainPair.liquidity?.usd) || 0,
                volume24h: parseFloat(mainPair.volume?.h24) || 0,
                priceChange24h: parseFloat(mainPair.priceChange?.h24) || 0,
                priceChange1h: parseFloat(mainPair.priceChange?.h1) || 0,
                priceChange5m: parseFloat(mainPair.priceChange?.m5) || 0,
                txns24h: (mainPair.txns?.h24?.buys || 0) + (mainPair.txns?.h24?.sells || 0),
                pairAddress: mainPair.pairAddress
            };
            
            cacheTimestamp = Date.now();
            return tokenDataCache;
        }
        
        // Return default if no data
        return {
            price: 0,
            marketCap: 0,
            liquidity: 0,
            volume24h: 0,
            priceChange24h: 0,
            priceChange1h: 0,
            priceChange5m: 0,
            txns24h: 0
        };
        
    } catch (error) {
        console.error('Error fetching DexScreener data:', error);
        // Return cached data if available, otherwise defaults
        return tokenDataCache || {
            price: 0,
            marketCap: 0,
            liquidity: 0,
            volume24h: 0,
            priceChange24h: 0,
            priceChange1h: 0,
            priceChange5m: 0,
            txns24h: 0
        };
    }
}

// Parse pump.fun transaction
async function parsePumpFunTransaction(signature) {
    try {
        // Use Helius enhanced transaction API
        const response = await axios.post(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_API_KEY}`, {
            transactions: [signature]
        });
        
        const tx = response.data[0];
        if (!tx) return null;
        
        // Look for pump.fun swap instruction
        // Pump.fun uses a specific program ID
        const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
        
        let buyerAddress = null;
        let solAmount = 0;
        let tokenAmount = 0;
        
        // Check if this is a pump.fun transaction
        const isPumpFun = tx.instructions?.some(inst => 
            inst.programId === PUMP_FUN_PROGRAM
        );
        
        if (!isPumpFun) return null;
        
        // Parse token transfers
        if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
            const tokenTransfer = tx.tokenTransfers.find(t => 
                t.mint === TOKEN_MINT && t.tokenAmount > 0
            );
            if (tokenTransfer) {
                buyerAddress = tokenTransfer.toUserAccount || tokenTransfer.toOwner;
                tokenAmount = tokenTransfer.tokenAmount;
            }
        }
        
        // Parse SOL amount from native transfers or account data
        if (tx.nativeTransfers && tx.nativeTransfers.length > 0) {
            // Look for SOL going to the pump.fun program or pool
            const relevantTransfer = tx.nativeTransfers.find(t => 
                t.amount > 0 && (
                    t.toUserAccount?.includes('pump') ||
                    t.toUserAccount?.includes('pool') ||
                    !t.toUserAccount?.startsWith('1') // System accounts start with 1
                )
            );
            if (relevantTransfer) {
                solAmount = relevantTransfer.amount / 1000000000; // Convert lamports to SOL
                // If we didn't get buyer from token transfer, try from SOL transfer
                if (!buyerAddress && relevantTransfer.fromUserAccount) {
                    buyerAddress = relevantTransfer.fromUserAccount;
                }
            }
        }
        
        // Only return if we have valid data
        if (buyerAddress && solAmount > 0) {
            return {
                buyer: buyerAddress,
                solAmount,
                tokenAmount,
                signature
            };
        }
        
        return null;
    } catch (error) {
        console.error('Error parsing transaction:', error);
        return null;
    }
}

// Create and send buy alert
async function sendBuyAlert(txData) {
    try {
        const tokenData = await getTokenData();
        
        const {
            buyer,
            solAmount,
            tokenAmount,
            signature
        } = txData;
        
        // Calculate USD value
        const solPrice = await getSolPrice();
        const usdValue = solAmount * solPrice;
        
        // Format addresses
        const shortBuyer = `${buyer.slice(0, 6)}...${buyer.slice(-4)}`;
        const shortTx = `${signature.slice(0, 6)}...${signature.slice(-4)}`;
        
        // Random buy emojis
        const emojis = ['🚀', '💎', '🔥', '💰', '🌙', '⚡', '🎯', '💸', '🏆'];
        const randomEmojis = emojis.sort(() => 0.5 - Math.random()).slice(0, 3).join(' ');
        
        // Build price change string
        let priceChanges = '';
        if (tokenData.priceChange5m !== 0) {
            priceChanges += `5m: ${tokenData.priceChange5m > 0 ? '+' : ''}${tokenData.priceChange5m.toFixed(1)}% `;
        }
        if (tokenData.priceChange1h !== 0) {
            priceChanges += `1h: ${tokenData.priceChange1h > 0 ? '+' : ''}${tokenData.priceChange1h.toFixed(1)}% `;
        }
        if (tokenData.priceChange24h !== 0) {
            priceChanges += `24h: ${tokenData.priceChange24h > 0 ? '+' : ''}${tokenData.priceChange24h.toFixed(1)}%`;
        }
        
        // Create message
        const message = `
<b>${TOKEN_SYMBOL} Buy!</b>
${randomEmojis}
${BUYER_EMOJI} spent <b>$${formatNumber(usdValue)}</b> (<b>${solAmount.toFixed(3)} SOL</b>)
Got <b>${formatNumber(tokenAmount)} ${TOKEN_SYMBOL}</b>
💵 Price: <b>$${formatPrice(tokenData.price)}</b>
${priceChanges ? `📊 ${priceChanges}` : ''}
💰 MCap: <b>$${formatNumber(tokenData.marketCap)}</b> | Vol: <b>$${formatNumber(tokenData.volume24h)}</b>
🌊 Liq: <b>$${formatNumber(tokenData.liquidity)}</b> | Txns: <b>${tokenData.txns24h}</b>

Buyer: <a href="https://solscan.io/account/${buyer}">${shortBuyer}</a> | TX: <a href="https://solscan.io/tx/${signature}">${shortTx}</a>

<a href="https://dexscreener.com/solana/${TOKEN_MINT}">📊 Chart</a> | <a href="https://pump.fun/coin/${TOKEN_MINT}">🎰 Pump</a> | <a href="https://t.me/YOURBOTUSERNAME">🤖 Bot</a>
`;
        
        // Select random photo
        const photo = BUY_PHOTOS[Math.floor(Math.random() * BUY_PHOTOS.length)];
        
        // Send alert with photo
        await bot.sendPhoto(CHANNEL_ID, photo, {
            caption: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
        
        console.log(`✅ Buy alert sent: ${BUYER_EMOJI} bought ${solAmount.toFixed(3)} SOL worth ($${formatNumber(usdValue)})`);
        
    } catch (error) {
        console.error('❌ Error sending alert:', error);
    }
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
                    if (txData && txData.solAmount >= 0.1) { // Only alert for buys >= 0.1 SOL
                        await sendBuyAlert(txData);
                    }
                }, 3000);
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

// Send test alert
async function sendTestAlert() {
    console.log('📤 Sending test alert...');
    const testData = {
        buyer: 'DudleyTestWallet1234567890abcdefghijklmnop',
        solAmount: 2.5,
        tokenAmount: 125000000,
        signature: 'TestTransaction1234567890'
    };
    
    await sendBuyAlert(testData);
}

// Start monitoring
async function start() {
    console.log('🚀 Starting DUDLEY Buy Alert Bot...');
    console.log(`📢 Channel ID: ${CHANNEL_ID}`);
    console.log(`🪙 Token: ${TOKEN_SYMBOL} (${TOKEN_MINT})`);
    
    if (!CHANNEL_ID) {
        console.error('❌ No channel ID set!');
        return;
    }
    
    // Fetch initial token data
    const tokenData = await getTokenData();
    console.log(`💰 Current Price: $${formatPrice(tokenData.price)}`);
    console.log(`📊 Market Cap: $${formatNumber(tokenData.marketCap)}`);
    
    // Uncomment to send a test alert on startup
    await sendTestAlert();
    
    // Start monitoring
    if (HELIUS_API_KEY) {
        startWebSocketMonitoring();
    } else {
        console.log('⚠️  No Helius API key - limited monitoring capabilities');
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('👋 Shutting down...');
    process.exit();
});

// Start the bot
start();
