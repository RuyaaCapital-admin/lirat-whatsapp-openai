// src/lib/toolSchemas.ts

export const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "get_price",
      description: "Return latest price text for a financial symbol.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          timeframe: { type: "string" }
        },
        required: ["symbol"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_ohlc",
      description: "Fetch OHLC candles for a symbol/timeframe (use before computing a signal).",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          timeframe: {
            type: "string",
            enum: ["1m", "5m", "15m", "30m", "1h", "4h", "1d"],
          },
          limit: { type: "integer", minimum: 50, maximum: 400 }
        },
        required: ["symbol", "timeframe"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "compute_trading_signal",
      description: "Compute a trading signal for a symbol and timeframe.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          timeframe: {
            type: "string",
            enum: ["1m", "5m", "15m", "30m", "1h", "4h", "1d"],
          },
          candles: {
            type: "array",
            items: {
              type: "object",
              properties: {
                o: {"type": "number"},
                h: {"type": "number"},
                l: {"type": "number"},
                c: {"type": "number"},
                t: {"type": "integer"}
              },
              required: ["o", "h", "l", "c", "t"],
              additionalProperties: false
            }
          }
        },
        required: ["symbol", "timeframe"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "about_liirat_knowledge",
      description: "Answer Liirat-specific questions using the internal knowledge base.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          lang: { type: "string" }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_web_news",
      description: "Search top market/economic headlines.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          lang: { type: "string", enum: ["ar", "en"] },
          count: { type: "integer", minimum: 1, maximum: 5, default: 3 }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  }
] as const;

export type ToolSchemas = typeof TOOL_SCHEMAS;

export default TOOL_SCHEMAS;
