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
            enum: ["1min", "5min", "15min", "30min", "1hour", "4hour", "1day"],
          },
          limit: { type: "integer", minimum: 30, maximum: 60, default: 60 }
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
          ohlc: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              timeframe: {
                type: "string",
                enum: ["1min", "5min", "15min", "30min", "1hour", "4hour", "1day"],
              },
              candles: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    o: { type: "number" },
                    h: { type: "number" },
                    l: { type: "number" },
                    c: { type: "number" },
                    t: { type: "integer" },
                  },
                  required: ["o", "h", "l", "c", "t"],
                  additionalProperties: false,
                },
              },
              lastCandleUnix: { type: "integer" },
              lastCandleISO: { type: "string" },
              ageSeconds: { type: "number" },
              isStale: { type: "boolean" },
              tooOld: { type: "boolean" },
              provider: { type: "string" },
            },
            // Be permissive: allow the model to provide just symbol/timeframe and rely on tool to fetch candles
            required: ["symbol", "timeframe", "candles"],
            additionalProperties: false,
          },
          lang: { type: "string", enum: ["ar", "en"] },
        },
        // Allow either ohlc payload or top-level symbol/timeframe; the handler will cope
        required: [],
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
