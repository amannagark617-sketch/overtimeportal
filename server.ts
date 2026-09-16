import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

function getIndianTimestamp(date = new Date()): string {
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

function normalizeDateToYYYYMMDD(dateStr: string | undefined): string {
  if (!dateStr || dateStr === 'N/A') return 'N/A';
  let cleanStr = String(dateStr).trim();
  if (cleanStr.startsWith("'")) {
    cleanStr = cleanStr.slice(1);
  }

  // 1. Try matching YYYY-MM-DD or YYYY/MM/DD (starts with 4 digits)
  const matchYmd = cleanStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (matchYmd) {
    const [, year, month, day] = matchYmd;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // 2. Try matching DD-MM-YYYY or DD/MM/YYYY (starts with 1 or 2 digits followed by - or / and then 1 or 2 digits, then 4 digits)
  const matchDmy = cleanStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (matchDmy) {
    const [, day, month, year] = matchDmy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // 3. Try matching DD-MMM-YYYY or DD/MMM/YYYY, e.g. "02-May-2026" or "18 Jul 2026"
  const matchDmyName = cleanStr.match(/^(\d{1,2})[-/\s]+([A-Za-z]{3,9})[-/\s]+(\d{4})/);
  if (matchDmyName) {
    const [, day, monthStr, year] = matchDmyName;
    const monthsMap: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
    };
    const monthVal = monthsMap[monthStr.toLowerCase().substring(0, 3)] || '01';
    return `${year}-${monthVal}-${day.padStart(2, '0')}`;
  }

  // 4. Try matching standard JS toString() format: "Sat Jul 18 2026 05:30:00 GMT..."
  // Format is: DayOfWeek Month Day Year ...
  const matchMdy = cleanStr.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/);
  if (matchMdy) {
    const [, monthStr, day, year] = matchMdy;
    const monthsMap: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
    };
    const monthVal = monthsMap[monthStr.toLowerCase().substring(0, 3)] || '01';
    return `${year}-${monthVal}-${day.padStart(2, '0')}`;
  }

  // 5. Try parsing standard Date string and use UTC/Kolkata values to avoid local timezone shifts
  try {
    const d = new Date(cleanStr);
    if (!isNaN(d.getTime())) {
      const hasTimezone = /GMT|Z|[+-]\d{2}/i.test(cleanStr);
      if (hasTimezone) {
        const formatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        return formatter.format(d); // Returns YYYY-MM-DD
      } else {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    }
  } catch (e) {
    // ignore
  }

  return cleanStr;
}

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- Persistent Directories & Storage Setup ---
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads')));

const DEFAULT_REASONS = [
  'Machine Breakdown',
  'Urgent Shipment Demand',
  'Quarterly Close Support',
  'Stock Verification',
  'Client Urgent Support',
  'Maintenance & Cleanup',
  'System Upgrade',
  'Pending Audit Support'
];

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initial Mock Data
const MOCK_EMPLOYEES = [
  {
    employeeCode: 'EMP001',
    employeeName: 'Aman Kumar',
    designation: 'Accounts Manager',
    department: 'Finance',
    payroll: 'Direct Contract',
    basic: 45000,
    hra: 18000,
    splAllowance: 5000,
    conveyance: 1600,
    lta: 3000,
    otherAllowance: 2000,
    bonus: 0,
    totalSalary: 74600
  },
  {
    employeeCode: 'EMP002',
    employeeName: 'Rajesh Sharma',
    designation: 'Senior Developer',
    department: 'IT Department',
    payroll: 'Direct Contract',
    basic: 65000,
    hra: 26000,
    splAllowance: 8000,
    conveyance: 1600,
    lta: 4000,
    otherAllowance: 3000,
    bonus: 5000,
    totalSalary: 112600
  },
  {
    employeeCode: 'EMP003',
    employeeName: 'Priya Patel',
    designation: 'HR Executive',
    department: 'Human Resources',
    payroll: 'Indirect Staff',
    basic: 35000,
    hra: 14000,
    splAllowance: 3000,
    conveyance: 1600,
    lta: 2000,
    otherAllowance: 1500,
    bonus: 0,
    totalSalary: 57100
  },
  {
    employeeCode: 'EMP004',
    employeeName: 'Sunil Verma',
    designation: 'System Administrator',
    department: 'IT Department',
    payroll: 'Direct Contract',
    basic: 48000,
    hra: 19200,
    splAllowance: 4500,
    conveyance: 1600,
    lta: 2500,
    otherAllowance: 1800,
    bonus: 0,
    totalSalary: 77600
  },
  {
    employeeCode: 'EMP005',
    employeeName: 'Pooja Singh',
    designation: 'Payroll Officer',
    department: 'Finance',
    payroll: 'Indirect Staff',
    basic: 38000,
    hra: 15200,
    splAllowance: 3500,
    conveyance: 1600,
    lta: 2200,
    otherAllowance: 1600,
    bonus: 0,
    totalSalary: 62100
  },
  {
    employeeCode: 'EMP006',
    employeeName: 'Karan Malhotra',
    designation: 'Data Analyst',
    department: 'Analytics',
    payroll: 'Direct Contract',
    basic: 42000,
    hra: 16800,
    splAllowance: 4000,
    conveyance: 1600,
    lta: 2000,
    otherAllowance: 1200,
    bonus: 0,
    totalSalary: 67600
  }
];

const MOCK_USERS = [
  { id: 'aman', passwordHash: 'aman123', type: 'Admin' },
  { id: 'accounts', passwordHash: 'accounts123', type: 'User' },
  { id: 'operator', passwordHash: 'op123', type: 'User' }
];

const INITIAL_MOCK_RECORDS = [
  {
    rowIndex: 2,
    timestamp: '10/07/2026, 18:30:15',
    employeeCode: 'EMP001',
    employeeName: 'Aman Kumar',
    designation: 'Accounts Manager',
    department: 'Finance',
    payroll: 'Direct Contract',
    date: '2026-07-10',
    overtimeHours: 4.5,
    foodingApplicable: 1,
    enteredBy: 'operator',
    remarks: 'Quarterly financial report closure assistance'
  },
  {
    rowIndex: 3,
    timestamp: '11/07/2026, 19:15:00',
    employeeCode: 'EMP002',
    employeeName: 'Rajesh Sharma',
    designation: 'Senior Developer',
    department: 'IT Department',
    payroll: 'Direct Contract',
    date: '2026-07-11',
    overtimeHours: 5.0,
    foodingApplicable: 1,
    enteredBy: 'operator',
    remarks: 'Server security update and backup configuration'
  },
  {
    rowIndex: 4,
    timestamp: '11/07/2026, 17:45:22',
    employeeCode: 'EMP003',
    employeeName: 'Priya Patel',
    designation: 'HR Executive',
    department: 'Human Resources',
    payroll: 'Indirect Staff',
    date: '2026-07-11',
    overtimeHours: 3.5,
    foodingApplicable: 0,
    enteredBy: 'accounts',
    remarks: 'Employee onboarding files organization'
  },
  {
    rowIndex: 5,
    timestamp: '12/07/2026, 18:00:10',
    employeeCode: 'EMP004',
    employeeName: 'Sunil Verma',
    designation: 'System Administrator',
    department: 'IT Department',
    payroll: 'Direct Contract',
    date: '2026-07-12',
    overtimeHours: 4.5,
    foodingApplicable: 1,
    enteredBy: 'accounts',
    remarks: 'Network switches hardware maintenance'
  }
];

// Initialize JSON files if missing
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({
    employees: MOCK_EMPLOYEES,
    records: INITIAL_MOCK_RECORDS,
    users: MOCK_USERS
  }, null, 2));
}

