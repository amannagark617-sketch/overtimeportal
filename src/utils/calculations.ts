import { Employee, OvertimeRecord } from '../types';

/**
 * Calculates estimated overtime cost based on employee total salary and dynamic days in month
 * Formula: Overtime Pay = (Total Salary ÷ Days in Month ÷ 8) × Overtime Hours
 */
export function calculateOTCost(
  source: { totalSalary?: number; basic?: number; date?: string | Date; precomputedOTCost?: number } | undefined, 
  otHours: number,
  recordDate?: string | Date
): number {
  if (!source) return 0;
  if (source.precomputedOTCost !== undefined) {
    return source.precomputedOTCost;
  }
  const totalSalary = (source.totalSalary !== undefined && source.totalSalary > 0) 
    ? source.totalSalary 
    : ((source.basic !== undefined && source.basic > 0) ? source.basic : 0);
  if (totalSalary <= 0) return 0;
  
  // Resolve date to find month
  let dateObj: Date | null = null;
  const rawDate = recordDate || source.date;
  if (rawDate) {
    if (rawDate instanceof Date) {
      dateObj = rawDate;
    } else {
      dateObj = parseDateString(rawDate);
    }
  }
  
  // Default to current date if invalid or missing
  if (!dateObj || isNaN(dateObj.getTime()) || dateObj.getTime() === 0) {
    dateObj = new Date();
  }
  
  const year = dateObj.getFullYear();
  const month = dateObj.getMonth(); // 0-indexed
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  const hourlyRate = totalSalary / daysInMonth / 8;
  return Math.round(hourlyRate * otHours);
}

/**
 * Automatic fooding calculation logic
 * If OT Hours = 4.5 or 5 -> Fooding Applicable = 1 (₹50 food allowance)
 * If OT Hours < 4.5 or > 5 -> Fooding Applicable = 0 (Meal provided or not eligible)
 */
export function calculateFooding(otHours: number): number {
  return (otHours === 4.5 || otHours === 5) ? 1 : 0;
}

/**
 * Checks if overtime hours value is in increments of 0.5
 */
export function isValidOTHours(otHours: number): boolean {
  if (isNaN(otHours) || otHours <= 0 || otHours > 24) return false;
  return (otHours * 10) % 5 === 0;
}

/**
 * Generates robust, locale-independent timestamp formatted as "DD/MM/YYYY, HH:mm:ss" in Asia/Kolkata timezone
 */
export function getIndianTimestamp(date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const day = parts.find(p => p.type === 'day')?.value || '01';
    const month = parts.find(p => p.type === 'month')?.value || '01';
    const year = parts.find(p => p.type === 'year')?.value || '2026';
    const hour = parts.find(p => p.type === 'hour')?.value || '00';
    const minute = parts.find(p => p.type === 'minute')?.value || '00';
    const second = parts.find(p => p.type === 'second')?.value || '00';
    return `${day}/${month}/${year}, ${hour}:${minute}:${second}`;
  } catch (e) {
    const pad = (n: number) => String(n).padStart(2, '0');
    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const year = date.getFullYear();
    const hour = pad(date.getHours());
    const minute = pad(date.getMinutes());
    const second = pad(date.getSeconds());
    return `${day}/${month}/${year}, ${hour}:${minute}:${second}`;
  }
}

/**
 * Robustly parses a timestamp string (which can be DD/MM/YYYY, HH:mm:ss or Chinese locales or dd-MMM-yyyy) into a JS Date
 */
export function parseIndianTimestamp(tsStr: string | undefined): Date {
  if (!tsStr || tsStr === 'N/A') return new Date(0);
  
  // Strip leading single quote if present
  let cleanStr = typeof tsStr === 'string' ? tsStr.trim() : String(tsStr).trim();
  if (cleanStr.startsWith("'")) {
    cleanStr = cleanStr.slice(1);
  }

  // Try matching standard DD/MM/YYYY, HH:mm:ss (seconds optional)
  const matchDmy = cleanStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})[,\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (matchDmy) {
    const [, day, month, year, hour, minute, second] = matchDmy;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second || 0));
  }

  // Support DD-MMM-YYYY format: e.g. "14-Jul-2026 08:31:57" or "14-Jul-2026 08:31" (seconds optional)
  const matchDmyName = cleanStr.match(/^(\d{1,2})[-/]([A-Za-z]{3,9})[-/](\d{4})[,\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (matchDmyName) {
    const [, day, monthStr, year, hour, minute, second] = matchDmyName;
    const monthsMap: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };
    const monthVal = monthsMap[monthStr.toLowerCase().substring(0, 3)] ?? 0;
    return new Date(Number(year), monthVal, Number(day), Number(hour), Number(minute), Number(second || 0));
  }

  // Support YYYY/MM/DD with Chinese PM/AM indicators: e.g. "2026/7/13 下午8:31:57" (seconds optional)
  const isPM = cleanStr.includes('下午') || cleanStr.toLowerCase().includes('pm');
  const isAM = cleanStr.includes('上午') || cleanStr.toLowerCase().includes('am');
  
  if (isPM || isAM) {
    // Extract just numbers, slashes, and colons
    const timeDigits = cleanStr.replace(/[^\d/:\s-]/g, '').trim();
    // Match YYYY/MM/DD HH:mm:ss
    const matchYmd = timeDigits.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (matchYmd) {
      const [, year, month, day, hour, minute, second] = matchYmd;
      let h = Number(hour);
      if (isPM && h < 12) h += 12;
      if (isAM && h === 12) h = 0;
      return new Date(Number(year), Number(month) - 1, Number(day), h, Number(minute), Number(second || 0));
    }
  }

  // Standard fallback
  const parsed = new Date(cleanStr);
  return isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

/**
 * Formats any timestamp string (including Chinese formats) into standard DD-MMM-YYYY HH:mm:ss (e.g. 13-Jul-2026 20:31:57)
 */
export function formatIndianTimestamp(tsStr: string | undefined): string {
  if (!tsStr || tsStr === 'N/A') return 'N/A';
  const date = parseIndianTimestamp(tsStr);
  if (date.getTime() === 0) return tsStr; // Fallback to raw string if we can't parse it
  
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(date.getDate()).padStart(2, '0');
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  
  return `${day}-${month}-${year} ${hour}:${minute}:${second}`;
}

/**
 * Formats currency values nicely in Indian Rupees format (₹)
 */
export function formatCurrency(amount: number): string {
  const formatted = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(amount);
  return `₹ ${formatted}`;
}

/**
 * Robust date formatter to convert a date string (e.g. YYYY-MM-DD) to DD-MM-YYYY format
 */
export function formatDateToDDMMYYYY(dateStr: string): string {
  if (!dateStr || dateStr === 'N/A') return dateStr;
  
  // Try to match YYYY-MM-DD or YYYY/MM/DD
  const match = dateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) {
    const [, year, month, day] = match;
    return `${day.padStart(2, '0')}-${month.padStart(2, '0')}-${year}`;
  }

  // If it's already DD-MM-YYYY or DD/MM/YYYY, format nicely with hyphens
  const isAlreadyFormatted = dateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (isAlreadyFormatted) {
    const [, day, month, year] = isAlreadyFormatted;
    return `${day.padStart(2, '0')}-${month.padStart(2, '0')}-${year}`;
  }

  // Fallback using standard JS Date parsing
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    }
  } catch (e) {
    // Keep original
  }

  return dateStr;
}

