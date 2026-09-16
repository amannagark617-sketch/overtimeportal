import { Employee, OvertimeRecord, UserCredentials } from '../types';

export interface SpreadsheetData {
  employees: Employee[];
  records: OvertimeRecord[];
  users: UserCredentials[];
  reasons?: string[];
  responseSheetId: number | null;
  isFallbackMode?: boolean;
  fallbackError?: string;
}

export interface SheetsStatus {
  isConfigured: boolean;
  hasEnvUrl: boolean;
  activeUrl: string;
  archiveUrl?: string;
  isArchiveConfigured?: boolean;
}

/**
 * Fetch status of the Google Sheets live sync configuration from backend.
 */
export async function fetchAppsScriptStatus(): Promise<SheetsStatus> {
  const response = await fetch('/api/sheets/status');
  if (!response.ok) {
    throw new Error(`Failed to fetch sync status from backend (HTTP ${response.status})`);
  }
  return response.json();
}

/**
 * Save Google Apps Script URLs dynamically on the backend (Active & Archive).
 * This also triggers a live connection verification.
 */
export async function saveAppsScriptUrl(url: string, archiveUrl: string = ''): Promise<boolean> {
  const response = await fetch('/api/sheets/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, archiveUrl })
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Verification failed (HTTP ${response.status})`);
  }
  
  return true;
}

/**
 * Reset custom active Apps Script connection back to simulated demo mode.
 */
export async function resetAppsScriptUrl(): Promise<boolean> {
  const response = await fetch('/api/sheets/reset', { method: 'POST' });
  if (!response.ok) {
    throw new Error('Failed to reset backend database connection');
  }
  return true;
}

/**
 * Fetch current spreadsheet data (employees, records, users) from backend proxy.
 */
export async function fetchSpreadsheetData(): Promise<SpreadsheetData> {
  const response = await fetch('/api/sheets/read');
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Database read error (HTTP ${response.status})`);
  }
  return response.json();
}

/**
 * Appends new overtime records on the backend.
 */
export async function appendOvertimeRecords(
  records: Omit<OvertimeRecord, 'rowIndex'>[]
): Promise<boolean> {
  const response = await fetch('/api/sheets/append', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records })
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Database write error (HTTP ${response.status})`);
  }
  
  return true;
}

/**
 * Updates a specific overtime record on the backend.
 */
export async function updateOvertimeRecord(
  record: OvertimeRecord
): Promise<boolean> {
  const response = await fetch('/api/sheets/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ record })
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Database update error (HTTP ${response.status})`);
  }
  
  return true;
}

/**
 * Deletes an overtime record row index on the backend.
 */
export async function deleteOvertimeRecord(
  rowIndex: number,
  _responseSheetId: number | null
): Promise<boolean> {
  const response = await fetch('/api/sheets/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowIndex })
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Database delete error (HTTP ${response.status})`);
  }
  
  return true;
}