if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ 
    appsScriptUrl: 'https://script.google.com/macros/s/AKfycbzZVgM9VFd56dm4xSr7QYQ2ms-_mtcgFKJi2YdIotgtDuVUkjHNel5JxeZ8IqauTHiIgw/exec',
    archiveAppsScriptUrl: ''
  }, null, 2));
}

// Get configured Active Apps Script URL
function getActiveAppsScriptUrl(): string {
  const envUrl = process.env.APPS_SCRIPT_URL || process.env.VITE_APPS_SCRIPT_URL;
  if (envUrl && envUrl.trim() !== '') {
    return envUrl.trim();
  }
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      if (data.appsScriptUrl && data.appsScriptUrl.trim() !== '') {
        return data.appsScriptUrl.trim();
      }
    }
  } catch (err) {
    console.error('Error reading configuration file', err);
  }
  return 'https://script.google.com/macros/s/AKfycbzZVgM9VFd56dm4xSr7QYQ2ms-_mtcgFKJi2YdIotgtDuVUkjHNel5JxeZ8IqauTHiIgw/exec';
}

// Get configured Archive Apps Script URL
function getArchiveAppsScriptUrl(): string {
  const envUrl = process.env.ARCHIVE_APPS_SCRIPT_URL || process.env.VITE_ARCHIVE_APPS_SCRIPT_URL;
  if (envUrl && envUrl.trim() !== '') {
    return envUrl.trim();
  }
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      if (data.archiveAppsScriptUrl && data.archiveAppsScriptUrl.trim() !== '') {
        return data.archiveAppsScriptUrl.trim();
      }
    }
  } catch (err) {
    console.error('Error reading configuration file for archive URL', err);
  }
  return '';
}

// Set dynamic Apps Script URLs
function setAppsScriptUrls(url: string, archiveUrl: string = ''): void {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ 
      appsScriptUrl: url.trim(),
      archiveAppsScriptUrl: archiveUrl.trim()
    }, null, 2));
  } catch (err) {
    console.error('Error writing configuration file', err);
  }
}

// Get/save simulated local records helper
function getLocalDb() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    if (!data.reasons) {
      data.reasons = DEFAULT_REASONS;
    }
    if (Array.isArray(data.records)) {
      data.records = data.records.map((r: any) => ({
        remarks: r.remarks || 'OFP-0001',
        reasonForOvertime: r.reasonForOvertime || 'Urgent Shipment Demand',
        approvalForOT: r.approvalForOT || '',
        ...r,
        date: normalizeDateToYYYYMMDD(r.date)
      }));
    }
    return data;
  } catch (e) {
    return { 
      employees: MOCK_EMPLOYEES, 
      records: INITIAL_MOCK_RECORDS.map(r => ({
        ...r,
        remarks: r.remarks || 'OFP-0001',
        reasonForOvertime: 'Urgent Shipment Demand',
        approvalForOT: '',
        date: normalizeDateToYYYYMMDD(r.date)
      })), 
      users: MOCK_USERS,
      reasons: DEFAULT_REASONS
    };
  }
}

function saveLocalDb(data: any) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error writing local DB', e);
  }
}

// --- SECURED SERVER SIDE API ROUTES ---

// 1. Get Integration Status
app.get('/api/sheets/status', (req, res) => {
  const url = getActiveAppsScriptUrl();
  const archiveUrl = getArchiveAppsScriptUrl();
  const envUrl = process.env.APPS_SCRIPT_URL || process.env.VITE_APPS_SCRIPT_URL;
  res.json({
    isConfigured: url && url.startsWith('http'),
    hasEnvUrl: !!(envUrl && envUrl.trim() !== ''),
    activeUrl: url ? `${url.substring(0, 30)}...` : '',
    archiveUrl: archiveUrl ? `${archiveUrl.substring(0, 30)}...` : '',
    isArchiveConfigured: archiveUrl && archiveUrl.startsWith('http')
  });
});

// 2. Set Configured Apps Script Web App URLs (Active & Archive)
app.post('/api/sheets/config', async (req, res) => {
  const { url, archiveUrl } = req.body;
  const trimmedActive = typeof url === 'string' ? url.trim() : '';
  const trimmedArchive = typeof archiveUrl === 'string' ? archiveUrl.trim() : '';
  
  if (trimmedActive !== '' && !trimmedActive.startsWith('http')) {
    res.status(400).json({ error: 'Active URL must start with http/https' });
    return;
  }

  if (trimmedArchive !== '' && !trimmedArchive.startsWith('http')) {
    res.status(400).json({ error: 'Archive URL must start with http/https' });
    return;
  }

  // Attempt verification for Active URL if not empty
  if (trimmedActive !== '') {
    try {
      const verifyUrl = `${trimmedActive}${trimmedActive.includes('?') ? '&' : '?'}action=read`;
      const response = await fetch(verifyUrl, { method: 'GET', redirect: 'follow' });
      if (!response.ok) {
        throw new Error(`Active sheet verification returned HTTP status ${response.status}`);
      }
      const data = await response.json();
      if (data.error) {
        throw new Error(`Active sheet error: ${data.error}`);
      }
    } catch (err: any) {
      console.error('Active Apps Script verification failed:', err);
      res.status(422).json({ error: `Active connection validation failed: ${err.message || err}` });
      return;
    }
  }

  // Attempt verification for Archive URL if provided
  if (trimmedArchive !== '') {
    try {
      const verifyUrl = `${trimmedArchive}${trimmedArchive.includes('?') ? '&' : '?'}action=read`;
      const response = await fetch(verifyUrl, { method: 'GET', redirect: 'follow' });
      if (!response.ok) {
        throw new Error(`Archive sheet verification returned HTTP status ${response.status}`);
      }
      const data = await response.json();
      if (data.error) {
        throw new Error(`Archive sheet error: ${data.error}`);
      }
    } catch (err: any) {
      console.error('Archive Apps Script verification failed:', err);
      res.status(422).json({ error: `Archive connection validation failed: ${err.message || err}` });
      return;
    }
  }

  setAppsScriptUrls(
    trimmedActive !== '' ? trimmedActive : 'https://script.google.com/macros/s/AKfycbzZVgM9VFd56dm4xSr7QYQ2ms-_mtcgFKJi2YdIotgtDuVUkjHNel5JxeZ8IqauTHiIgw/exec',
    trimmedArchive
  );
  invalidateSheetCache();
  res.json({ success: true, message: 'Google Sheets integration settings successfully updated!' });
});