/**
 * Robust date formatter to convert any date string (e.g. YYYY-MM-DD or DD-MM-YYYY) to DD-MMM-YYYY format (e.g. 30-Jul-2026)
 */
export function formatDateToDDMMMYYYY(dateStr: string): string {
  if (!dateStr || dateStr === 'N/A') return dateStr;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  const d = parseDateString(dateStr);
  if (d.getTime() === 0 || isNaN(d.getTime())) return dateStr;

  const day = String(d.getDate()).padStart(2, '0');
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

// High-performance cache for parseDateString to avoid re-parsing regexes on large datasets
const dateParseCache = new Map<string, Date>();

/**
 * Robustly parses any date string format (e.g., YYYY-MM-DD, DD-MM-YYYY, or DD-MMM-YYYY) into a proper Date object
 */
export function parseDateString(dateStr: string | undefined): Date {
  if (!dateStr || dateStr === 'N/A') return new Date(0);
  let cleanStr = typeof dateStr === 'string' ? dateStr.trim() : String(dateStr).trim();
  if (cleanStr.startsWith("'")) {
    cleanStr = cleanStr.slice(1);
  }

  const cached = dateParseCache.get(cleanStr);
  if (cached) return cached;

  let result: Date;

  // 1. Check YYYY-MM-DD or YYYY/MM/DD
  const matchYmd = cleanStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (matchYmd) {
    const [, year, month, day] = matchYmd;
    result = new Date(Number(year), Number(month) - 1, Number(day));
  } else {
    // 2. Check DD-MM-YYYY or DD/MM/YYYY
    const matchDmy = cleanStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (matchDmy) {
      const [, day, month, year] = matchDmy;
      result = new Date(Number(year), Number(month) - 1, Number(day));
    } else {
      // 3. Check DD-MMM-YYYY or DD/MMM/YYYY or DD MMM YYYY, e.g. "02-May-2026" or "18 Jul 2026"
      const matchDmyName = cleanStr.match(/^(\d{1,2})[-/\s]+([A-Za-z]{3,9})[-/\s]+(\d{4})/);
      if (matchDmyName) {
        const [, day, monthStr, year] = matchDmyName;
        const monthsMap: Record<string, number> = {
          jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
        };
        const monthVal = monthsMap[monthStr.toLowerCase().substring(0, 3)] ?? 0;
        result = new Date(Number(year), monthVal, Number(day));
      } else {
        // 4. Check standard JS toString() format: "Sat Jul 18 2026 05:30:00 GMT..."
        const matchMdy = cleanStr.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/);
        if (matchMdy) {
          const [, monthStr, day, year] = matchMdy;
          const monthsMap: Record<string, number> = {
            jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
          };
          const monthVal = monthsMap[monthStr.toLowerCase().substring(0, 3)] ?? 0;
          result = new Date(Number(year), monthVal, Number(day));
        } else {
          // Fallback parsing
          const parsed = new Date(cleanStr);
          if (isNaN(parsed.getTime())) {
            result = new Date(0);
          } else {
            const hasTimezone = /GMT|Z|[+-]\d{2}/i.test(cleanStr);
            if (hasTimezone) {
              try {
                const formatter = new Intl.DateTimeFormat('en-US', {
                  timeZone: 'Asia/Kolkata',
                  year: 'numeric',
                  month: 'numeric',
                  day: 'numeric'
                });
                const parts = formatter.formatToParts(parsed);
                const m = parts.find(p => p.type === 'month')?.value || '1';
                const d = parts.find(p => p.type === 'day')?.value || '1';
                const y = parts.find(p => p.type === 'year')?.value || '1970';
                result = new Date(Number(y), Number(m) - 1, Number(d));
              } catch (e) {
                result = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
              }
            } else {
              result = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
            }
          }
        }
      }
    }
  }

  // Prevent memory leaks by capping cache size
  if (dateParseCache.size > 2000) {
    dateParseCache.clear();
  }
  dateParseCache.set(cleanStr, result);

  return result;
}

