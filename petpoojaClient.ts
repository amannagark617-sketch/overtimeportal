/**
 * Client for the Petpooja Payroll Third-Party Client API (biometric punch/attendance data).
 * Docs: "Payroll Third-Party Client API" v1.1 (July 2026).
 *
 * Credentials (PETPOOJA_BASE_URL / PETPOOJA_CLIENT_ID / PETPOOJA_CLIENT_SECRET) come only from
 * environment variables (set as Secrets in the hosting platform) -- they are never accepted from
 * the browser and never stored in the repo or the local db.
 */

import * as http from 'http';
import * as https from 'https';

/**
 * The Daily Punch API is documented as `GET /attendance/punches` with a JSON request body
 * (see the vendor's sample cURL: `--request GET ... --data '{"payroll_date": ...}'`).
 * Node's native fetch() refuses to send a body on a GET request ("Request with GET/HEAD method
 * cannot have body"), so this raw request helper is used instead of fetch for that one call.
 */
function httpJsonRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  bodyObj?: unknown
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'http:' ? http : https;
    const bodyStr = bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined;
    const reqHeaders = { ...headers } as Record<string, string>;
    if (bodyStr !== undefined) {
      reqHeaders['Content-Length'] = String(Buffer.byteLength(bodyStr));
    }

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: reqHeaders
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let json: any = {};
          try { json = raw ? JSON.parse(raw) : {}; } catch { json = {}; }
          resolve({ status: res.statusCode || 0, json });
        });
      }
    );
    req.on('error', reject);
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

export interface PunchDetail {
  log_date_time: string;
  op: 'In' | 'Out' | string;
  branch_name: string | null;
  device_id: string | null;
}

export interface PunchEmployee {
  emp_id: string;
  name: string;
  payroll_date: string;
  punch_detail: PunchDetail[];
}

export interface DailyPunchSummary {
  employeeCode: string;
  employeeName: string;
  workedHours: number;
  otHours: number;
  punchCount: number;
  hasOpenPunch: boolean; // odd number of punches (missing a final "Out")
}

function getConfig() {
  const baseUrl = (process.env.PETPOOJA_BASE_URL || '').trim().replace(/\/+$/, '');
  const clientId = (process.env.PETPOOJA_CLIENT_ID || '').trim();
  const clientSecret = (process.env.PETPOOJA_CLIENT_SECRET || '').trim();
  return { baseUrl, clientId, clientSecret };
}

export function isPetpoojaConfigured(): boolean {
  const { baseUrl, clientId, clientSecret } = getConfig();
  return !!(baseUrl && clientId && clientSecret);
}

interface TokenState {
  accessToken: string;
  accessExpiresAt: number; // epoch ms
  refreshToken: string;
  refreshExpiresAt: number; // epoch ms
}

let tokenState: TokenState | null = null;
// Serializes concurrent token requests so parallel callers don't each spend a fresh auth call.
let pendingAuth: Promise<TokenState> | null = null;

async function requestFreshToken(): Promise<TokenState> {
  const { baseUrl, clientId, clientSecret } = getConfig();
  if (!baseUrl || !clientId || !clientSecret) {
    throw new Error('Petpooja API is not configured. Set PETPOOJA_BASE_URL, PETPOOJA_CLIENT_ID and PETPOOJA_CLIENT_SECRET.');
  }

  const response = await fetch(`${baseUrl}/client_auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) {
    throw new Error(body.message || `Petpooja token request failed (HTTP ${response.status})`);
  }

  const now = Date.now();
  return {
    accessToken: body.data.access_token,
    accessExpiresAt: now + (Number(body.data.access_token_expire_in || 900) * 1000),
    refreshToken: body.data.refresh_token,
    refreshExpiresAt: body.data.refresh_token_expire_at ? new Date(body.data.refresh_token_expire_at).getTime() : now + 30 * 24 * 3600 * 1000
  };
}

async function refreshAccessToken(refreshToken: string): Promise<TokenState | null> {
  const { baseUrl } = getConfig();
  const response = await fetch(`${baseUrl}/client_auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) {
    return null; // refresh token invalid/expired/revoked -- caller should re-authenticate from scratch
  }

  const now = Date.now();
  return {
    accessToken: body.data.access_token,
    accessExpiresAt: now + (Number(body.data.access_token_expire_in || 900) * 1000),
    refreshToken,
    refreshExpiresAt: tokenState?.refreshExpiresAt || now + 30 * 24 * 3600 * 1000
  };
}