// --- In-Memory Read Cache for Performance ---
let cachedSheetResponse: any = null;
let lastCacheTime = 0;
const READ_CACHE_TTL_MS = 60000; // 60 seconds TTL for combined active response

let cachedArchiveData: any = null;
let lastArchiveCacheTime = 0;
let lastArchiveUrlUsed = '';
const ARCHIVE_CACHE_TTL_MS = 600000; // 10 minutes TTL for static historical archive sheet

function invalidateSheetCache() {
  cachedSheetResponse = null;
  lastCacheTime = 0;
  cachedArchiveData = null;
  lastArchiveCacheTime = 0;
  lastArchiveUrlUsed = '';
}

// 3. Reset Configuration to default connection
app.post('/api/sheets/reset', (req, res) => {
  setAppsScriptUrls('https://script.google.com/macros/s/AKfycbzZVgM9VFd56dm4xSr7QYQ2ms-_mtcgFKJi2YdIotgtDuVUkjHNel5JxeZ8IqauTHiIgw/exec', '');
  invalidateSheetCache();
  res.json({ success: true, message: 'Reset configuration to production Google Sheet connection.' });
});

/**
 * Helper to parse CSV strings into 2D array (RFC 4180 compliant)
 */
function parseCSV(text: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      row.push(current.trim());
      current = '';
      if (row.length > 0 && row.some(cell => cell !== '')) {
        lines.push(row);
      }
      row = [];
    } else {
      current += char;
    }
  }
  if (current !== '' || row.length > 0) {
    row.push(current.trim());
    if (row.some(cell => cell !== '')) {
      lines.push(row);
    }
  }
  return lines;
}

function extractSpreadsheetId(urlOrId: string | undefined): string | null {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const str = urlOrId.trim();
  if (/^[a-zA-Z0-9-_]{25,60}$/.test(str)) {
    return str;
  }
  const match = str.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return null;
}

async function fetchSheetCSV(spreadsheetId: string, sheetName: string): Promise<string[][] | null> {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) return null;
    const csvText = await response.text();
    if (!csvText || csvText.includes('<!DOCTYPE html>') || csvText.includes('<html')) {
      return null;
    }
    const rows = parseCSV(csvText);
    return rows && rows.length > 0 ? rows : null;
  } catch (err) {
    return null;
  }
}

function mapResponseCSV(rows: string[][], isArchive: boolean, targetUrl: string) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map(h => h.toLowerCase().trim());
  
  const findCol = (keys: string[]) => {
    for (const key of keys) {
      const idx = headers.indexOf(key.toLowerCase());
      if (idx !== -1) return idx;
    }
    for (const key of keys) {
      const idx = headers.findIndex(h => h.includes(key.toLowerCase()));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const tsIdx = findCol(['timestamp']);
  const codeIdx = findCol(['employee code', 'emp code', 'employee_code']);
  const nameIdx = findCol(['employee name', 'emp name', 'name']);
  const desgIdx = findCol(['designation', 'desg', 'role']);
  const deptIdx = findCol(['department', 'dept']);
  const payrollIdx = findCol(['payroll']);
  const dateIdx = findCol(['date']);
  const otIdx = findCol(['ot hours', 'overtime hours', 'overtime', 'ot_hours']);
  const foodIdx = findCol(['fooding', 'fooding applicable']);
  const enteredByIdx = findCol(['entered by', 'user']);
  const remarksIdx = findCol(['remarks', 'remark', 'ofp number']);
  const reasonIdx = findCol(['reason for overtime', 'reason for ot', 'reason']);
  const approvalIdx = findCol(['approval for ot', 'approval', 'approval file', 'file url']);
  const basicIdx = findCol(['basic']);
  const hraIdx = findCol(['hra']);
  const splIdx = findCol(['spl allowance', 'special allowance']);
  const convIdx = findCol(['conveyance']);
  const ltaIdx = findCol(['lta']);
  const otherIdx = findCol(['other allowance']);
  const bonusIdx = findCol(['bonus']);
  const totalSalaryIdx = findCol(['total salary', 'total_salary']);

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const empCode = codeIdx !== -1 ? row[codeIdx] : (row[1] || '');
    const empName = nameIdx !== -1 ? row[nameIdx] : (row[2] || '');
    if (!empCode && !empName) continue;

    const origRowIndex = i + 1; // Row 1 in CSV is row 2 in sheet
    const effectiveRowIndex = isArchive ? origRowIndex + 1000000 : origRowIndex;

    const rawOt = otIdx !== -1 ? row[otIdx] : row[7];
    let oth = parseFloat(String(rawOt || '0').replace(/[^0-9.-]/g, ''));
    if (isNaN(oth)) oth = 0;

    const rawFood = foodIdx !== -1 ? row[foodIdx] : row[8];
    let fooding = parseInt(String(rawFood || '0').replace(/[^0-9]/g, ''), 10);
    if (isNaN(fooding)) fooding = 0;

    const parseNum = (idx: number) => {
      if (idx === -1 || row[idx] === undefined || row[idx] === '') return undefined;
      const val = parseFloat(String(row[idx]).replace(/[^0-9.-]/g, ''));
      return isNaN(val) ? undefined : val;
    };

    records.push({
      rowIndex: effectiveRowIndex,
      originalRowIndex: origRowIndex,
      isArchive: isArchive,
      targetUrl: targetUrl,
      timestamp: tsIdx !== -1 ? row[tsIdx] : (row[0] || ''),
      employeeCode: empCode,
      employeeName: empName,
      designation: desgIdx !== -1 ? row[desgIdx] : (row[3] || ''),
      department: deptIdx !== -1 ? row[deptIdx] : (row[4] || ''),
      payroll: payrollIdx !== -1 ? row[payrollIdx] : (row[5] || ''),
      date: normalizeDateToYYYYMMDD(dateIdx !== -1 ? row[dateIdx] : row[6]),
      overtimeHours: oth,
      foodingApplicable: fooding,
      enteredBy: enteredByIdx !== -1 ? row[enteredByIdx] : (row[9] || ''),
      remarks: remarksIdx !== -1 ? row[remarksIdx] : (row[10] || ''),
      reasonForOvertime: reasonIdx !== -1 ? row[reasonIdx] : (row[11] || ''),
      approvalForOT: approvalIdx !== -1 ? row[approvalIdx] : (row[12] || ''),
      basic: parseNum(basicIdx),
      hra: parseNum(hraIdx),
      splAllowance: parseNum(splIdx),
      conveyance: parseNum(convIdx),
      lta: parseNum(ltaIdx),
      otherAllowance: parseNum(otherIdx),
      bonus: parseNum(bonusIdx),
      totalSalary: parseNum(totalSalaryIdx)
    });
  }
  return records;
}

