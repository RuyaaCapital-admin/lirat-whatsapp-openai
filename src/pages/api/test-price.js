// src/pages/api/test-price.js
import { getCurrentPrice } from '../../tools/price';

export default async function handler(req, res) {
  try {
    const { symbol = "XAUUSD", tf = "1m" } = req.query;
    console.log('[TEST] Testing price for:', symbol, tf);
    
    const result = await getCurrentPrice(String(symbol), String(tf));
    
    res.status(200).json({
      success: true,
      symbol: symbol,
      timeframe: tf,
      result: result
    });
  } catch (error) {
    console.error('[TEST] Price test failed:', error);
    res.status(500).json({ 
      success: false,
      error: error.message, 
      stack: error.stack 
    });
  }
}
