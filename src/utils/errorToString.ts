// src/utils/errorToString.ts
export function errorToString(e: unknown): string {
  if (e instanceof Error) return e.message;
  try { 
    return JSON.stringify(e); 
  } catch { 
    return String(e); 
  }
}