function mapMasterDataCSV(rows: string[][]) {
  if (!rows || rows.length < 2) return [];
  const employees = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;
    employees.push({
      employeeCode: String(row[0]),
      employeeName: String(row[1] || ''),
      designation: String(row[2] || ''),
      department: String(row[3] || ''),
      payroll: String(row[4] || ''),
      basic: Number(parseFloat(row[5]) || 0),
      hra: Number(parseFloat(row[6]) || 0),
      splAllowance: Number(parseFloat(row[7]) || 0),
      conveyance: Number(parseFloat(row[8]) || 0),
      lta: Number(parseFloat(row[9]) || 0),
      otherAllowance: Number(parseFloat(row[10]) || 0),
      bonus: Number(parseFloat(row[11]) || 0),
      totalSalary: Number(parseFloat(row[12]) || 0)
    });
  }
  return employees;
}

function mapIDPassCSV(rows: string[][]) {
  if (!rows || rows.length < 2) return [];
  const users = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;
    users.push({
      id: String(row[0]).trim(),
      passwordHash: String(row[1] || '').trim(),
      type: String(row[2] || 'User').trim()
    });
  }
  return users;
}

function mapReasonsCSV(rows: string[][]) {
  if (!rows || rows.length < 2) return DEFAULT_REASONS;
  const reasons: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row && row[0] && String(row[0]).trim()) {
      reasons.push(String(row[0]).trim());
    }
  }
  return reasons.length > 0 ? reasons : DEFAULT_REASONS;
}

async function fetchDataFromCSVExport(spreadsheetId: string, targetUrl: string, isArchive: boolean = false) {
  const [recRows, empRows, userRows, reasonRows] = await Promise.all([
    fetchSheetCSV(spreadsheetId, 'Response'),
    fetchSheetCSV(spreadsheetId, 'Master Data'),
    fetchSheetCSV(spreadsheetId, 'ID Pass'),
    fetchSheetCSV(spreadsheetId, 'Reason of OT')
  ]);

  if (!recRows) {
    throw new Error('Could not fetch Response CSV tab from published Google Sheet.');
  }

  const records = mapResponseCSV(recRows, isArchive, targetUrl);
  const employees = mapMasterDataCSV(empRows || []);
  const users = mapIDPassCSV(userRows || []);
  const reasons = mapReasonsCSV(reasonRows || []);

  return {
    employees,
    records,
    users,
    reasons
  };
}

async function fetchSheetDataForUrl(targetUrl: string, isArchive: boolean = false) {
  // 1. Try Published CSV Export fetch first (0 Apps Script quota usage, ultra-fast)
  const extractedId = extractSpreadsheetId(targetUrl) || (isArchive ? '1p71lCTzQiOYp0sCIw0PqoWoqqi5CTh8VvfNgcZaDS2U' : '122tkJJM7x5CQWsyaMdVYNQesvpIuqYlAzi5w4lxZ3Sw');
  if (extractedId) {
    try {
      const csvData = await fetchDataFromCSVExport(extractedId, targetUrl, isArchive);
      console.log(`Successfully fetched ${isArchive ? 'Archive' : 'Active'} sheet data via Published CSV Export (ID: ${extractedId})`);
      return csvData;
    } catch (csvErr: any) {
      console.warn(`CSV Export fetch failed for ${extractedId}, falling back to Apps Script read:`, csvErr.message);
    }
  }

  // 2. Fallback to Apps Script doGet action=read
  return await fetchAndNormalizeAppsScriptData(targetUrl, isArchive);
}

/**
 * Helper to fetch and normalize data from a single Apps Script URL
 */