/** Returns a valid access token, transparently refreshing or re-authenticating as needed. */
async function getAccessToken(forceFresh = false): Promise<string> {
  const SAFETY_BUFFER_MS = 30_000;
  const now = Date.now();

  if (!forceFresh && tokenState && tokenState.accessExpiresAt - SAFETY_BUFFER_MS > now) {
    return tokenState.accessToken;
  }

  if (pendingAuth) {
    const state = await pendingAuth;
    return state.accessToken;
  }

  pendingAuth = (async () => {
    try {
      if (!forceFresh && tokenState && tokenState.refreshExpiresAt - SAFETY_BUFFER_MS > now) {
        const refreshed = await refreshAccessToken(tokenState.refreshToken);
        if (refreshed) {
          tokenState = refreshed;
          return refreshed;
        }
      }
      const fresh = await requestFreshToken();
      tokenState = fresh;
      return fresh;
    } finally {
      pendingAuth = null;
    }
  })();

  const state = await pendingAuth;
  return state.accessToken;
}

/** Fetches raw punch data for a single payroll date (YYYY-MM-DD), retrying once on an expired/invalid token. */
export async function fetchDailyPunches(payrollDate: string): Promise<PunchEmployee[]> {
  const { baseUrl } = getConfig();
  if (!isPetpoojaConfigured()) {
    throw new Error('Petpooja API is not configured. Set PETPOOJA_BASE_URL, PETPOOJA_CLIENT_ID and PETPOOJA_CLIENT_SECRET.');
  }

  const doFetch = (token: string) => httpJsonRequest(
    `${baseUrl}/attendance/punches`,
    'GET',
    { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    { payroll_date: payrollDate }
  );

  let token = await getAccessToken();
  let response = await doFetch(token);

  if (response.status === 401) {
    token = await getAccessToken(true);
    response = await doFetch(token);
  }

  const body = response.json;
  if (response.status < 200 || response.status >= 300 || !body.success) {
    throw new Error(body.message || `Petpooja punch request failed (HTTP ${response.status})`);
  }

  return (body.data?.punch_data || []) as PunchEmployee[];
}

/** Sums worked duration from paired In/Out punches. Odd-numbered punches are "In", even are "Out". */
export function computeWorkedHours(punchDetail: PunchDetail[]): { workedHours: number; hasOpenPunch: boolean } {
  if (!Array.isArray(punchDetail) || punchDetail.length === 0) {
    return { workedHours: 0, hasOpenPunch: false };
  }

  const sorted = [...punchDetail].sort(
    (a, b) => new Date(a.log_date_time).getTime() - new Date(b.log_date_time).getTime()
  );

  let totalMs = 0;
  for (let i = 0; i + 1 < sorted.length; i += 2) {
    const inTime = new Date(sorted[i].log_date_time).getTime();
    const outTime = new Date(sorted[i + 1].log_date_time).getTime();
    if (!isNaN(inTime) && !isNaN(outTime) && outTime > inTime) {
      totalMs += outTime - inTime;
    }
  }

  const hasOpenPunch = sorted.length % 2 !== 0;
  return { workedHours: Math.round((totalMs / 3600000) * 100) / 100, hasOpenPunch };
}

/** Rounds to the nearest 0.5 hour, matching this app's overtime-hours increment rule. */
function roundToHalfHour(hours: number): number {
  return Math.round(hours * 2) / 2;
}

/**
 * Builds a per-employee summary for a day: hours worked and suggested overtime
 * (worked hours beyond `standardShiftHours`, floored at 0 and rounded to the nearest 0.5h).
 */
export function buildDailySummary(punchData: PunchEmployee[], standardShiftHours: number): DailyPunchSummary[] {
  return punchData.map(emp => {
    const { workedHours, hasOpenPunch } = computeWorkedHours(emp.punch_detail);
    const otHours = Math.max(0, roundToHalfHour(workedHours - standardShiftHours));
    return {
      employeeCode: String(emp.emp_id),
      employeeName: emp.name,
      workedHours,
      otHours,
      punchCount: emp.punch_detail?.length || 0,
      hasOpenPunch
    };
  });
}