async function fetchAndNormalizeAppsScriptData(targetUrl: string, isArchive: boolean = false) {
  const fetchUrl = `${targetUrl}${targetUrl.includes('?') ? '&' : '?'}action=read`;
  const response = await fetch(fetchUrl, { method: 'GET', redirect: 'follow' });
  
  if (!response.ok) {
    throw new Error(`Apps Script responded with status ${response.status}`);
  }
  
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }
  
  const rawRecords = data.records || [];
  const normalizedRecords = rawRecords.map((r: any) => {
    let ts = r.timestamp || '';
    if (typeof ts === 'string' && ts.startsWith("'")) {
      ts = ts.slice(1);
    }
    let oth = r.overtimeHours;
    if (typeof oth === 'string' && oth.startsWith("'")) {
      const cleanedOth = oth.slice(1);
      oth = parseFloat(cleanedOth);
    } else {
      oth = Number(oth);
    }
    if (isNaN(oth)) {
      oth = 0;
    }

    const origRowIndex = typeof r.rowIndex === 'string' ? parseInt(r.rowIndex, 10) : Number(r.rowIndex);
    // Offset archive row indices by 1,000,000 to ensure completely unique keys
    const effectiveRowIndex = isArchive ? origRowIndex + 1000000 : origRowIndex;

    return {
      ...r,
      timestamp: ts,
      date: normalizeDateToYYYYMMDD(r.date),
      rowIndex: effectiveRowIndex,
      originalRowIndex: origRowIndex,
      isArchive: isArchive,
      targetUrl: targetUrl,
      overtimeHours: oth,
      foodingApplicable: typeof r.foodingApplicable === 'string' ? parseInt(r.foodingApplicable, 10) : Number(r.foodingApplicable),
      basic: r.basic !== undefined ? (typeof r.basic === 'string' ? parseFloat(r.basic) : Number(r.basic)) : undefined,
      hra: r.hra !== undefined ? (typeof r.hra === 'string' ? parseFloat(r.hra) : Number(r.hra)) : undefined,
      splAllowance: r.splAllowance !== undefined ? (typeof r.splAllowance === 'string' ? parseFloat(r.splAllowance) : Number(r.splAllowance)) : undefined,
      conveyance: r.conveyance !== undefined ? (typeof r.conveyance === 'string' ? parseFloat(r.conveyance) : Number(r.conveyance)) : undefined,
      lta: r.lta !== undefined ? (typeof r.lta === 'string' ? parseFloat(r.lta) : Number(r.lta)) : undefined,
      otherAllowance: r.otherAllowance !== undefined ? (typeof r.otherAllowance === 'string' ? parseFloat(r.otherAllowance) : Number(r.otherAllowance)) : undefined,
      bonus: r.bonus !== undefined ? (typeof r.bonus === 'string' ? parseFloat(r.bonus) : Number(r.bonus)) : undefined,
      totalSalary: r.totalSalary !== undefined ? (typeof r.totalSalary === 'string' ? parseFloat(r.totalSalary) : Number(r.totalSalary)) : undefined,
    };
  });

  const normalizedEmployees = (data.employees || []).map((e: any) => ({
    ...e,
    basic: typeof e.basic === 'string' ? parseFloat(e.basic) : Number(e.basic || 0),
    hra: typeof e.hra === 'string' ? parseFloat(e.hra) : Number(e.hra || 0),
    splAllowance: typeof e.splAllowance === 'string' ? parseFloat(e.splAllowance) : Number(e.splAllowance || 0),
    conveyance: typeof e.conveyance === 'string' ? parseFloat(e.conveyance) : Number(e.conveyance || 0),
    lta: typeof e.lta === 'string' ? parseFloat(e.lta) : Number(e.lta || 0),
    otherAllowance: typeof e.otherAllowance === 'string' ? parseFloat(e.otherAllowance) : Number(e.otherAllowance || 0),
    bonus: typeof e.bonus === 'string' ? parseFloat(e.bonus) : Number(e.bonus || 0),
    totalSalary: typeof e.totalSalary === 'string' ? parseFloat(e.totalSalary) : Number(e.totalSalary || 0),
  }));

  return {
    employees: normalizedEmployees,
    records: normalizedRecords,
    users: data.users || [],
    reasons: data.reasons || DEFAULT_REASONS
  };
}

// 4. Read Data (Merges Active & Archive Spreadsheets using Published CSV or Apps Script)
app.get('/api/sheets/read', async (req, res) => {
  const isForce = req.query.force === 'true';
  const now = Date.now();

  // Return cached response if valid and not forced
  if (!isForce && cachedSheetResponse && (now - lastCacheTime < READ_CACHE_TTL_MS)) {
    res.json(cachedSheetResponse);
    return;
  }

  const activeUrl = getActiveAppsScriptUrl() || 'https://docs.google.com/spreadsheets/d/122tkJJM7x5CQWsyaMdVYNQesvpIuqYlAzi5w4lxZ3Sw/edit';
  const archiveUrl = getArchiveAppsScriptUrl() || 'https://docs.google.com/spreadsheets/d/1p71lCTzQiOYp0sCIw0PqoWoqqi5CTh8VvfNgcZaDS2U/edit';

  if (activeUrl && activeUrl.startsWith('http')) {
    try {
      const fetchActivePromise = fetchSheetDataForUrl(activeUrl, false);
      
      const isArchiveCacheValid = 
        !isForce && 
        cachedArchiveData && 
        lastArchiveUrlUsed === archiveUrl && 
        (now - lastArchiveCacheTime < ARCHIVE_CACHE_TTL_MS);

      let archiveDataPromise: Promise<any>;
      if (isArchiveCacheValid) {
        archiveDataPromise = Promise.resolve(cachedArchiveData);
      } else {
        archiveDataPromise = fetchSheetDataForUrl(archiveUrl, true)
          .then(data => {
            cachedArchiveData = data;
            lastArchiveCacheTime = Date.now();
            lastArchiveUrlUsed = archiveUrl;
            return data;
          })
          .catch(err => {
            console.error('Failed to fetch archive dataset:', err.message);
            return cachedArchiveData || null; // Fallback to last known archive cache
          });
      }

      const [activeData, archiveData] = await Promise.all([fetchActivePromise, archiveDataPromise]);

      let mergedRecords = [...(activeData.records || [])];
      let mergedEmployees = [...(activeData.employees || [])];
      let mergedUsers = [...(activeData.users || [])];
      let mergedReasons = activeData.reasons || DEFAULT_REASONS;

      if (archiveData) {
        // Append archive records
        mergedRecords = [...mergedRecords, ...(archiveData.records || [])];

        // Deduplicate employee master records by employeeCode
        const empMap = new Map();
        mergedEmployees.forEach((e: any) => empMap.set(e.employeeCode, e));
        (archiveData.employees || []).forEach((e: any) => {
          if (!empMap.has(e.employeeCode)) {
            empMap.set(e.employeeCode, e);
          }
        });
        mergedEmployees = Array.from(empMap.values());

        // Deduplicate users
        const userMap = new Map();
        mergedUsers.forEach((u: any) => userMap.set(u.id, u));
        (archiveData.users || []).forEach((u: any) => {
          if (!userMap.has(u.id)) {
            userMap.set(u.id, u);
          }
        });
        mergedUsers = Array.from(userMap.values());
      }

      const payload = {
        employees: mergedEmployees,
        records: mergedRecords,
        users: mergedUsers,
        reasons: mergedReasons,
        responseSheetId: 1,
        isDualSource: !!archiveData
      };

      cachedSheetResponse = payload;
      lastCacheTime = Date.now();

      res.json(payload);
    } catch (err: any) {
      console.error('Backend sheets/read failed, falling back to cached local db:', err.message);
      const localDb = getLocalDb();
      res.json({
        employees: localDb.employees || [],
        records: localDb.records || [],
        users: localDb.users || [],
        reasons: localDb.reasons || DEFAULT_REASONS,
        responseSheetId: 1,
        isFallbackMode: true,
        fallbackError: err.message || 'Connection offline'
      });
    }
  } else {
    // Serve from server-side mock db.json
    res.json(getLocalDb());
  }
});

// 5. Append Record
app.post('/api/sheets/append', async (req, res) => {
  const { records } = req.body;
  if (!Array.isArray(records)) {
    res.status(400).json({ error: 'Missing or invalid records parameter' });
    return;
  }

  const url = getActiveAppsScriptUrl();
  if (url && url.startsWith('http')) {
    try {
      const formattedRecords = records.map((r: any) => {
        let ts = String(r.timestamp || '').trim();
        if (ts.startsWith("'")) {
          ts = ts.slice(1);
        }
        let hours = r.overtimeHours;
        if (typeof hours === 'string') {
          if (hours.startsWith("'")) {
            hours = hours.slice(1);
          }
          hours = parseFloat(hours);
        } else {
          hours = Number(hours);
        }
        if (isNaN(hours)) {
          hours = 0;
        }

        return {
          ...r,
          timestamp: ts,
          overtimeHours: hours,
          foodingApplicable: typeof r.foodingApplicable === 'string' ? parseInt(r.foodingApplicable, 10) : Number(r.foodingApplicable || 0)
        };
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'follow',
        body: JSON.stringify({ action: 'append', records: formattedRecords })
      });
      
      if (!response.ok) {
        throw new Error(`Apps Script append returned status ${response.status}`);
      }
      
      const textResponse = await response.text();
      let result;
      try {
        result = JSON.parse(textResponse);
      } catch (parseErr) {
        throw new Error(`Apps Script did not return JSON response. Please check if your deployment URL is correct. Content starts with: ${textResponse.substring(0, 150)}`);
      }

      if (result.error) {
        throw new Error(result.error);
      }
      
      invalidateSheetCache();
      res.json({ success: true });
    } catch (err: any) {
      console.error('Backend sheets/append failed:', err.message);
      res.status(502).json({ error: `Failed to write to Google Spreadsheet: ${err.message}` });
    }
  } else {
    // Handle on server-side simulated DB
    const db = getLocalDb();
    const nextIndex = db.records.length > 0 ? Math.max(...db.records.map((r: any) => r.rowIndex)) + 1 : 2;
    const appended = records.map((r, i) => ({
      ...r,
      rowIndex: nextIndex + i,
      timestamp: getIndianTimestamp()
    }));
    db.records = [...db.records, ...appended];
    saveLocalDb(db);
    invalidateSheetCache();
    res.json({ success: true });
  }
});

// 6. Update Record
app.post('/api/sheets/update', async (req, res) => {
  const { record } = req.body;
  if (!record) {
    res.status(400).json({ error: 'Missing record parameter' });
    return;
  }

  // Normalize rowIndex to a number
  const rawRowIndex = typeof record.rowIndex === 'string' ? parseInt(record.rowIndex, 10) : Number(record.rowIndex);
  if (isNaN(rawRowIndex)) {
    res.status(400).json({ error: 'Missing or invalid record.rowIndex parameter' });
    return;
  }

  const isArchive = !!record.isArchive || rawRowIndex >= 1000000;
  const targetUrl = record.targetUrl || (isArchive ? getArchiveAppsScriptUrl() : getActiveAppsScriptUrl()) || getActiveAppsScriptUrl();
  const actualRowIndex = record.originalRowIndex || (isArchive && rawRowIndex >= 1000000 ? rawRowIndex - 1000000 : rawRowIndex);

  // Normalize numeric fields in the incoming record
  if (record.overtimeHours !== undefined) {
    record.overtimeHours = typeof record.overtimeHours === 'string' ? parseFloat(record.overtimeHours) : Number(record.overtimeHours);
  }
  if (record.foodingApplicable !== undefined) {
    record.foodingApplicable = typeof record.foodingApplicable === 'string' ? parseInt(record.foodingApplicable, 10) : Number(record.foodingApplicable);
  }

  if (targetUrl && targetUrl.startsWith('http')) {
    try {
      let ts = String(record.timestamp || '').trim();
      if (ts.startsWith("'")) {
        ts = ts.slice(1);
      }
      let hours = record.overtimeHours;
      if (typeof hours === 'string') {
        if (hours.startsWith("'")) {
          hours = hours.slice(1);
        }
        hours = parseFloat(hours);
      } else {
        hours = Number(hours);
      }
      if (isNaN(hours)) {
        hours = 0;
      }

      const formattedRecord = {
        ...record,
        rowIndex: actualRowIndex,
        timestamp: ts,
        overtimeHours: hours,
        foodingApplicable: typeof record.foodingApplicable === 'string' ? parseInt(record.foodingApplicable, 10) : Number(record.foodingApplicable || 0)
      };

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'follow',
        body: JSON.stringify({ action: 'update', record: formattedRecord })
      });
      
      if (!response.ok) {
        throw new Error(`Apps Script update returned status ${response.status}`);
      }
      
      const textResponse = await response.text();
      let result;
      try {
        result = JSON.parse(textResponse);
      } catch (parseErr) {
        throw new Error(`Apps Script did not return JSON response. Content starts with: ${textResponse.substring(0, 150)}`);
      }

      if (result.error) {
        throw new Error(result.error);
      }
      
      invalidateSheetCache();
      res.json({ success: true });
    } catch (err: any) {
      console.error('Backend sheets/update failed:', err.message);
      res.status(502).json({ error: `Failed to update Google Spreadsheet: ${err.message}` });
    }
  } else {
    // Handle on server-side simulated DB
    const db = getLocalDb();
    db.records = db.records.map((r: any) => r.rowIndex === rawRowIndex ? { ...r, ...record, rowIndex: rawRowIndex } : r);
    saveLocalDb(db);
    invalidateSheetCache();
    res.json({ success: true });
  }
});

// 7. Delete Record
app.post('/api/sheets/delete', async (req, res) => {
  const { rowIndex: rawRowIndex, isArchive: reqIsArchive, targetUrl: reqTargetUrl, originalRowIndex } = req.body;
  const rowIndex = typeof rawRowIndex === 'string' ? parseInt(rawRowIndex, 10) : Number(rawRowIndex);
  if (isNaN(rowIndex)) {
    res.status(400).json({ error: 'Missing or invalid rowIndex parameter' });
    return;
  }

  const isArchive = !!reqIsArchive || rowIndex >= 1000000;
  const targetUrl = reqTargetUrl || (isArchive ? getArchiveAppsScriptUrl() : getActiveAppsScriptUrl()) || getActiveAppsScriptUrl();
  const actualRowIndex = originalRowIndex || (isArchive && rowIndex >= 1000000 ? rowIndex - 1000000 : rowIndex);

  if (targetUrl && targetUrl.startsWith('http')) {
    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'follow',
        body: JSON.stringify({ action: 'delete', rowIndex: actualRowIndex })
      });
      
      if (!response.ok) {
        throw new Error(`Apps Script delete returned status ${response.status}`);
      }
      
      const textResponse = await response.text();
      let result;
      try {
        result = JSON.parse(textResponse);
      } catch (parseErr) {
        throw new Error(`Apps Script did not return JSON response. Content starts with: ${textResponse.substring(0, 150)}`);
      }

      if (result.error) {
        throw new Error(result.error);
      }
      
      invalidateSheetCache();
      res.json({ success: true });
    } catch (err: any) {
      console.error('Backend sheets/delete failed:', err.message);
      res.status(502).json({ error: `Failed to delete from Google Spreadsheet: ${err.message}` });
    }
  } else {
    // Handle on server-side simulated DB
    const db = getLocalDb();
    db.records = db.records.filter((r: any) => r.rowIndex !== rowIndex);
    saveLocalDb(db);
    invalidateSheetCache();
    res.json({ success: true });
  }
});

app.post('/api/upload', async (req, res) => {
  const { file, filename, mimeType } = req.body;
  if (!file) {
    res.status(400).json({ error: 'Missing file content' });
    return;
  }

  const url = getActiveAppsScriptUrl();
  const isDefaultUrl = !url || url === 'https://script.google.com/macros/s/AKfycbzZVgM9VFd56dm4xSr7QYQ2ms-_mtcgFKJi2YdIotgtDuVUkjHNel5JxeZ8IqauTHiIgw/exec';

  if (url && url.startsWith('http')) {
    try {
      // Send base64 to Google Apps Script
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'follow',
        body: JSON.stringify({
          action: 'uploadFile',
          file,
          filename: filename || 'approval_for_ot.pdf',
          mimeType: mimeType || 'application/pdf'
        })
      });

      if (!response.ok) {
        throw new Error(`Apps Script responded with status ${response.status}`);
      }

      const textResponse = await response.text();
      let result: any;
      try {
        result = JSON.parse(textResponse);
      } catch (parseErr) {
        // Fallback: If Apps Script returned a raw URL string instead of JSON
        if (textResponse.trim().startsWith('http')) {
          result = { success: true, url: textResponse.trim() };
        } else {
          throw new Error(`Apps Script did not return JSON response. Content starts with: ${textResponse.substring(0, 150)}`);
        }
      }

      const resultUrl = result.url || result.fileUrl || result.link || result.downloadUrl;

      if (result.error || !resultUrl) {
        throw new Error(result.error || 'No file URL returned from Google Apps Script');
      }

      res.json({ success: true, url: resultUrl });
    } catch (err: any) {
      console.error('Apps Script file upload failed:', err.message);
      
      // If there is an active Apps Script URL, DO NOT silently fall back to local folder.
      // Doing so causes confusion because files are not uploaded to Google Drive.
      res.status(502).json({ 
        error: `Google Drive Upload failed: ${err.message}.

⚠️ IMPORTANT GOOGLE DRIVE PERMISSION FIX ⚠️
The reason you are seeing this error is because Google Apps Script caches Web App scopes. Adding the Drive scope to 'appsscript.json' and running a test function only authorizes it for YOU in the Editor, NOT for the live Web App deployment URL itself!

To authorize Google Drive permissions for your Web App, please follow these exact steps:

Option A (Recommended - Keeps the SAME Web App URL):
1. In your Google Apps Script editor, click the blue "Deploy" button at the top-right and select "Manage deployments".
2. Click the Pencil icon (Edit) next to your active deployment.
3. Under the "Version" dropdown, you MUST select "New version" (do not keep the old version number!).
4. Click the blue "Deploy" button at the bottom-right.
5. This will trigger a popup titled "Authorization Required".
6. Click "Authorize Access", choose your Google account, click "Advanced" (at the bottom), click "Go to [Project Name] (unsafe)", and then click "Allow".
7. Click "Done". The permissions are now updated and active immediately on your existing URL!

Option B (Creates a NEW Web App URL):
1. Click "Deploy" > "New deployment".
2. Select type "Web app". Set:
   - Execute as: "Me"
   - Who has access: "Anyone"
3. Click "Deploy" and authorize the popup permissions.
4. Copy the NEW Web App URL and paste it into this app's database settings!`
      });
      return;
    }
  } else {
    // Save locally
    try {
      const uploadDir = path.join(process.cwd(), 'public', 'uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      const safeFilename = `${Date.now()}_${(filename || 'approval.pdf').replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const filePath = path.join(uploadDir, safeFilename);
      const buffer = Buffer.from(file, 'base64');
      fs.writeFileSync(filePath, buffer);
      
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const baseUrl = `${protocol}://${host}`;
      const absoluteUrl = `${baseUrl}/uploads/${safeFilename}`;
      
      res.json({ success: true, url: absoluteUrl, isLocalFallback: true });
    } catch (localErr: any) {
      res.status(500).json({ error: `Failed to save file: ${localErr.message}` });
    }
  }
});

// 8. Executive Report Sync to Google Sheet
app.post('/api/sheets/report-sync', async (req, res) => {
  const payload = req.body;
  const activeUrl = getActiveAppsScriptUrl();

  if (activeUrl && activeUrl.startsWith('http')) {
    try {
      const response = await fetch(activeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'follow',
        body: JSON.stringify({
          action: 'syncReport',
          ...payload
        })
      });

      if (!response.ok) {
        throw new Error(`Apps Script responded with status ${response.status}`);
      }

      const data = await response.json();
      res.json({ success: true, ...data });
    } catch (err: any) {
      console.warn('Report sync to Google Apps Script failed, recording locally:', err.message);
      // Fallback: append to local json db
      try {
        const dbDir = path.join(process.cwd(), 'data');
        if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
        const reportFile = path.join(dbDir, 'ceo_cfo_reports.json');
        let reports: any[] = [];
        if (fs.existsSync(reportFile)) {
          reports = JSON.parse(fs.readFileSync(reportFile, 'utf-8'));
        }
        reports.push({ ...payload, syncedAt: new Date().toISOString() });
        fs.writeFileSync(reportFile, JSON.stringify(reports, null, 2));
        res.json({ success: true, message: 'Saved report locally.', fallback: true });
      } catch (localErr: any) {
        res.status(500).json({ error: localErr.message });
      }
    }
  } else {
    try {
      const dbDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
      const reportFile = path.join(dbDir, 'ceo_cfo_reports.json');
      let reports: any[] = [];
      if (fs.existsSync(reportFile)) {
        reports = JSON.parse(fs.readFileSync(reportFile, 'utf-8'));
      }
      reports.push({ ...payload, syncedAt: new Date().toISOString() });
      fs.writeFileSync(reportFile, JSON.stringify(reports, null, 2));
      res.json({ success: true, message: 'Saved report locally in data/ceo_cfo_reports.json.', fallback: true });
    } catch (localErr: any) {
      res.status(500).json({ error: localErr.message });
    }
  }
});

// --- AI CHAT AGENT SERVICE (LAZY INITIALIZED) ---
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is missing. Please set it in Settings > Secrets.");
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

app.post('/api/ai/chat', async (req, res) => {
  const { messages, currentData } = req.body;
  if (!Array.isArray(messages)) {
    res.status(400).json({ error: 'Missing or invalid messages parameter' });
    return;
  }

  try {
    const ai = getGeminiClient();
    
    // Format active data for context
    let summaryContext = "No active dataset provided.";
    if (currentData) {
      if (currentData.isCompact) {
        summaryContext = JSON.stringify({
          totalRecordsCount: currentData.totalRecordsCount,
          totalOTHours: currentData.totalOTHours,
          totalFoodingCount: currentData.totalFoodingCount,
          departmentSummary: currentData.departmentSummary,
          topOvertimeEarners: currentData.topOvertimeEarners,
          employeesMaster: currentData.employees,
          recentOvertimeLogsSample: currentData.recentRecords
        });
      } else {
        const employeesInfo = currentData.employees ? currentData.employees.map((e: any) => ({
          code: e.employeeCode,
          name: e.employeeName,
          dept: e.department,
          desg: e.designation,
          totalSalary: e.totalSalary
        })) : [];

        const rawRecords = currentData.records || [];
        const recordsSample = rawRecords.slice(-150).map((r: any) => ({
          date: r.date,
          name: r.employeeName,
          code: r.employeeCode,
          hours: r.overtimeHours,
          fooding: r.foodingApplicable > 0 ? "₹50 Flat" : "None",
          enteredBy: r.enteredBy,
          remarks: r.remarks
        }));

        summaryContext = JSON.stringify({
          totalRecordsInDatabase: rawRecords.length,
          employeesMaster: employeesInfo,
          recentOvertimeLogsSample: recordsSample
        });
      }
    }
    
    const systemInstruction = `You are 'Overtime Tracker AI', an expert enterprise data analyst and assistant for this Employee Overtime ERP system.
Your job is to assist users in analyzing employee overtime records, payroll, allowances, departments, and designations.
You have full real-time access to the system database metrics summary:

--- DATABASE SNAPSHOT & AGGREGATES ---
${summaryContext}

--- SYSTEM INTEGRATION ---
The system is synced with a live Google Sheet. Users can edit records, add new ones, and view automated calculations.

--- GUIDELINES ---
1. Provide accurate, professional, helpful, and concise analysis of the data. Always support deep analysis of overtime versus salary percentages when asked (e.g., individual Overtime % of Salary = Estimated OT Cost / Total CTC * 100; company-wide Extra OT Overhead = Total Overtime Costs / Total CTC Budget * 100).
2. When answering user questions, use markdown format in the 'reply' field (bolding, bullet points, or markdown tables as needed). Keep replies friendly, clean, and professional.
3. If the user asks for charts, comparisons, or summaries that would benefit from a graphical view, populate the 'chart' object with:
   - 'type': one of "bar", "line", "pie", "area"
   - 'title': descriptive title (e.g., "Overtime Hours by Department")
   - 'data': array of { "name": string, "value": number } representing the items
4. If they ask to "generate a report", "create report", or prompt for a structured summary, populate the 'report' object with:
   - 'title': e.g., "Monthly Overtime Audit & Cost Report"
   - 'metrics': array of { "label": string, "value": string } (e.g. Total Overtime Cost, Average Hours, Active Workers, Extra Budget Overhead %)
   - 'summary': high-level business findings or recommendations regarding salary budget impact and high-overtime employees.
5. If no chart or report is explicitly requested or naturally useful, set those fields to null.
6. Speak directly to the active data. Never make up employees or records outside of the active database.
7. Current time: ${new Date().toLocaleDateString('en-IN')} (India timezone is active).
8. Return a JSON response matching the required schema. Do NOT wrap the JSON in markdown blocks like \`\`\`json.`;

    const contents: any[] = [];
    for (const msg of messages) {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: { 
              type: Type.STRING, 
              description: "Main conversational text response in clear markdown format." 
            },
            chart: {
              type: Type.OBJECT,
              properties: {
                type: { 
                  type: Type.STRING, 
                  description: "Must be 'bar', 'line', 'pie', 'area' or null if no chart is generated." 
                },
                title: { 
                  type: Type.STRING, 
                  description: "Title of the chart." 
                },
                data: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING, description: "Name of group/label (e.g. IT Department, Rajesh Sharma)." },
                      value: { type: Type.NUMBER, description: "Numeric value." }
                    },
                    required: ["name", "value"]
                  }
                }
              }
            },
            report: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: "Title of the report summary." },
                metrics: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING, description: "Label like 'Total Cost' or 'Active Employees'." },
                      value: { type: Type.STRING, description: "Value like '₹24,500' or '12 workers'." }
                    },
                    required: ["label", "value"]
                  }
                },
                summary: { type: Type.STRING, description: "Paragraph summarising the business insights." }
              }
            }
          },
          required: ["reply"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response from AI model");
    }

    res.json(JSON.parse(text.trim()));
  } catch (err: any) {
    console.error('AI Chat Error:', err);
    res.status(500).json({ error: err.message || 'Error processing AI chat request.' });
  }
});

// --- VITE MIDDLEWARE OR STATIC SERVER ENTRYPOINT ---
async function start() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ERP Backend] Secure server active on http://localhost:${PORT}`);
  });
}

start();
