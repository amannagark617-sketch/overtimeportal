import React, { useState, useEffect, useMemo, useDeferredValue, useRef } from 'react';
import { 
  fetchSpreadsheetData, 
  appendOvertimeRecords, 
  updateOvertimeRecord, 
  deleteOvertimeRecord,
  fetchAppsScriptStatus,
  saveAppsScriptUrl,
  resetAppsScriptUrl,
  SpreadsheetData 
} from './lib/sheets';
import { 
  Employee, 
  OvertimeRecord, 
  AppUser, 
  DashboardFilters 
} from './types';
import { 
  calculateOTCost, 
  calculateFooding, 
  isValidOTHours, 
  getIndianTimestamp,
  formatCurrency,
  formatDateToDDMMYYYY,
  formatIndianTimestamp,
  parseDateString
} from './utils/calculations';
import { 
  generatePDFReport, 
  generateExcelReport,
  generateOvertimePDFReport,
  generateOvertimeExcelReport,
  formatToProperTitleCase,
  formatEmployeeCode
} from './utils/reportGenerator';
import { DashboardCharts } from './components/DashboardCharts';
import { AnalyticsTabs } from './components/AnalyticsTabs';
import { EmployeeHistoryModal } from './components/EmployeeHistoryModal';
import { AIChatAssistant } from './components/AIChatAssistant';
import { SearchableDropdown } from './components/SearchableDropdown';
import { BiometricSyncPanel } from './components/BiometricSyncPanel';
import { SalaryEstimatorCard } from './components/SalaryEstimatorCard';

import { 
  LogOut, 
  LogIn,
  Search, 
  Plus, 
  Trash2, 
  Edit3, 
  Save, 
  CheckCircle2, 
  AlertTriangle, 
  Download, 
  SlidersHorizontal, 
  Users, 
  BarChart3, 
  Clock, 
  IndianRupee, 
  Calendar, 
  Coffee, 
  FileSpreadsheet, 
  Eye, 
  UserCheck, 
  RefreshCw,
  TrendingUp,
  Sliders,
  FilterX,
  FileText,
  Settings,
  Database,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react';

// Helper to get current month's start and end date (in local timezone)
function getCurrentMonthDateRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  
  const formatDate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  
  return {
    start: formatDate(firstDay),
    end: formatDate(lastDay),
  };
}

// Pre-process spreadsheet data to enrich records with numeric timestamps and fast calculation helpers
function processSheetData(data: SpreadsheetData): SpreadsheetData {
  if (!data?.records) return data;
  const empMap = new Map<string, Employee>();
  if (data.employees) {
    for (const e of data.employees) {
      if (e.employeeCode) empMap.set(e.employeeCode, e);
    }
  }

  const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const processedRecords = data.records.map(r => {
    const parsedDate = parseDateString(r.date);
    const parsedTimestamp = isNaN(parsedDate.getTime()) ? 0 : parsedDate.getTime();
    
    // Total Salary
    const emp = empMap.get(r.employeeCode);
    const totalSalary = (r.totalSalary !== undefined && r.totalSalary > 0) 
      ? r.totalSalary 
      : (emp?.totalSalary || r.basic || emp?.basic || 0);

    const year = parsedDate.getFullYear() || 2026;
    const month = parsedDate.getMonth();
    const validMonth = (month >= 0 && month <= 11);

    const daysInMonth = validMonth ? new Date(year, month + 1, 0).getDate() : 30;
    const hourlyRate = totalSalary > 0 ? (totalSalary / daysInMonth / 8) : 0;
    const precomputedOTCost = Math.round(hourlyRate * (r.overtimeHours || 0));

    const monthKey = validMonth ? `${SHORT_MONTHS[month]}-${String(year).slice(-2)}` : 'Unknown';
    const longMonthKey = validMonth ? `${LONG_MONTHS[month]} ${year}` : 'Unknown';
    const monthSortTimestamp = validMonth ? new Date(year, month, 1).getTime() : 0;
    const dayName = (parsedDate.getDay() >= 0 && parsedDate.getDay() <= 6) ? DAYS_OF_WEEK[parsedDate.getDay()] : 'Sunday';

    return {
      ...r,
      totalSalary,
      parsedTimestamp,
      precomputedOTCost,
      monthKey,
      longMonthKey,
      monthSortTimestamp,
      dayName
    };
  });

  return {
    ...data,
    records: processedRecords
  };
}

export default function App() {
  // --- Auth & Session States ---
  const [appUser, setAppUser] = useState<AppUser | null>(() => {
    const saved = localStorage.getItem('employee_ot_app_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [loginId, setLoginId] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  // --- Google Apps Script URL Sync Config ---
  const [appsScriptUrl, setAppsScriptUrlState] = useState('');
  const [isConfiguringUrl, setIsConfiguringUrl] = useState(false);
  const [tempUrlInput, setTempUrlInput] = useState('');
  const [archiveUrlInput, setArchiveUrlInput] = useState('');
  const [isArchiveConfigured, setIsArchiveConfigured] = useState(false);

  // --- Sheets Data Sync States ---
  const [isLoadingSheets, setIsLoadingSheets] = useState(false);
  const [sheetsError, setSheetsError] = useState<string | null>(null);
  const [sheetData, setSheetData] = useState<SpreadsheetData | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string>('Never');

  // --- Bulk Overtime Entry States ---
  const [entryMode, setEntryMode] = useState<'single' | 'bulk'>('single');
  const [bulkSelectedDept, setBulkSelectedDept] = useState<string>('');
  const [bulkSelectedEmployees, setBulkSelectedEmployees] = useState<string[]>([]);
  const [bulkSearchQuery, setBulkSearchQuery] = useState<string>('');
  const [keepSticky, setKeepSticky] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [otDate, setOtDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [otHoursStr, setOtHoursStr] = useState('1');
  const [remarks, setRemarks] = useState('');
  const [reasonForOvertime, setReasonForOvertime] = useState('');
  const [batchApprovalFile, setBatchApprovalFile] = useState<File | null>(null);
  const [batchApprovalUrl, setBatchApprovalUrl] = useState('');
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [bulkList, setBulkList] = useState<Omit<OvertimeRecord, 'rowIndex' | 'timestamp' | 'enteredBy'>[]>([]);
  const [bulkSaveError, setBulkSaveError] = useState<string | null>(null);

  // --- Admin Dashboard Filters ---
  const [filters, setFilters] = useState<DashboardFilters>(() => {
    const range = getCurrentMonthDateRange();
    return {
      startDate: range.start,
      endDate: range.end,
      department: '',
      employeeCode: '',
      payroll: '',
      designation: '',
      enteredBy: '',
      overtimeHoursOperator: 'all',
      overtimeHoursValue: '',
      remarks: '',
      reasonForOvertime: '',
    };
  });

  // --- UI Utilities States ---
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [drillDownCode, setDrillDownCode] = useState<string | null>(null);
  
  // --- Admin Row Edit States ---
  const [editingRecord, setEditingRecord] = useState<OvertimeRecord | null>(null);
  const [editHoursStr, setEditHoursStr] = useState('');
  const [editRemarks, setEditRemarks] = useState('');
  const [editReasonForOvertime, setEditReasonForOvertime] = useState('');
  const [editApprovalForOT, setEditApprovalForOT] = useState('');
  const [editDate, setEditDate] = useState('');
  const [operatorSearch, setOperatorSearch] = useState('');
  const [operatorStartDate, setOperatorStartDate] = useState(() => getCurrentMonthDateRange().start);
  const [operatorEndDate, setOperatorEndDate] = useState(() => getCurrentMonthDateRange().end);
  const [operatorDept, setOperatorDept] = useState('');
  const [operatorHoursOperator, setOperatorHoursOperator] = useState<'all' | 'gt' | 'lt' | 'eq'>('all');
  const [operatorHoursValue, setOperatorHoursValue] = useState('');
  const [operatorPayroll, setOperatorPayroll] = useState('');
  const [showOperatorFilters, setShowOperatorFilters] = useState(false);

  // --- Overtime Logs Table Pagination States ---
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number | 'all'>(25);

  // Reset pagination to page 1 whenever filters or search criteria change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters, operatorSearch, operatorStartDate, operatorEndDate, operatorDept, operatorHoursOperator, operatorHoursValue, operatorPayroll]);

  // Show Toast Toast Notification helper
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  // --- Initial database and sync status fetch ---
  useEffect(() => {
    const initStatusAndFetch = async () => {
      try {
        const status = await fetchAppsScriptStatus();
        setAppsScriptUrlState(status.isConfigured ? 'configured' : '');
        setTempUrlInput(status.isConfigured ? status.activeUrl : '');
        setArchiveUrlInput(status.archiveUrl || '');
        setIsArchiveConfigured(!!status.isArchiveConfigured);
      } catch (e) {
        console.error('Error fetching backend configuration status', e);
      }
      await syncData();
    };
    initStatusAndFetch();
  }, []);

  // --- Fetch latest values from the spreadsheet ---
  const syncData = async (isSilent = false) => {
    if (!isSilent) {
      setIsLoadingSheets(true);
      setSheetsError(null);
    }
    try {
      const data = await fetchSpreadsheetData();
      setSheetData(prevData => {
        if (prevData && prevData.records && data.records && prevData.records.length === data.records.length) {
          const firstOld = prevData.records[0];
          const firstNew = data.records[0];
          const lastOld = prevData.records[prevData.records.length - 1];
          const lastNew = data.records[data.records.length - 1];
          if (
            firstOld && firstNew && lastOld && lastNew &&
            String(firstOld.rowIndex) === String(firstNew.rowIndex) &&
            String(firstOld.timestamp) === String(firstNew.timestamp) &&
            String(lastOld.rowIndex) === String(lastNew.rowIndex) &&
            String(lastOld.timestamp) === String(lastNew.timestamp) &&
            prevData.employees.length === data.employees.length
          ) {
            return prevData;
          }
        }
        return processSheetData(data);
      });
      setLastSyncTime(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
    } catch (err: any) {
      console.error(err);
      if (!isSilent) {
        setSheetsError(err.message || 'Error connecting to database');
        showToast('Database synchronization failed', 'error');
      }
    } finally {
      if (!isSilent) {
        setIsLoadingSheets(false);
      }
    }
  };

  // --- Automatic background sync every 10 seconds ---
  useEffect(() => {
    const interval = setInterval(() => {
      // Fetch silently without showing blocking loader
      syncData(true);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // --- Save New Apps Script URLs (Active & Archive Data Sources) ---
  const handleSaveAppsScriptUrl = async (url: string, archiveUrl: string = '') => {
    setIsLoadingSheets(true);
    setSheetsError(null);
    try {
      await saveAppsScriptUrl(url, archiveUrl);
      const status = await fetchAppsScriptStatus();
      setAppsScriptUrlState(status.isConfigured ? 'configured' : '');
      setTempUrlInput(status.isConfigured ? status.activeUrl : '');
      setArchiveUrlInput(status.archiveUrl || '');
      setIsArchiveConfigured(!!status.isArchiveConfigured);
      const data = await fetchSpreadsheetData();
      setSheetData(processSheetData(data));
      setLastSyncTime(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
      showToast(
        archiveUrl && archiveUrl.trim() !== ''
          ? 'Dual Spreadsheet Live Sync Active! Active & Archive data sources connected.'
          : 'Live connection successfully updated!',
        'success'
      );
    } catch (err: any) {
      console.error(err);
      setSheetsError(err.message || 'Failed to sync with the provided Apps Script URLs.');
      showToast('Validation failed. Check your Web App URLs.', 'error');
    } finally {
      setIsLoadingSheets(false);
    }
  };

  // --- Authenticate operator/admin credentials against ID Pass sheet ---
  const handleAppLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    if (!sheetData?.users) {
      setLoginError('Spreadsheet credentials are not loaded yet. Please try again.');
      return;
    }

    const matchedUser = sheetData.users.find(
      u => u.id.toLowerCase() === loginId.toLowerCase().trim() && u.passwordHash === loginPassword
    );

    if (!matchedUser) {
      setLoginError('Invalid Username ID or Password. Please try again.');
      showToast('Credential verification failed', 'error');
      return;
    }

    const sessionUser: AppUser = {
      id: matchedUser.id,
      type: matchedUser.type,
    };

    setAppUser(sessionUser);
    localStorage.setItem('employee_ot_app_user', JSON.stringify(sessionUser));
    showToast(`Logged in successfully as ${matchedUser.id}!`, 'success');
  };

  // --- Logouts ---
  const handleLogout = async () => {
    setAppUser(null);
    localStorage.removeItem('employee_ot_app_user');
    setLoginId('');
    setLoginPassword('');
    setBulkList([]);
    setSelectedEmployee(null);
    setSearchQuery('');
    setRemarks('');
    showToast('Signed out of session successfully', 'info');
  };

  const handleFullReset = async () => {
    try {
      await resetAppsScriptUrl();
      setAppsScriptUrlState('');
      setTempUrlInput('');
      setAppUser(null);
      localStorage.removeItem('employee_ot_app_user');
      showToast('Disconnected from Google Sheet database.', 'info');
      await syncData();
    } catch (err: any) {
      showToast('Reset failed: ' + err.message, 'error');
    }
  };

  // --- Flexible Multi-Field Employee Search Helper ---
  const matchEmployee = (emp: Employee, queryStr: string): boolean => {
    if (!queryStr || !queryStr.trim()) return true;
    const q = queryStr.toLowerCase().trim();
    if (!q) return true;

    const name = String(emp.employeeName || '').toLowerCase();
    const code = String(emp.employeeCode || '').toLowerCase();
    const designation = String(emp.designation || '').toLowerCase();
    const department = String(emp.department || '').toLowerCase();
    const payroll = String(emp.payroll || '').toLowerCase();

    // 1. Direct substring match
    if (
      name.includes(q) ||
      code.includes(q) ||
      designation.includes(q) ||
      department.includes(q) ||
      payroll.includes(q)
    ) {
      return true;
    }

    // 2. Alphanumeric match (ignoring dashes/spaces/punctuation e.g. "EMP001" vs "EMP-001")
    const cleanQ = q.replace(/[^a-z0-9]/g, '');
    if (cleanQ.length > 0) {
      const cleanName = name.replace(/[^a-z0-9]/g, '');
      const cleanCode = code.replace(/[^a-z0-9]/g, '');
      if (cleanName.includes(cleanQ) || cleanCode.includes(cleanQ)) {
        return true;
      }
    }

    // 3. Multi-word search terms (e.g., "John Production")
    const terms = q.split(/\s+/).filter(Boolean);
    if (terms.length > 1) {
      const fullFieldText = `${name} ${code} ${designation} ${department} ${payroll}`;
      return terms.every(term => fullFieldText.includes(term));
    }

    return false;
  };

  // --- Employee Search Autocomplete ---
  const filteredEmployeesForSearch = useMemo(() => {
    if (!sheetData?.employees || searchQuery.trim() === '') return [];
    const filtered = sheetData.employees.filter(e => matchEmployee(e, searchQuery));
    return [...filtered]
      .sort((a, b) => String(a.employeeName || '').localeCompare(String(b.employeeName || ''), undefined, { sensitivity: 'base' }))
      .slice(0, 10); // return top 10 results
  }, [sheetData, searchQuery]);

  // --- Unique Departments for Bulk Select Mode ---
  const uniqueDepts = useMemo(() => {
    if (!sheetData?.employees) return [];
    const depts = new Set<string>();
    sheetData.employees.forEach(e => {
      if (e.department) depts.add(e.department);
    });
    return Array.from(depts).sort();
  }, [sheetData]);

  // --- Filtered Employees Checklist for Bulk Select Mode ---
  const filteredEmployeesForBulk = useMemo(() => {
    if (!sheetData?.employees) return [];
    const hasSearchQuery = bulkSearchQuery.trim() !== '';

    const filtered = sheetData.employees.filter(emp => {
      // If user typed a search query, search across all employees
      if (hasSearchQuery) {
        if (!matchEmployee(emp, bulkSearchQuery)) return false;
      }
      // If department filter is selected, filter by department
      if (bulkSelectedDept && emp.department !== bulkSelectedDept) {
        return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => 
      String(a.employeeName || '').localeCompare(String(b.employeeName || ''), undefined, { sensitivity: 'base' })
    );
  }, [sheetData, bulkSelectedDept, bulkSearchQuery]);

  // --- Add entry to bulk overtime list ---
  const handleAddEntryToBulkList = () => {
    if (!selectedEmployee) {
      showToast('Please search and select an employee first', 'error');
      return;
    }

    const otHours = parseFloat(otHoursStr);
    if (!isValidOTHours(otHours)) {
      showToast('Overtime hours must be in increments of 0.5 (e.g. 1, 1.5, 2, 4.5)', 'error');
      return;
    }

    if (!remarks.trim()) {
      showToast('OPF Number is mandatory', 'error');
      return;
    }

    if (!reasonForOvertime.trim()) {
      showToast('Reason for Overtime is mandatory', 'error');
      return;
    }

    // Prevent duplicate Employee Code + Date in current bulk list OR database!
    const isDuplicateInBulk = bulkList.some(
      item => item.employeeCode === selectedEmployee.employeeCode && item.date === otDate
    );

    const isDuplicateInDb = sheetData?.records.some(
      rec => rec.employeeCode === selectedEmployee.employeeCode && rec.date === otDate
    );

    if (isDuplicateInBulk || isDuplicateInDb) {
      showToast(`Overtime entry already exists for Employee Code ${selectedEmployee.employeeCode} on ${formatDateToDDMMYYYY(otDate)}`, 'error');
      return;
    }

    const foodingApplicable = calculateFooding(otHours);

    const newItem = {
      employeeCode: selectedEmployee.employeeCode,
      employeeName: selectedEmployee.employeeName,
      designation: selectedEmployee.designation,
      department: selectedEmployee.department,
      payroll: selectedEmployee.payroll,
      date: otDate,
      overtimeHours: otHours,
      foodingApplicable,
      remarks: remarks.trim().toUpperCase(),
      reasonForOvertime: reasonForOvertime.trim(),
      approvalForOT: '',
      basic: selectedEmployee.basic,
      hra: selectedEmployee.hra,
      splAllowance: selectedEmployee.splAllowance,
      conveyance: selectedEmployee.conveyance,
      lta: selectedEmployee.lta,
      otherAllowance: selectedEmployee.otherAllowance,
      bonus: selectedEmployee.bonus,
      totalSalary: selectedEmployee.totalSalary,
    };

    setBulkList([...bulkList, newItem]);
    
    if (!keepSticky) {
      setRemarks('');
      setReasonForOvertime('');
    }
    
    setSelectedEmployee(null);
    setSearchQuery('');
    setBulkSaveError(null);
    showToast(`Added ${selectedEmployee.employeeName} to list`, 'success');
  };

  // --- Add multiple selected employees to bulk overtime list ---
  const handleAddMultipleToBulkList = () => {
    if (bulkSelectedEmployees.length === 0) {
      showToast('Please select at least one employee', 'error');
      return;
    }

    const otHours = parseFloat(otHoursStr);
    if (!isValidOTHours(otHours)) {
      showToast('Overtime hours must be in increments of 0.5 (e.g. 1, 1.5, 2, 4.5)', 'error');
      return;
    }

    if (!remarks.trim()) {
      showToast('OPF Number is mandatory', 'error');
      return;
    }

    if (!reasonForOvertime.trim()) {
      showToast('Reason for Overtime is mandatory', 'error');
      return;
    }

    const addedList: typeof bulkList = [];
    let duplicatesCount = 0;

    for (const code of bulkSelectedEmployees) {
      const emp = sheetData?.employees?.find(e => e.employeeCode === code);
      if (!emp) continue;

      // Prevent duplicate Employee Code + Date in current bulk list OR database!
      const isDuplicateInBulk = bulkList.some(
        item => item.employeeCode === emp.employeeCode && item.date === otDate
      ) || addedList.some(
        item => item.employeeCode === emp.employeeCode && item.date === otDate
      );

      const isDuplicateInDb = sheetData?.records.some(
        rec => rec.employeeCode === emp.employeeCode && rec.date === otDate
      );

      if (isDuplicateInBulk || isDuplicateInDb) {
        duplicatesCount++;
        continue;
      }

      const foodingApplicable = calculateFooding(otHours);

      addedList.push({
        employeeCode: emp.employeeCode,
        employeeName: emp.employeeName,
        designation: emp.designation,
        department: emp.department,
        payroll: emp.payroll,
        date: otDate,
        overtimeHours: otHours,
        foodingApplicable,
        remarks: remarks.trim().toUpperCase(),
        reasonForOvertime: reasonForOvertime.trim(),
        approvalForOT: '',
        basic: emp.basic,
        hra: emp.hra,
        splAllowance: emp.splAllowance,
        conveyance: emp.conveyance,
        lta: emp.lta,
        otherAllowance: emp.otherAllowance,
        bonus: emp.bonus,
        totalSalary: emp.totalSalary,
      });
    }

    if (addedList.length > 0) {
      setBulkList([...bulkList, ...addedList]);
      setBulkSelectedEmployees([]);
      setBulkSaveError(null);
      
      if (!keepSticky) {
        setRemarks('');
        setReasonForOvertime('');
      }
      
      let msg = `Added ${addedList.length} employee(s) to queue.`;
      if (duplicatesCount > 0) {
        msg += ` (${duplicatesCount} skipped as duplicates)`;
      }
      showToast(msg, 'success');
    } else {
      showToast('All selected employees already have overtime entries queued or recorded for this date!', 'error');
    }
  };

  // --- Import suggested overtime entries fetched from the biometric punch device into the bulk queue ---
  const handleImportBiometricEntries = (items: { employeeCode: string; otHours: number; date: string }[]) => {
    if (items.length === 0) return;

    if (!remarks.trim()) {
      showToast('Enter the OPF Number above first (it will be applied to all imported rows)', 'error');
      return;
    }
    if (!reasonForOvertime.trim()) {
      showToast('Select a Reason for Overtime above first (it will be applied to all imported rows)', 'error');
      return;
    }

    const addedList: typeof bulkList = [];
    let skippedCount = 0;

    for (const item of items) {
      const emp = sheetData?.employees?.find(e => e.employeeCode === item.employeeCode);
      if (!emp) { skippedCount++; continue; }

      const isDuplicateInBulk = bulkList.some(
        b => b.employeeCode === emp.employeeCode && b.date === item.date
      ) || addedList.some(b => b.employeeCode === emp.employeeCode && b.date === item.date);
      const isDuplicateInDb = sheetData?.records.some(
        r => r.employeeCode === emp.employeeCode && r.date === item.date
      );
      if (isDuplicateInBulk || isDuplicateInDb) { skippedCount++; continue; }

      addedList.push({
        employeeCode: emp.employeeCode,
        employeeName: emp.employeeName,
        designation: emp.designation,
        department: emp.department,
        payroll: emp.payroll,
        date: item.date,
        overtimeHours: item.otHours,
        foodingApplicable: calculateFooding(item.otHours),
        remarks: remarks.trim().toUpperCase(),
        reasonForOvertime: reasonForOvertime.trim(),
        approvalForOT: '',
        basic: emp.basic,
        hra: emp.hra,
        splAllowance: emp.splAllowance,
        conveyance: emp.conveyance,
        lta: emp.lta,
        otherAllowance: emp.otherAllowance,
        bonus: emp.bonus,
        totalSalary: emp.totalSalary,
      });
    }

    if (addedList.length > 0) {
      setEntryMode('bulk');
      setBulkList(prev => [...prev, ...addedList]);
      setBulkSaveError(null);
      let msg = `Imported ${addedList.length} entr${addedList.length === 1 ? 'y' : 'ies'} from biometric device.`;
      if (skippedCount > 0) msg += ` (${skippedCount} skipped as duplicate/unmatched)`;
      showToast(msg, 'success');
    } else {
      showToast('Nothing imported — all rows were duplicates or had an unmatched employee code', 'error');
    }
  };

  // --- Remove entry from bulk list before saving ---
  const handleRemoveFromBulkList = (index: number) => {
    const updated = [...bulkList];
    updated.splice(index, 1);
    setBulkList(updated);
    setBulkSaveError(null);
    showToast('Entry removed from list', 'info');
  };

  // --- Update entry inside bulk list dynamically ---
  const handleUpdateBulkListItem = (
    index: number,
    updatedFields: Partial<Omit<OvertimeRecord, 'rowIndex' | 'timestamp' | 'enteredBy'>>
  ) => {
    const updated = [...bulkList];
    const original = updated[index];
    const nextItem = { ...original, ...updatedFields };

    if (updatedFields.date !== undefined && updatedFields.date !== original.date) {
      const isDuplicateInBulk = updated.some(
        (item, idx) => idx !== index && item.employeeCode === original.employeeCode && item.date === updatedFields.date
      );
      const isDuplicateInDb = sheetData?.records.some(
        rec => rec.employeeCode === original.employeeCode && rec.date === updatedFields.date
      );
      if (isDuplicateInBulk || isDuplicateInDb) {
        showToast(`Cannot change date: Overtime entry already exists or is queued for ${original.employeeName} on ${formatDateToDDMMYYYY(updatedFields.date)}`, 'error');
        return;
      }
    }

    if (updatedFields.overtimeHours !== undefined) {
      nextItem.foodingApplicable = calculateFooding(updatedFields.overtimeHours);
    }

    updated[index] = nextItem;
    setBulkList(updated);
  };

  // --- Handle File Upload to Google Drive / API ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBatchApprovalFile(file);
    setIsUploadingFile(true);
    setBulkSaveError(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64String = (reader.result as string).split(',')[1];
        try {
          const res = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              file: base64String,
              filename: file.name,
              mimeType: file.type
            })
          });

          const result = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(result.error || `Upload failed with status ${res.status}`);
          }

          const returnedUrl = result.url || result.fileUrl || result.link;
          if (returnedUrl) {
            setBatchApprovalUrl(returnedUrl);
            if (result.warning) {
              showToast(result.warning, 'info');
            } else {
              showToast('Approval document uploaded successfully!', 'success');
            }
          } else {
            throw new Error(result.error || 'Invalid upload response from backend');
          }
        } catch (err: any) {
          console.error(err);
          showToast('File upload failed: ' + err.message, 'error');
        } finally {
          setIsUploadingFile(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      console.error(err);
      showToast('Failed to read file', 'error');
      setIsUploadingFile(false);
    }
  };

  const isSavingRef = useRef(false);

  // --- Save All bulk overtime records to Google Sheets ---
  const handleSaveAllBulkRecords = async () => {
    if (isSaving || isSavingRef.current) {
      return;
    }

    if (bulkList.length === 0) {
      showToast('Bulk list is empty. Add employees first.', 'error');
      return;
    }

    if (!batchApprovalUrl) {
      showToast('Please upload the Approval for OT file first', 'error');
      return;
    }

    // Validate each edited row in the queue
    for (let i = 0; i < bulkList.length; i++) {
      const item = bulkList[i];
      if (!item.date) {
        showToast(`Please enter a valid date for ${item.employeeName} (Row ${i + 1})`, 'error');
        return;
      }
      if (!item.remarks || !item.remarks.trim()) {
        showToast(`Please enter a valid OPF Number for ${item.employeeName} (Row ${i + 1})`, 'error');
        return;
      }
      if (!item.reasonForOvertime || !item.reasonForOvertime.trim()) {
        showToast(`Please select a Reason for Overtime for ${item.employeeName} (Row ${i + 1})`, 'error');
        return;
      }
      if (!isValidOTHours(item.overtimeHours)) {
        showToast(`Overtime hours for ${item.employeeName} (Row ${i + 1}) must be in increments of 0.5`, 'error');
        return;
      }
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setBulkSaveError(null);
    try {
      const timestamp = getIndianTimestamp();
      const recordsToSave = bulkList.map(item => ({
        ...item,
        timestamp,
        enteredBy: appUser?.id || 'Unknown',
        approvalForOT: batchApprovalUrl,
      }));

      await appendOvertimeRecords(recordsToSave);
      showToast('Successfully saved overtime logs with file attachment!', 'success');
      setBulkList([]);
      setBatchApprovalFile(null);
      setBatchApprovalUrl('');
      setBulkSaveError(null);
      await syncData();
    } catch (err: any) {
      console.error(err);
      const errMsg = err.message || 'Unknown error';
      setBulkSaveError(errMsg);
      showToast('Failed to save logs: ' + errMsg, 'error');
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  // --- Admin Editing Record Functions ---
  const handleOpenEditRecord = (rec: OvertimeRecord) => {
    setEditingRecord(rec);
    setEditHoursStr(String(rec.overtimeHours));
    setEditRemarks(rec.remarks);
    setEditReasonForOvertime(rec.reasonForOvertime || '');
    setEditApprovalForOT(rec.approvalForOT || '');
    setEditDate(rec.date);
  };

  const handleSaveEditedRecord = async () => {
    if (!editingRecord) return;
    const otHours = parseFloat(editHoursStr);
    
    if (!isValidOTHours(otHours)) {
      showToast('Overtime hours must be in increments of 0.5 (e.g. 1.0, 1.5, 3.5)', 'error');
      return;
    }

    if (!editRemarks.trim()) {
      showToast('OPF Number is mandatory', 'error');
      return;
    }

    if (!editReasonForOvertime.trim()) {
      showToast('Reason for Overtime is mandatory', 'error');
      return;
    }

    // Prevent duplicate entries for the same employee on the same date
    const isDuplicateInDb = sheetData?.records.some(
      rec => rec.employeeCode.toLowerCase() === editingRecord.employeeCode.toLowerCase() && 
             rec.date === editDate && 
             rec.rowIndex !== editingRecord.rowIndex
    );

    if (isDuplicateInDb) {
      showToast(`Overtime entry already exists for Employee Code ${editingRecord.employeeCode} on ${formatDateToDDMMYYYY(editDate)}`, 'error');
      return;
    }

    if (window.confirm('Save changes to this overtime record?')) {
      setIsSaving(true);
      try {
        const updatedRecord: OvertimeRecord = {
          ...editingRecord,
          date: editDate,
          overtimeHours: otHours,
          foodingApplicable: calculateFooding(otHours),
          remarks: editRemarks.trim().toUpperCase(),
          reasonForOvertime: editReasonForOvertime.trim(),
          approvalForOT: editApprovalForOT,
        };

        await updateOvertimeRecord(updatedRecord);
        showToast('Overtime record updated successfully!', 'success');
        setEditingRecord(null);
        await syncData();
      } catch (err: any) {
        console.error(err);
        showToast('Failed to update: ' + err.message, 'error');
      } finally {
        setIsSaving(false);
      }
    }
  };

  // --- Admin Deleting Record Function ---
  const handleDeleteRecord = async (rec: OvertimeRecord) => {
    if (!sheetData) return;

    if (window.confirm(`Are you sure you want to permanently delete the overtime record for ${rec.employeeName} on ${rec.date}? This will also delete the row in the Google Spreadsheet if sync is active.`)) {
      setIsSaving(true);
      try {
        await deleteOvertimeRecord(rec.rowIndex, sheetData.responseSheetId);
        showToast('Overtime record deleted successfully!', 'success');
        await syncData();
      } catch (err: any) {
        console.error(err);
        showToast('Failed to delete: ' + err.message, 'error');
      } finally {
        setIsSaving(false);
      }
    }
  };

  // --- Deferred Filter Values for non-blocking UI responsiveness ---
  const deferredFilters = useDeferredValue(filters);
  const deferredOpStartDate = useDeferredValue(operatorStartDate);
  const deferredOpEndDate = useDeferredValue(operatorEndDate);
  const deferredOpSearch = useDeferredValue(operatorSearch);

  // --- Filter helper options extracted dynamically from spreadsheet data (Connected with Date Range & Sibling Filters) ---
  const filterOptions = useMemo(() => {
    if (!sheetData) return { departments: [], designations: [], payrolls: [], operators: [], remarks: [], reasons: [] };

    // 1. Filter records pool by Date Range first
    const startTs = deferredFilters.startDate ? parseDateString(deferredFilters.startDate).getTime() : null;
    const endTs = deferredFilters.endDate ? parseDateString(deferredFilters.endDate).getTime() + 86399999 : null;

    let dateRecords = sheetData.records || [];
    if (startTs !== null || endTs !== null) {
      dateRecords = dateRecords.filter(rec => {
        const recTs = rec.parsedTimestamp ?? parseDateString(rec.date).getTime();
        if (startTs !== null && recTs < startTs) return false;
        if (endTs !== null && recTs > endTs) return false;
        return true;
      });
    }

    // Helper to check if a record matches all active filters EXCEPT a specific excluded filter
    const matchesSiblings = (
      rec: OvertimeRecord,
      excludeField: 'department' | 'payroll' | 'designation' | 'enteredBy' | 'remarks' | 'reasonForOvertime'
    ) => {
      if (excludeField !== 'department' && deferredFilters.department && rec.department !== deferredFilters.department) return false;
      if (excludeField !== 'payroll' && deferredFilters.payroll && rec.payroll !== deferredFilters.payroll) return false;
      if (excludeField !== 'designation' && deferredFilters.designation && rec.designation !== deferredFilters.designation) return false;
      if (excludeField !== 'enteredBy' && deferredFilters.enteredBy && rec.enteredBy !== deferredFilters.enteredBy) return false;
      if (excludeField !== 'remarks' && deferredFilters.remarks) {
        if (!rec.remarks || rec.remarks.toLowerCase().trim() !== deferredFilters.remarks.toLowerCase().trim()) return false;
      }
      if (excludeField !== 'reasonForOvertime' && deferredFilters.reasonForOvertime) {
        if (!rec.reasonForOvertime || rec.reasonForOvertime.toLowerCase().trim() !== deferredFilters.reasonForOvertime.toLowerCase().trim()) return false;
      }
      return true;
    };

    const depts = new Set<string>();
    const desigs = new Set<string>();
    const pays = new Set<string>();
    const ops = new Set<string>();
    const rems = new Set<string>();
    const reas = new Set<string>();

    // Always preserve currently selected filter value in the options list so it doesn't get disconnected
    if (deferredFilters.department) depts.add(deferredFilters.department);
    if (deferredFilters.payroll) pays.add(deferredFilters.payroll);
    if (deferredFilters.designation) desigs.add(deferredFilters.designation);
    if (deferredFilters.enteredBy) ops.add(deferredFilters.enteredBy);
    if (deferredFilters.remarks) rems.add(deferredFilters.remarks);
    if (deferredFilters.reasonForOvertime) reas.add(deferredFilters.reasonForOvertime);

    // Populate available filter options directly from the date-filtered dataset matching active sibling criteria
    for (const rec of dateRecords) {
      if (matchesSiblings(rec, 'department') && rec.department) depts.add(rec.department);
      if (matchesSiblings(rec, 'designation') && rec.designation) desigs.add(rec.designation);
      if (matchesSiblings(rec, 'payroll') && rec.payroll) pays.add(rec.payroll);
      if (matchesSiblings(rec, 'enteredBy') && rec.enteredBy) ops.add(rec.enteredBy);
      if (matchesSiblings(rec, 'remarks') && rec.remarks && rec.remarks.trim()) rems.add(rec.remarks.trim());
      if (matchesSiblings(rec, 'reasonForOvertime') && rec.reasonForOvertime && rec.reasonForOvertime.trim()) reas.add(rec.reasonForOvertime.trim());
    }

    // Fallback options from Employee Master if no records exist in selected date range
    if (depts.size === 0 || desigs.size === 0 || pays.size === 0) {
      for (const emp of sheetData.employees || []) {
        if (emp.department) depts.add(emp.department);
        if (emp.designation) desigs.add(emp.designation);
        if (emp.payroll) pays.add(emp.payroll);
      }
    }

    if (reas.size === 0 && sheetData.reasons) {
      sheetData.reasons.forEach(r => { if (r && r.trim()) reas.add(r.trim()); });
    }

    return {
      departments: Array.from(depts).sort(),
      designations: Array.from(desigs).sort(),
      payrolls: Array.from(pays).sort(),
      operators: Array.from(ops).sort(),
      remarks: Array.from(rems).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
      reasons: Array.from(reas).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    };
  }, [sheetData, deferredFilters]);

  // --- Apply dynamic filters to Admin reports view ---
  const filteredRecords = useMemo(() => {
    if (!sheetData?.records) return [];

    const startTs = deferredFilters.startDate ? parseDateString(deferredFilters.startDate).getTime() : null;
    const endTs = deferredFilters.endDate ? parseDateString(deferredFilters.endDate).getTime() + 86399999 : null;
    const empCodeTerm = deferredFilters.employeeCode ? deferredFilters.employeeCode.toLowerCase().trim() : null;
    const otVal = parseFloat(deferredFilters.overtimeHoursValue);
    const isOtValid = !isNaN(otVal) && deferredFilters.overtimeHoursOperator !== 'all';

    const filtered = sheetData.records.filter(rec => {
      const recTs = rec.parsedTimestamp ?? parseDateString(rec.date).getTime();

      // Date Range filter (Instant numeric comparison)
      if (startTs !== null && recTs < startTs) return false;
      if (endTs !== null && recTs > endTs) return false;

      // Department filter
      if (deferredFilters.department && rec.department !== deferredFilters.department) return false;

      // Dynamic "Search Employee" filter - Searches whole data except specified excluded columns
      if (empCodeTerm) {
        const words = empCodeTerm.split(/\s+/).filter(Boolean);
        const recordText = [
          rec.employeeCode,
          rec.employeeName,
          rec.designation,
          rec.department,
          rec.payroll,
          rec.date,
          formatDateToDDMMYYYY(rec.date),
          String(rec.overtimeHours),
          `${rec.overtimeHours}h`,
          `${rec.overtimeHours} hrs`,
          rec.foodingApplicable > 0 ? 'fooding' : '',
          rec.remarks,
          rec.reasonForOvertime
        ].filter(Boolean).map(v => String(v).toLowerCase()).join(' ');

        const matchesAll = words.every(word => recordText.includes(word));
        if (!matchesAll) return false;
      }

      // Payroll segment filter
      if (deferredFilters.payroll && rec.payroll !== deferredFilters.payroll) return false;

      // Designation filter
      if (deferredFilters.designation && rec.designation !== deferredFilters.designation) return false;

      // Operator filter
      if (deferredFilters.enteredBy && rec.enteredBy !== deferredFilters.enteredBy) return false;

      // Remarks filter (Searchable Dropdown)
      if (deferredFilters.remarks) {
        const remLower = deferredFilters.remarks.toLowerCase().trim();
        if (!rec.remarks || rec.remarks.toLowerCase().trim() !== remLower) return false;
      }

      // Reason for Overtime filter (Searchable Dropdown)
      if (deferredFilters.reasonForOvertime) {
        const reasLower = deferredFilters.reasonForOvertime.toLowerCase().trim();
        if (!rec.reasonForOvertime || rec.reasonForOvertime.toLowerCase().trim() !== reasLower) return false;
      }

      // Overtime Hours filter (Dynamic comparison)
      if (isOtValid) {
        const hrs = rec.overtimeHours;
        if (deferredFilters.overtimeHoursOperator === 'gt' && hrs <= otVal) return false;
        if (deferredFilters.overtimeHoursOperator === 'lt' && hrs >= otVal) return false;
        if (deferredFilters.overtimeHoursOperator === 'eq' && hrs !== otVal) return false;
      }

      return true;
    });

    // Ensure records are strictly sorted by date descending (newest entries first)
    return filtered.sort((a, b) => {
      const tsA = a.parsedTimestamp ?? parseDateString(a.date).getTime();
      const tsB = b.parsedTimestamp ?? parseDateString(b.date).getTime();
      return tsB - tsA;
    });
  }, [sheetData, deferredFilters]);

  // --- Pagination logic for Admin Overtime Logs ---
  const effectivePageSize = pageSize === 'all' ? (filteredRecords.length || 1) : pageSize;
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / effectivePageSize));
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedRecords = useMemo(() => {
    if (pageSize === 'all') return filteredRecords;
    const start = (validCurrentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, validCurrentPage, pageSize]);

  const startEntry = filteredRecords.length === 0 ? 0 : (validCurrentPage - 1) * effectivePageSize + 1;
  const endEntry = pageSize === 'all' ? filteredRecords.length : Math.min(validCurrentPage * effectivePageSize, filteredRecords.length);

  // --- Filtered logs for the specific logged-in USER ---
  const userFilteredRecords = useMemo(() => {
    if (!sheetData?.records || !appUser) return [];
    const userIdLower = appUser.id.toLowerCase();
    return sheetData.records
      .filter(r => r.enteredBy.toLowerCase() === userIdLower)
      .sort((a, b) => (b.parsedTimestamp ?? 0) - (a.parsedTimestamp ?? 0));
  }, [sheetData, appUser]);

  // --- Filter options dynamically computed from operator's date-filtered logs ---
  const operatorDateRecords = useMemo(() => {
    let result = userFilteredRecords;
    const sTs = deferredOpStartDate ? parseDateString(deferredOpStartDate).getTime() : null;
    const eTs = deferredOpEndDate ? parseDateString(deferredOpEndDate).getTime() + 86399999 : null;

    if (sTs !== null) {
      result = result.filter(r => (r.parsedTimestamp ?? parseDateString(r.date).getTime()) >= sTs);
    }
    if (eTs !== null) {
      result = result.filter(r => (r.parsedTimestamp ?? parseDateString(r.date).getTime()) <= eTs);
    }
    return result;
  }, [userFilteredRecords, deferredOpStartDate, deferredOpEndDate]);

  const operatorDepartments = useMemo(() => {
    const depts = new Set<string>();
    if (operatorDept) depts.add(operatorDept);
    operatorDateRecords.forEach(r => {
      if (r.department) depts.add(r.department);
    });
    return Array.from(depts).sort();
  }, [operatorDateRecords, operatorDept]);

  const operatorPayrolls = useMemo(() => {
    const payrolls = new Set<string>();
    if (operatorPayroll) payrolls.add(operatorPayroll);
    operatorDateRecords.forEach(r => {
      if (r.payroll) payrolls.add(r.payroll);
    });
    return Array.from(payrolls).sort();
  }, [operatorDateRecords, operatorPayroll]);

  // --- Fully Filtered & Searched logs for the Operator ---
  const operatorFilteredRecords = useMemo(() => {
    let result = userFilteredRecords;

    // Apply Search Term
    if (deferredOpSearch.trim() !== '') {
      const term = deferredOpSearch.toLowerCase();
      result = result.filter(r => 
        r.employeeName.toLowerCase().includes(term) ||
        r.employeeCode.toLowerCase().includes(term) ||
        r.designation.toLowerCase().includes(term) ||
        r.department.toLowerCase().includes(term) ||
        (r.remarks && r.remarks.toLowerCase().includes(term))
      );
    }

    // Apply Date Range
    const sTs = deferredOpStartDate ? parseDateString(deferredOpStartDate).getTime() : null;
    const eTs = deferredOpEndDate ? parseDateString(deferredOpEndDate).getTime() + 86399999 : null;

    if (sTs !== null) {
      result = result.filter(r => (r.parsedTimestamp ?? parseDateString(r.date).getTime()) >= sTs);
    }
    if (eTs !== null) {
      result = result.filter(r => (r.parsedTimestamp ?? parseDateString(r.date).getTime()) <= eTs);
    }

    // Apply Department
    if (operatorDept) {
      result = result.filter(r => r.department === operatorDept);
    }

    // Apply Payroll
    if (operatorPayroll) {
      result = result.filter(r => r.payroll === operatorPayroll);
    }

    // Apply Overtime Hours filter (Dynamic comparison)
    if (operatorHoursOperator !== 'all') {
      const val = parseFloat(operatorHoursValue);
      if (!isNaN(val)) {
        result = result.filter(r => {
          const hrs = r.overtimeHours;
          if (operatorHoursOperator === 'gt') return hrs > val;
          if (operatorHoursOperator === 'lt') return hrs < val;
          if (operatorHoursOperator === 'eq') return hrs === val;
          return true;
        });
      }
    }

    return result;
  }, [
    userFilteredRecords,
    deferredOpSearch,
    deferredOpStartDate,
    deferredOpEndDate,
    operatorDept,
    operatorPayroll,
    operatorHoursOperator,
    operatorHoursValue
  ]);

  // --- Dynamic operator total payout from response tab data only ---
  const operatorTotalPayout = useMemo(() => {
    return operatorFilteredRecords.reduce((sum, r) => {
      return sum + calculateOTCost(r, r.overtimeHours, r.date);
    }, 0);
  }, [operatorFilteredRecords]);

  // --- KPI Stats Calculation for filtered dataset ---
  const dashboardKPIs = useMemo(() => {
    if (!sheetData || filteredRecords.length === 0) {
      return {
        totalEmployees: 0,
        employeesWithOT: 0,
        totalOTHours: 0,
        averageOTHours: 0,
        totalFoodingCount: 0,
        totalFoodingCost: 0,
        totalOTRecords: 0,
        totalEstimatedOTCost: 0,
        totalCumulativeCost: 0,
        highestOTEmployeeName: 'N/A',
        highestOTDepartmentName: 'N/A',
      };
    }

    // Helper map for basic salary
    const empMap = new Map<string, Employee>();
    for (const e of sheetData.employees) {
      empMap.set(e.employeeCode, e);
    }

    const uniqueEmployeesWithOT = new Set<string>();
    let totalHours = 0;
    let totalFoodCount = 0;
    let totalCost = 0;

    const employeeAccumulatedCost: Record<string, { name: string; cost: number }> = {};
    const departmentAccumulatedCost: Record<string, number> = {};

    for (const rec of filteredRecords) {
      uniqueEmployeesWithOT.add(rec.employeeCode);
      totalHours += rec.overtimeHours;
      totalFoodCount += rec.foodingApplicable;

      // Calculate pay
      const cost = calculateOTCost(rec, rec.overtimeHours, rec.date);
      totalCost += cost;

      // Accumulate for employee leaderboards
      if (!employeeAccumulatedCost[rec.employeeCode]) {
        employeeAccumulatedCost[rec.employeeCode] = { name: rec.employeeName, cost: 0 };
      }
      employeeAccumulatedCost[rec.employeeCode].cost += cost;

      // Accumulate for department leaderboards
      departmentAccumulatedCost[rec.department] = (departmentAccumulatedCost[rec.department] || 0) + cost;
    }

    // Find highest OT employee by cost (money spent)
    let highestEmpName = 'N/A';
    let maxEmpCost = 0;
    Object.values(employeeAccumulatedCost).forEach(item => {
      if (item.cost > maxEmpCost) {
        maxEmpCost = item.cost;
        highestEmpName = `${item.name} (${formatCurrency(item.cost)})`;
      }
    });

    // Find highest OT department by cost (money spent)
    let highestDeptName = 'N/A';
    let maxDeptCost = 0;
    Object.entries(departmentAccumulatedCost).forEach(([dept, deptCost]) => {
      if (deptCost > maxDeptCost) {
        maxDeptCost = deptCost;
        highestDeptName = `${dept} (${formatCurrency(deptCost)})`;
      }
    });

    return {
      totalEmployees: sheetData.employees.length,
      employeesWithOT: uniqueEmployeesWithOT.size,
      totalOTHours: totalHours,
      averageOTHours: uniqueEmployeesWithOT.size > 0 ? Math.round((totalHours / uniqueEmployeesWithOT.size) * 10) / 10 : 0,
      totalFoodingCount: totalFoodCount,
      totalFoodingCost: totalFoodCount * 50,
      totalOTRecords: filteredRecords.length,
      totalEstimatedOTCost: Math.round(totalCost),
      totalCumulativeCost: (totalFoodCount * 50) + Math.round(totalCost),
      highestOTEmployeeName: highestEmpName,
      highestOTDepartmentName: highestDeptName,
    };
  }, [sheetData, filteredRecords]);

  // --- Export Reports functions ---
  const handleExportPDF = async () => {
    if (filteredRecords.length === 0) {
      showToast('No filtered records to export in selected date range', 'error');
      return;
    }
    await generatePDFReport({
      records: filteredRecords,
      startDate: filters.startDate,
      endDate: filters.endDate,
      title: 'LITTLE NAP RECLINERS',
      subtitle: 'WORKFORCE ATTENDANCE MATRIX REPORT'
    });
    showToast('Attendance PDF report downloaded!', 'success');
  };

  const handleExportExcel = async () => {
    if (filteredRecords.length === 0) {
      showToast('No filtered records to export in selected date range', 'error');
      return;
    }
    await generateExcelReport({
      records: filteredRecords,
      startDate: filters.startDate,
      endDate: filters.endDate,
      title: 'LITTLE NAP RECLINERS',
      subtitle: 'WORKFORCE ATTENDANCE MATRIX REPORT'
    });
    showToast('Attendance Excel (.xlsx) report downloaded!', 'success');
  };

  const handleExportOvertimePDF = async () => {
    if (filteredRecords.length === 0) {
      showToast('No filtered records to export in selected date range', 'error');
      return;
    }
    await generateOvertimePDFReport({
      records: filteredRecords,
      employees: sheetData?.employees || [],
      startDate: filters.startDate,
      endDate: filters.endDate,
      title: 'LITTLE NAP RECLINERS',
      subtitle: 'ADMIN WORKFORCE OVERTIME REPORT'
    });
    showToast('Admin Overtime PDF report downloaded!', 'success');
  };

  const handleExportOvertimeExcel = async () => {
    if (filteredRecords.length === 0) {
      showToast('No filtered records to export in selected date range', 'error');
      return;
    }
    await generateOvertimeExcelReport({
      records: filteredRecords,
      employees: sheetData?.employees || [],
      startDate: filters.startDate,
      endDate: filters.endDate,
      title: 'LITTLE NAP RECLINERS',
      subtitle: 'ADMIN WORKFORCE OVERTIME REPORT'
    });
    showToast('Admin Overtime Excel (.xlsx) report downloaded!', 'success');
  };

  const handleExportCSV = () => {
    if (filteredRecords.length === 0) {
      showToast('No filtered records to export', 'error');
      return;
    }

    const headers = ['Timestamp', 'Employee Code', 'Employee Name', 'Designation', 'Department', 'Payroll', 'Date', 'OT Hours', 'Fooding', 'Entered By', 'Remarks'];
    const rows = filteredRecords.map(r => [
      formatIndianTimestamp(r.timestamp),
      `"${r.employeeCode}"`,
      `"${r.employeeName}"`,
      `"${r.designation}"`,
      `"${r.department}"`,
      `"${r.payroll}"`,
      r.date,
      r.overtimeHours,
      r.foodingApplicable,
      `"${r.enteredBy}"`,
      `"${r.remarks.replace(/"/g, '""')}"`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `OT_Reports_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('CSV report exported successfully!', 'success');
  };

  const handlePrintReport = () => {
    window.print();
  };

  // Callback to support drill-down click filtering from charts
  const handleChartFilterChange = (key: string, value: string) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
    }));
    showToast(`Dashboard filtered by ${key}: ${value}`, 'info');
  };

  // 1. Fullscreen Loading Screen
  if (isLoadingSheets) {
    return (
      <div className="fixed inset-0 w-screen h-screen bg-slate-50 flex items-center justify-center p-4 overflow-hidden select-none font-sans text-slate-800 antialiased">
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-100 flex flex-col items-center justify-center space-y-4 shadow-xl max-w-sm w-full animate-in fade-in duration-300">
          <RefreshCw className="w-10 h-10 text-indigo-600 animate-spin" />
          <div>
            <h4 className="text-base font-semibold text-slate-800">Loading Overtime Data</h4>
            <p className="text-xs text-slate-400 mt-1">Syncing workforce lists and records...</p>
          </div>
        </div>
      </div>
    );
  }

  // 2. Fullscreen Error Screen
  if (sheetsError) {
    return (
      <div className="fixed inset-0 w-screen h-screen bg-slate-50 flex items-center justify-center p-4 overflow-hidden select-none font-sans text-slate-800 antialiased">
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-6 rounded-2xl flex flex-col items-center text-center gap-4 max-w-md w-full shadow-lg animate-in fade-in duration-300">
          <AlertTriangle className="w-10 h-10 text-rose-600" />
          <div>
            <h4 className="font-bold text-rose-950">Database Sync Failure</h4>
            <p className="text-xs mt-1 leading-relaxed text-rose-900">{sheetsError}</p>
          </div>
          <div className="mt-2 flex gap-3 w-full">
            <button
              onClick={() => syncData()}
              className="flex-1 bg-rose-600 text-white px-3 py-2 text-xs font-semibold rounded-xl hover:bg-rose-700 transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry Sync
            </button>
            <button
              onClick={handleFullReset}
              className="flex-1 bg-white border border-rose-300 text-rose-700 px-3 py-2 text-xs font-semibold rounded-xl hover:bg-rose-100 transition-all cursor-pointer"
            >
              Disconnect URL
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. Fullscreen Login Screen (Perfectly Centered & Non-Scrollable)
  if (!appUser) {
    return (
      <div className="fixed inset-0 w-screen h-screen bg-slate-50 flex items-center justify-center p-4 overflow-hidden select-none font-sans text-slate-800 antialiased">
        {/* Toast Notification */}
        {toast && (
          <div className={`fixed top-5 right-5 z-50 p-4 rounded-xl shadow-lg border flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300 ${
            toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
            toast.type === 'error' ? 'bg-rose-50 text-rose-800 border-rose-200' :
            'bg-indigo-50 text-indigo-800 border-indigo-200'
          }`}>
            {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertTriangle className="w-5 h-5 text-rose-600" />}
            <span className="text-sm font-semibold">{toast.message}</span>
          </div>
        )}

        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200/50 p-8 space-y-6 animate-in fade-in zoom-in-95 duration-300 select-text">
          <div className="text-center space-y-4 select-none">
            <div className="mx-auto bg-slate-50 p-3 rounded-2xl border border-slate-100 flex items-center justify-center w-fit shadow-3xs">
              <img 
                src="https://s3.eu-central-1.wasabisys.com/onemessageapp/admin/2025/8/8/images/4b/e9/ec44ce49b54b405e9837db8c55484438.png" 
                alt="Little Nap Logo" 
                className="h-14 w-auto object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold tracking-tight text-slate-900">Sign In</h3>
              <p className="text-xs text-slate-400 font-medium">Enter your credentials to access the tracker</p>
            </div>
          </div>

          {loginError && (
            <div className="bg-rose-50 border border-rose-100 text-rose-800 p-3.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 shadow-xs animate-pulse">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleAppLogin} className="space-y-5">
            <div className="space-y-1.5">
              <label className="block text-[10px] font-semibold uppercase text-slate-400 tracking-wider">Employee ID</label>
              <input
                type="text"
                required
                placeholder="Enter Employee ID"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium placeholder:text-slate-300 shadow-3xs transition-all"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-semibold uppercase text-slate-400 tracking-wider">Password</label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 placeholder:text-slate-300 shadow-3xs transition-all"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-slate-900 hover:bg-slate-950 text-white py-3 rounded-xl text-sm font-semibold shadow-xs hover:shadow-sm active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogIn className="w-4 h-4" /> Sign In
            </button>
          </form>

          <div className="text-center pt-4 border-t border-slate-100 flex items-center justify-center gap-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wider select-none">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Active Connection</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/50 font-sans text-slate-800 antialiased flex flex-col">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 p-4 rounded-xl shadow-lg border flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300 ${
          toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
          toast.type === 'error' ? 'bg-rose-50 text-rose-800 border-rose-200' :
          'bg-indigo-50 text-indigo-800 border-indigo-200'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertTriangle className="w-5 h-5 text-rose-600" />}
          <span className="text-sm font-semibold">{toast.message}</span>
        </div>
      )}

      {/* --- Global Application Header Bar --- */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-40 print:hidden shadow-xs w-full">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-white p-1 rounded-xl border border-slate-100 shadow-3xs flex items-center justify-center">
              <img 
                src="https://s3.eu-central-1.wasabisys.com/onemessageapp/admin/2025/8/8/images/4b/e9/ec44ce49b54b405e9837db8c55484438.png" 
                alt="Little Nap Logo" 
                className="h-10 w-auto object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="h-8 w-px bg-slate-100 hidden sm:block"></div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight text-slate-900 flex items-center gap-1.5">
                Overtime Tracker
              </h1>
              <p className="text-[10px] text-slate-400 font-medium tracking-wide">Workforce Overtime Management</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Database Connection Badge */}
            <div className="flex items-center gap-2 bg-emerald-50/60 border border-emerald-100/50 rounded-xl p-1.5 px-3">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <div className="text-left">
                <div className="text-[9px] text-emerald-600 font-semibold uppercase leading-none tracking-wider">Active Sync</div>
                <div className="text-[10px] text-slate-500 mt-0.5 font-medium">Synced: {lastSyncTime}</div>
              </div>
            </div>

            {appUser && (
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-xl px-3 py-1.5">
                <UserCheck className="w-3.5 h-3.5 text-slate-500" />
                <div className="text-left text-xs">
                  <div className="font-semibold text-slate-800 leading-none">{appUser.id}</div>
                  <div className="text-[9px] text-slate-400 uppercase mt-0.5 font-medium tracking-wider">{appUser.type} Account</div>
                </div>
              </div>
            )}

            {appUser && (
              <button
                onClick={handleLogout}
                className="p-2 rounded-xl bg-slate-50 border border-slate-100 text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all cursor-pointer shadow-3xs"
                title="Log Out Session"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* --- Main Workspace Canvas --- */}
      <main className="flex-1 w-full px-3 sm:px-4 lg:px-6 py-4 sm:py-6 space-y-6">
        
        {/* --- Database Connection Fallback Warning Banner (Visible to Authenticated Operators) --- */}
        {sheetData?.isFallbackMode && (
          <div className="bg-amber-50/80 border border-amber-200/60 text-amber-900 p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 w-full animate-in fade-in duration-300 shadow-3xs">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-[10px] uppercase tracking-wider text-amber-950">Google Sheets Offline</h4>
                <p className="text-xs mt-0.5 font-medium leading-relaxed">
                  Operating offline. Data will be saved locally on the server.
                  <span className="block mt-1 text-[9px] text-amber-700/80 uppercase tracking-wider font-sans">Reason: {sheetData.fallbackError}</span>
                </p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0 self-end sm:self-center">
              <button
                onClick={() => syncData()}
                className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider rounded-xl transition-all shadow-3xs cursor-pointer"
              >
                Retry Sync
              </button>
              <button
                onClick={handleFullReset}
                className="bg-white hover:bg-slate-50 border border-amber-200 text-amber-800 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider rounded-xl transition-all shadow-3xs cursor-pointer"
              >
                Disconnect URL
              </button>
            </div>
          </div>
        )}

        {/* --- Google Sheets & Google Drive Live Sync Configuration Settings Panel --- */}
        {isConfiguringUrl && (
          <div className="bg-white rounded-2xl border border-slate-200/60 p-6 space-y-6 shadow-xs w-full animate-in fade-in duration-300">
            <div className="flex justify-between items-start border-b border-slate-100 pb-4">
              <div>
                <span className="text-[9px] font-semibold uppercase bg-indigo-500 text-white px-2 py-0.5 rounded-md">Settings</span>
                <h3 className="text-base font-semibold tracking-tight text-slate-900 mt-2">Google Sheet & Drive Integration</h3>
                <p className="text-xs text-slate-400 font-medium font-sans">Link your workforce spreadsheet and authorize Google Drive for approval uploads.</p>
              </div>
              <button
                onClick={() => setIsConfiguringUrl(false)}
                className="text-xs text-slate-400 hover:text-slate-600 font-bold cursor-pointer uppercase tracking-wider text-[10px]"
              >
                Close Panel
              </button>
            </div>

            {/* Dual Spreadsheet Connection Input Fields */}
            <div className="space-y-4 bg-slate-50/50 p-5 rounded-2xl border border-slate-200/80">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Database className="w-4 h-4 text-indigo-600" /> Dual-Spreadsheet Live Integration (Split Large Datasets)
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5 font-medium">
                    To eliminate Google Script loading errors and fix date filtering lag, keep your active spreadsheet clean for daily entries and store historical old records in a secondary Archive spreadsheet.
                  </p>
                </div>
                {isArchiveConfigured && (
                  <span className="shrink-0 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Dual-Source Active
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                {/* Active Spreadsheet Input */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold uppercase text-indigo-700 tracking-wider flex items-center justify-between">
                    <span>1. Active Spreadsheet Web App URL (New Entries)</span>
                    <span className="text-[9px] text-indigo-600 font-semibold bg-indigo-50 px-1.5 py-0.5 rounded">Primary Target</span>
                  </label>
                  <input
                    type="url"
                    placeholder="https://script.google.com/macros/s/.../exec"
                    value={tempUrlInput}
                    onChange={(e) => setTempUrlInput(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 bg-white font-medium"
                  />
                  <p className="text-[10px] text-slate-400 font-sans">New overtime submissions and daily edits are written here.</p>
                </div>

                {/* Archive / Old Data Spreadsheet Input */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold uppercase text-slate-600 tracking-wider flex items-center justify-between">
                    <span>2. Archive Spreadsheet Web App URL (Old Data)</span>
                    <span className="text-[9px] text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.5 rounded">Historical Archive</span>
                  </label>
                  <input
                    type="url"
                    placeholder="https://script.google.com/macros/s/.../exec (Optional Old Data Sheet)"
                    value={archiveUrlInput}
                    onChange={(e) => setArchiveUrlInput(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 bg-white font-medium"
                  />
                  <p className="text-[10px] text-slate-400 font-sans">Older historical entries are read and merged in parallel into all reports.</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-200/60">
                <p className="text-[10px] text-slate-500 font-medium">
                  💡 Both spreadsheets use the exact same Google Apps Script code!
                </p>
                <div className="flex gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => handleSaveAppsScriptUrl(tempUrlInput, archiveUrlInput)}
                    className="flex-1 sm:flex-none bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 text-xs font-semibold rounded-xl shadow-xs transition-all cursor-pointer whitespace-nowrap"
                  >
                    Save & Validate Connections
                  </button>
                  <button
                    onClick={handleFullReset}
                    className="bg-white border border-slate-200 text-rose-600 hover:bg-rose-50 px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>

            {/* Comprehensive Setup & Drive Upload Guide */}
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Complete Setup & Google Drive Upload Guide
              </h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-slate-600 leading-relaxed font-sans">
                <div className="space-y-3.5">
                  <div>
                    <strong className="text-slate-800 font-bold block mb-1">1. Copy Apps Script Code</strong>
                    <p className="text-slate-500 font-medium">Open the <code className="bg-slate-100 text-indigo-600 px-1 py-0.5 rounded text-[11px] font-mono">/GoogleAppsScriptCode.js</code> file in the code editor, and copy its complete contents.</p>
                  </div>
                  <div>
                    <strong className="text-slate-800 font-bold block mb-1">2. Add Code to Google Spreadsheet</strong>
                    <p className="text-slate-500 font-medium">Open your Google Spreadsheet, click on <strong className="text-slate-700">Extensions &gt; Apps Script</strong> from the top menu, delete any existing placeholder code, and paste the copied code. Click the disk save icon.</p>
                  </div>
                  <div>
                    <strong className="text-slate-800 font-bold block mb-1">3. Drive Folder Setup (Optional)</strong>
                    <p className="text-slate-500 font-medium">
                      By default, uploaded files are saved in the <strong>same folder</strong> where your Google Spreadsheet resides. If you prefer to save them in a specific folder, create a folder in your Google Drive, copy its unique <strong className="text-indigo-600">Folder ID</strong> from the URL address bar (e.g. the string after <code className="font-mono bg-slate-50 text-slate-500 text-[10px]">/folders/...</code>), and replace the <code className="font-mono bg-slate-100 text-indigo-600 px-1 py-0.5 rounded text-[11px]">folderId</code> variable in your Apps Script code with your copied ID.
                    </p>
                  </div>
                </div>

                <div className="space-y-3.5">
                  <div>
                    <strong className="text-slate-800 font-bold block mb-1">4. Deploy as Web App (Mandatory Configuration)</strong>
                    <p className="text-slate-500 font-medium">
                      Click the blue <strong className="text-slate-700">Deploy &gt; New deployment</strong> button. Click select type (gear icon) and choose <strong className="text-slate-700">Web app</strong>. Update settings exactly:
                      <span className="block mt-1 pl-3 border-l-2 border-indigo-200 text-slate-500 font-medium">
                        • <strong>Execute as:</strong> Me (your-account@gmail.com)<br />
                        • <strong>Who has access:</strong> Anyone
                      </span>
                    </p>
                  </div>
                  <div>
                    <strong className="text-slate-800 font-bold block mb-1">5. Authorize Google Drive Access</strong>
                    <p className="text-slate-500 font-medium">Click Deploy, click <strong className="text-slate-700">Authorize access</strong>, sign in to your Google Account, click <strong className="text-slate-700">Advanced</strong> on the warning screen, click <strong className="text-slate-700">Go to Untitled project (unsafe)</strong>, and click <strong className="text-slate-700">Allow</strong> to grant file storage permissions.</p>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl space-y-2">
                    <div>
                      <strong className="text-amber-950 font-bold block mb-1 flex items-center gap-1 text-[11px]">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> Fixing "DriveApp Permission" Error:
                      </strong>
                      <p className="text-amber-900/95 font-medium text-[11px] leading-relaxed">
                        If you see an error mentioning <strong>DriveApp</strong> permissions, Google requires you to explicitly declare scopes in your script settings:
                      </p>
                    </div>
                    
                    <div className="bg-white/80 border border-amber-100 rounded-lg p-2.5 text-[11px] font-sans text-slate-700 leading-relaxed space-y-1">
                      <strong className="text-slate-800 font-bold block">Method A: Enable appsscript.json Scopes (Recommended & Permanent)</strong>
                      <ol className="list-decimal pl-4 space-y-1 text-slate-600 font-medium">
                        <li>In your Apps Script editor, click the <strong>Gear icon ⚙️ (Project Settings)</strong> on the left sidebar.</li>
                        <li>Check the box <strong>"Show 'appsscript.json' manifest file in editor"</strong>.</li>
                        <li>Go back to the <strong>Editor icon 📄 (left sidebar)</strong> and open <strong>appsscript.json</strong>.</li>
                        <li>Replace its entire content with the following configuration:</li>
                      </ol>
                      <pre className="font-mono bg-slate-900 text-slate-100 text-[10px] p-2 rounded-md overflow-x-auto mt-1">
{`{
  "timeZone": "GMT",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
  ]
}`}
                      </pre>
                      <p className="text-slate-500 font-medium text-[10px] mt-1">Save the file, and then deploy a <strong>New Version</strong> of your Web App!</p>
                    </div>

                    <div className="bg-white/80 border border-amber-100 rounded-lg p-2.5 text-[11px] font-sans text-slate-700 leading-relaxed">
                      <strong className="text-slate-800 font-bold block mb-1">Method B: Force Manual Authorization Trigger</strong>
                      <ol className="list-decimal pl-4 space-y-1 text-slate-600 font-medium">
                        <li>In the editor toolbar dropdown, select the function <strong>"authorizeDriveAndSheets"</strong>.</li>
                        <li>Click <strong>"Run"</strong> next to the dropdown to force Google's auth prompt.</li>
                        <li>Authorize your account, then re-deploy a <strong>New Version</strong> of your Web App!</li>
                      </ol>
                    </div>
                  </div>
                  <div className="bg-rose-50/50 border border-rose-100 p-3 rounded-xl">
                    <strong className="text-rose-950 font-bold block mb-1 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600" /> Crucial: Deploy as "New Version"
                    </strong>
                    <p className="text-rose-900/80 font-medium text-[11px] leading-relaxed">
                      Whenever you apply a script update, you <strong>MUST</strong> re-deploy it as a <strong>New Version</strong> to activate the update:
                      <span className="block mt-1 font-semibold text-rose-950">
                        Deploy &gt; Manage deployments &gt; Click active deployment &gt; Click Pencil Edit &gt; Select Version: "New version" &gt; Click Deploy.
                      </span>
                      Without doing this, Google will continue running the old code which lacks Drive saving permissions!
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- SECURED PORTAL VIEWS --- */}
        {appUser && (
          <div className="space-y-8">
            
            {/* ==============================================
                A. USER ROLE PORTAL
                ============================================== */}
            {appUser.type === 'User' && (
              <div className="space-y-8">
                
                {/* Staging & Entry Controls Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                  
                  {/* Employee Search & Add Overtime Card */}
                  <div className="bg-white rounded-xl border border-slate-100 p-6 space-y-6 shadow-xs">
                    <div className="flex flex-col gap-4">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500 mb-1">Queue Entries</div>
                        <h2 className="text-base font-semibold tracking-tight text-slate-900">Add Overtime Records</h2>
                        <p className="text-xs text-slate-400 font-medium">Select employees from the workforce directory to queue their overtime entries.</p>
                      </div>

                      {/* Mode Toggle: Single vs. Bulk */}
                      <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEntryMode('single');
                            setBulkSelectedEmployees([]);
                          }}
                          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${entryMode === 'single' ? 'bg-white text-slate-800 shadow-3xs' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                          <Clock className="w-3.5 h-3.5" /> Single Employee
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEntryMode('bulk');
                            setSelectedEmployee(null);
                          }}
                          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${entryMode === 'bulk' ? 'bg-white text-slate-800 shadow-3xs' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                          <Users className="w-3.5 h-3.5" /> Bulk Select (50+ Workers)
                        </button>
                      </div>

                      {/* Sticky Setting Option */}
                      <div className="flex items-center gap-2 px-1">
                        <input
                          type="checkbox"
                          id="keepSticky"
                          checked={keepSticky}
                          onChange={(e) => setKeepSticky(e.target.checked)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
                        />
                        <label htmlFor="keepSticky" className="text-[10px] font-medium text-slate-500 cursor-pointer">
                          Keep Date, Hours, Reason & OPF Number sticky for consecutive entries
                        </label>
                      </div>
                    </div>

                    {/* Biometric Device Punch Import */}
                    <BiometricSyncPanel
                      employees={sheetData?.employees || []}
                      existingRecords={sheetData?.records || []}
                      onImport={handleImportBiometricEntries}
                    />

                    {/* MODE A: SINGLE EMPLOYEE MODE */}
                    {entryMode === 'single' && (
                      <div className="space-y-4">
                        {/* Step 1: Employee Search Box */}
                        <div className="space-y-2 relative">
                          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">Employee Search</label>
                          <div className="relative">
                            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              placeholder="Search by Name, Code, Designation, Department..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                            />
                          </div>

                          {/* Dropdown Instant Search Results */}
                          {searchQuery.trim() !== '' && (
                            <div className="absolute top-full left-0 right-0 z-30 bg-white border border-slate-100 rounded-xl shadow-lg mt-1.5 max-h-[240px] overflow-y-auto divide-y divide-slate-50">
                              {filteredEmployeesForSearch.length > 0 ? (
                                filteredEmployeesForSearch.map((emp, idx) => (
                                  <button
                                    key={`${emp.employeeCode || 'nocode'}_${emp.employeeName || 'noname'}_${idx}`}
                                    onClick={() => {
                                      setSelectedEmployee(emp);
                                      setSearchQuery('');
                                    }}
                                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50/80 transition-colors flex justify-between items-center cursor-pointer"
                                  >
                                    <div>
                                      <div className="font-semibold text-slate-800 text-sm">{emp.employeeName}</div>
                                      <div className="text-[10px] text-slate-400 mt-0.5">{emp.designation} • {emp.department}</div>
                                    </div>
                                    <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded-md text-slate-500 font-bold">{emp.employeeCode}</span>
                                  </button>
                                ))
                              ) : (
                                <div className="p-4 text-center text-xs text-slate-400 font-medium">
                                  No employee found matching "{searchQuery}"
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Step 2: Employee selected Details & OT entry form */}
                        {selectedEmployee ? (
                          <div className="bg-slate-50 border border-slate-100 p-5 rounded-xl space-y-4 animate-in fade-in duration-200">
                            <div className="flex justify-between items-start">
                              <div>
                                <span className="text-[9px] font-semibold uppercase bg-slate-900 text-white px-2 py-0.5 rounded-md">Selected Employee</span>
                                <h4 className="font-semibold text-slate-800 text-sm mt-2">{selectedEmployee.employeeName}</h4>
                                <p className="text-[10px] font-medium text-slate-400 mt-0.5">{selectedEmployee.designation} • {selectedEmployee.department} ({selectedEmployee.payroll})</p>
                              </div>
                              <button
                                onClick={() => setSelectedEmployee(null)}
                                className="text-xs text-rose-500 hover:text-rose-700 font-bold cursor-pointer uppercase tracking-wider text-[10px]"
                              >
                                Cancel
                              </button>
                            </div>

                            {/* Interactive Form Fields */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Overtime Date</label>
                                <input
                                  type="date"
                                  value={otDate}
                                  onChange={(e) => setOtDate(e.target.value)}
                                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-hidden"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Hours</label>
                                <select
                                  value={otHoursStr}
                                  onChange={(e) => setOtHoursStr(e.target.value)}
                                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-hidden"
                                >
                                  {Array.from({ length: 48 }, (_, i) => String((i + 1) * 0.5)).map(hrs => (
                                    <option key={hrs} value={hrs}>{hrs} Hours</option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            {/* Fooding Warning Indicator */}
                            <div className="flex items-center gap-2 p-2.5 bg-amber-50/50 border border-amber-200/40 rounded-lg text-[11px] text-amber-800 font-semibold">
                              <Coffee className="w-4 h-4 text-amber-600 shrink-0" />
                              <span>
                                Food Allowance: <strong className="text-amber-900">{calculateFooding(parseFloat(otHoursStr)) > 0 ? 'Applicable (Rs. 50)' : 'Not Applicable'}</strong>
                              </span>
                            </div>

                            <div>
                              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                                Reason for Overtime <span className="text-rose-500">*</span>
                              </label>
                              <select
                                value={reasonForOvertime}
                                onChange={(e) => setReasonForOvertime(e.target.value)}
                                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-hidden"
                              >
                                <option value="">-- Select Reason --</option>
                                {(sheetData?.reasons || [
                                  "Machine Breakdown",
                                  "Urgent Shipment Demand",
                                  "Quarterly Close Support",
                                  "Stock Verification",
                                  "Client Urgent Support",
                                  "Maintenance & Cleanup",
                                  "System Upgrade",
                                  "Pending Audit Support"
                                ]).map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                                OPF Number <span className="text-rose-500">*</span>
                              </label>
                              <input
                                type="text"
                                placeholder="Enter mandatory OPF Number..."
                                value={remarks}
                                onChange={(e) => setRemarks(e.target.value.toUpperCase())}
                                onBlur={(e) => setRemarks(e.target.value.toUpperCase())}
                                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-hidden"
                              />
                            </div>

                            <button
                              onClick={handleAddEntryToBulkList}
                              className="w-full bg-slate-900 hover:bg-black text-white font-semibold uppercase tracking-wider text-[11px] py-2.5 rounded-xl flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                            >
                              <Plus className="w-4 h-4" /> Add to Queue
                            </button>
                          </div>
                        ) : (
                          <div className="bg-slate-50/60 border border-dashed border-slate-200 rounded-xl p-8 text-center text-slate-400 text-xs font-medium">
                            Search and select an employee above to configure their overtime record details.
                          </div>
                        )}
                      </div>
                    )}

                    {/* MODE B: BULK SELECT WORKERS MODE */}
                    {entryMode === 'bulk' && (
                      <div className="space-y-5 animate-in fade-in duration-200">
                        {/* Step 1: Bulk Filters */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Filter Department</label>
                            <select
                              value={bulkSelectedDept}
                              onChange={(e) => {
                                setBulkSelectedDept(e.target.value);
                                setBulkSelectedEmployees([]); // Reset selection when department changes
                              }}
                              className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-hidden"
                            >
                              <option value="">All Departments</option>
                              {uniqueDepts.map(dept => (
                                <option key={dept} value={dept}>{dept}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Search Employee Name/Code</label>
                            <div className="relative">
                              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                              <input
                                type="text"
                                placeholder="Search Name, Code, Designation..."
                                value={bulkSearchQuery}
                                onChange={(e) => setBulkSearchQuery(e.target.value)}
                                className="w-full pl-8 pr-8 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                              />
                              {bulkSearchQuery && (
                                <button
                                  type="button"
                                  onClick={() => setBulkSearchQuery('')}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                                  title="Clear search"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Step 2: Employee Checklist Area */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center px-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                              Workforce List ({filteredEmployeesForBulk.length} shown)
                              {bulkSearchQuery.trim() !== '' && (
                                <span className="text-indigo-600 font-medium normal-case ml-1">(Filtered by search)</span>
                              )}
                            </span>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const allCodes = filteredEmployeesForBulk.map(emp => emp.employeeCode);
                                  setBulkSelectedEmployees(allCodes);
                                }}
                                className="text-[10px] font-bold uppercase text-indigo-600 hover:text-indigo-800 cursor-pointer"
                              >
                                Select All
                              </button>
                              <span className="text-slate-300 text-[10px]">•</span>
                              <button
                                type="button"
                                onClick={() => setBulkSelectedEmployees([])}
                                className="text-[10px] font-bold uppercase text-slate-500 hover:text-slate-700 cursor-pointer"
                              >
                                Clear All
                              </button>
                            </div>
                          </div>

                          <div className="border border-slate-200 rounded-xl overflow-hidden bg-white max-h-[220px] overflow-y-auto divide-y divide-slate-50">
                            {filteredEmployeesForBulk.length > 0 ? (
                              filteredEmployeesForBulk.map((emp, idx) => {
                                const isChecked = bulkSelectedEmployees.includes(emp.employeeCode);
                                return (
                                  <label
                                    key={`${emp.employeeCode || 'nocode'}_${emp.employeeName || 'noname'}_${idx}`}
                                    className={`w-full px-4 py-2.5 flex justify-between items-center cursor-pointer transition-colors hover:bg-slate-50/50 ${isChecked ? 'bg-indigo-50/20' : ''}`}
                                  >
                                    <div className="flex items-center gap-3">
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => {
                                          if (isChecked) {
                                            setBulkSelectedEmployees(bulkSelectedEmployees.filter(c => c !== emp.employeeCode));
                                          } else {
                                            setBulkSelectedEmployees([...bulkSelectedEmployees, emp.employeeCode]);
                                          }
                                        }}
                                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4 cursor-pointer"
                                      />
                                      <div>
                                        <div className="font-semibold text-slate-800 text-sm">{emp.employeeName}</div>
                                        <div className="text-[10px] text-slate-400 mt-0.5">{emp.designation} • {emp.department}</div>
                                      </div>
                                    </div>
                                    <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded-md text-slate-500 font-bold">{emp.employeeCode}</span>
                                  </label>
                                );
                              })
                            ) : (
                              <div className="p-8 text-center text-slate-400 text-xs font-medium space-y-2">
                                <p>No employees found matching {bulkSearchQuery ? `"${bulkSearchQuery}"` : 'the selected filters'}.</p>
                                {(bulkSearchQuery || bulkSelectedDept) && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setBulkSearchQuery('');
                                      setBulkSelectedDept('');
                                    }}
                                    className="text-indigo-600 font-semibold underline text-xs cursor-pointer hover:text-indigo-800"
                                  >
                                    Reset search & department filter
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          {bulkSelectedEmployees.length > 0 && (
                            <div className="text-[11px] font-semibold text-indigo-600 bg-indigo-50/50 border border-indigo-100/50 px-3 py-1.5 rounded-lg">
                              Selected: {bulkSelectedEmployees.length} employee(s)
                            </div>
                          )}
                        </div>

                        {/* Step 3: Common Parameters */}
                        <div className="bg-slate-50/80 border border-slate-200/50 p-5 rounded-xl space-y-4">
                          <span className="text-[9px] font-semibold uppercase bg-slate-900 text-white px-2 py-0.5 rounded-md">Common OT Parameters</span>
                          
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Overtime Date</label>
                              <input
                                type="date"
                                value={otDate}
                                onChange={(e) => setOtDate(e.target.value)}
                                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-hidden"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Hours</label>
                              <select
                                value={otHoursStr}
                                onChange={(e) => setOtHoursStr(e.target.value)}
                                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-hidden"
                              >
                                {Array.from({ length: 48 }, (_, i) => String((i + 1) * 0.5)).map(hrs => (
                                  <option key={hrs} value={hrs}>{hrs} Hours</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* Fooding Warning Indicator */}
                          <div className="flex items-center gap-2 p-2.5 bg-amber-50/50 border border-amber-200/40 rounded-lg text-[11px] text-amber-800 font-semibold">
                            <Coffee className="w-4 h-4 text-amber-600 shrink-0" />
                            <span>
                              Food Allowance: <strong className="text-amber-900">{calculateFooding(parseFloat(otHoursStr)) > 0 ? 'Applicable (Rs. 50)' : 'Not Applicable'}</strong>
                            </span>
                          </div>

                          <div>
                            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                              Reason for Overtime <span className="text-rose-500">*</span>
                            </label>
                            <select
                              value={reasonForOvertime}
                              onChange={(e) => setReasonForOvertime(e.target.value)}
                              className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-hidden"
                            >
                              <option value="">-- Select Reason --</option>
                              {(sheetData?.reasons || [
                                "Machine Breakdown",
                                "Urgent Shipment Demand",
                                "Quarterly Close Support",
                                "Stock Verification",
                                "Client Urgent Support",
                                "Maintenance & Cleanup",
                                "System Upgrade",
                                "Pending Audit Support"
                              ]).map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                              OPF Number <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="text"
                              placeholder="Enter mandatory OPF Number..."
                              value={remarks}
                              onChange={(e) => setRemarks(e.target.value.toUpperCase())}
                              onBlur={(e) => setRemarks(e.target.value.toUpperCase())}
                              className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-hidden"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={handleAddMultipleToBulkList}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold uppercase tracking-wider text-[11px] py-2.5 rounded-xl flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:bg-slate-300 disabled:cursor-not-allowed"
                            disabled={bulkSelectedEmployees.length === 0}
                          >
                            <Plus className="w-4 h-4" /> Queue {bulkSelectedEmployees.length} Employee(s)
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Bulk list Preview Table */}
                  <div className="bg-white rounded-xl border border-slate-100 p-6 space-y-4 shadow-xs">
                    <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">Pending Batch</div>
                        <h2 className="text-base font-semibold tracking-tight text-slate-900">Entry Queue</h2>
                        <p className="text-xs text-slate-400 font-medium">Verify details and upload the mandatory batch approval file before committing.</p>
                      </div>
                      {bulkList.length > 0 && (
                        <button
                          onClick={() => setBulkList([])}
                          className="text-xs font-semibold uppercase tracking-wider text-rose-500 hover:text-rose-700 cursor-pointer"
                        >
                          Clear Queue
                        </button>
                      )}
                    </div>

                    {/* Summary counters in bulk save */}
                    {bulkList.length > 0 && (
                      <div className="grid grid-cols-3 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100 text-center animate-in fade-in duration-200">
                        <div>
                          <div className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">Total Employees</div>
                          <div className="text-sm font-semibold text-slate-800 mt-0.5">{bulkList.length}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">Hours</div>
                          <div className="text-sm font-semibold text-indigo-600 mt-0.5">{bulkList.reduce((sum, item) => sum + item.overtimeHours, 0)} Hrs</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">Meals</div>
                          <div className="text-sm font-semibold text-amber-600 mt-0.5">{bulkList.reduce((sum, item) => sum + item.foodingApplicable, 0)} Paid</div>
                        </div>
                      </div>
                    )}

                    {/* Main Bulk Table */}
                    <div className="border border-slate-100 rounded-xl overflow-x-auto bg-white shadow-3xs">
                      <table className="w-full text-left text-xs border-collapse min-w-[850px]">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-semibold uppercase tracking-wider text-[9px] select-none">
                            <th className="py-3 px-3 w-[20%]">Employee</th>
                            <th className="py-3 px-3 w-[15%]">Date</th>
                            <th className="py-3 px-3 text-center w-[12%]">Hours</th>
                            <th className="py-3 px-3 text-center w-[12%]">Fooding</th>
                            <th className="py-3 px-3 w-[22%]">Reason</th>
                            <th className="py-3 px-3 w-[14%]">OPF Number</th>
                            <th className="py-3 px-3 text-right w-[5%]">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                          {bulkList.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="py-12 text-center text-slate-400 font-medium">
                                Save queue is currently empty. Query and select an employee above.
                              </td>
                            </tr>
                          ) : (
                            bulkList.map((item, index) => (
                              <tr key={item.employeeCode + '_' + item.date + '_' + index} className="hover:bg-slate-50/80 transition-colors">
                                <td className="py-2.5 px-3">
                                  <div className="font-semibold text-slate-800">{item.employeeName}</div>
                                  <div className="text-[10px] text-slate-400 mt-0.5">{item.employeeCode} • {item.department}</div>
                                </td>
                                <td className="py-2.5 px-3">
                                  <input
                                    type="date"
                                    value={item.date}
                                    onChange={(e) => handleUpdateBulkListItem(index, { date: e.target.value })}
                                    className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-hidden focus:border-indigo-500 w-full font-medium"
                                  />
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  <select
                                    value={String(item.overtimeHours)}
                                    onChange={(e) => handleUpdateBulkListItem(index, { overtimeHours: parseFloat(e.target.value) })}
                                    className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-hidden focus:border-indigo-500 w-full text-center font-semibold text-indigo-600"
                                  >
                                    {Array.from({ length: 48 }, (_, i) => String((i + 1) * 0.5)).map(hrs => (
                                      <option key={hrs} value={hrs}>{hrs} Hrs</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  {item.foodingApplicable > 0 ? (
                                    <span className="bg-amber-50 text-amber-800 px-2 py-1 rounded-md text-[9px] font-bold border border-amber-100 block mx-auto w-max">Rs. 50 Flat</span>
                                  ) : (
                                    <span className="text-slate-400 italic font-medium">-</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3">
                                  <select
                                    value={item.reasonForOvertime}
                                    onChange={(e) => handleUpdateBulkListItem(index, { reasonForOvertime: e.target.value })}
                                    className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-hidden focus:border-indigo-500 w-full font-medium text-slate-700"
                                  >
                                    <option value="">-- Reason --</option>
                                    {(sheetData?.reasons || [
                                      "Machine Breakdown",
                                      "Urgent Shipment Demand",
                                      "Quarterly Close Support",
                                      "Stock Verification",
                                      "Client Urgent Support",
                                      "Maintenance & Cleanup",
                                      "System Upgrade",
                                      "Pending Audit Support"
                                    ]).map((opt) => (
                                      <option key={opt} value={opt}>
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="py-2.5 px-3">
                                  <input
                                    type="text"
                                    value={item.remarks}
                                    onChange={(e) => handleUpdateBulkListItem(index, { remarks: e.target.value.toUpperCase() })}
                                    placeholder="OPF Number"
                                    className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-hidden focus:border-indigo-500 w-full font-medium text-slate-700 uppercase"
                                  />
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveFromBulkList(index)}
                                    className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                    title="Remove from queue"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Single Upload Section for "Approval for OT" */}
                    {bulkList.length > 0 && (
                      <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl space-y-3 animate-in fade-in duration-200">
                        <div className="flex items-start gap-2.5">
                          <FileText className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
                          <div className="space-y-1">
                            <label className="block text-xs font-bold text-slate-800">
                              Upload Approval for OT <span className="text-rose-500">*</span>
                            </label>
                            <p className="text-[10px] text-slate-400 font-medium">
                              Upload the official approval document for this batch. It will be saved securely in Google Drive and referenced against every employee record in this batch.
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <label className="relative flex items-center justify-center px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-lg cursor-pointer transition-colors border border-indigo-100">
                            <span>{batchApprovalFile ? 'Change File' : 'Choose File'}</span>
                            <input
                              type="file"
                              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                              onChange={handleFileUpload}
                              className="hidden"
                              disabled={isUploadingFile}
                            />
                          </label>

                          {isUploadingFile && (
                            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                              <span>Uploading to Google Drive...</span>
                            </div>
                          )}

                          {!isUploadingFile && batchApprovalFile && (
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                              <span className="truncate max-w-[180px]">{batchApprovalFile.name}</span>
                            </div>
                          )}

                          {!isUploadingFile && !batchApprovalFile && (
                            <span className="text-[10px] font-bold text-rose-500/80 uppercase tracking-wide">
                              No File Uploaded
                            </span>
                          )}
                        </div>

                        {batchApprovalUrl && (
                          <div className="text-[10px] text-slate-500 font-semibold bg-emerald-50/50 border border-emerald-100 p-2.5 rounded-md truncate">
                            <span className="text-emerald-700">Drive Link: </span>
                            <a href={batchApprovalUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-emerald-900">
                              {batchApprovalUrl}
                            </a>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Bulk Save Error Display */}
                    {bulkSaveError && (
                      <div className="bg-rose-50 border border-rose-100 p-4 rounded-xl text-rose-700 text-xs font-semibold space-y-1.5 animate-in fade-in duration-200">
                        <div className="font-bold flex items-center gap-1.5 text-rose-800 text-[11px] uppercase tracking-wider">
                          <span className="text-sm">⚠️</span> Google Drive & Sheets Sync Error
                        </div>
                        <p className="font-medium whitespace-pre-wrap leading-relaxed text-slate-700 font-mono text-[10px] bg-white border border-rose-100/50 p-2.5 rounded-lg select-text max-h-[150px] overflow-y-auto">
                          {bulkSaveError}
                        </p>
                        <p className="text-[9px] text-rose-500/80 font-normal mt-1">
                          If this error mentions authorization or permission, please re-deploy your Google Apps Script with proper access version.
                        </p>
                      </div>
                    )}

                    {/* Commit Save Button */}
                    {bulkList.length > 0 && (
                      <button
                        onClick={handleSaveAllBulkRecords}
                        disabled={isSaving || isUploadingFile || !batchApprovalUrl}
                        className="w-full bg-slate-900 hover:bg-black text-white py-3 rounded-xl text-xs font-semibold uppercase tracking-wider shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Queued Logs ({bulkList.length})
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ==============================================
                B. UNIFIED ANALYTICS & LEDGER (BOTH USER & ADMIN)
                ============================================== */}
            <div className="space-y-8">
                
                {/* 1. Dynamic Admin Filters Bar */}
                <div id="filter_controls" className="bg-white rounded-xl border border-slate-100 p-6 space-y-5 shadow-xs">
                  <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                    <h3 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                      <Sliders className="w-4 h-4 text-indigo-600" />
                      Filter Records
                    </h3>
                    <button
                      onClick={() => {
                        const range = getCurrentMonthDateRange();
                        setFilters({
                          startDate: range.start,
                          endDate: range.end,
                          department: '',
                          employeeCode: '',
                          payroll: '',
                          designation: '',
                          enteredBy: '',
                          overtimeHoursOperator: 'all',
                          overtimeHoursValue: '',
                          remarks: '',
                          reasonForOvertime: '',
                        });
                      }}
                      className="text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-indigo-600 flex items-center gap-1 cursor-pointer"
                    >
                      <FilterX className="w-3.5 h-3.5" /> Reset Filters
                    </button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 text-xs">
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Start Date</label>
                      <input
                        type="date"
                        value={filters.startDate}
                        onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-slate-700"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">End Date</label>
                      <input
                        type="date"
                        value={filters.endDate}
                        onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-slate-700"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Department</label>
                      <select
                        value={filters.department}
                        onChange={(e) => setFilters(prev => ({ ...prev, department: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-slate-700"
                      >
                        <option value="">All Departments</option>
                        {filterOptions.departments.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Payroll Segment</label>
                      <select
                        value={filters.payroll}
                        onChange={(e) => setFilters(prev => ({ ...prev, payroll: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-slate-700"
                      >
                        <option value="">All Segments</option>
                        {filterOptions.payrolls.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Search Employee</label>
                      <input
                        type="text"
                        placeholder="Search whole data..."
                        value={filters.employeeCode}
                        onChange={(e) => setFilters(prev => ({ ...prev, employeeCode: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-slate-700 placeholder:text-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Designation</label>
                      <select
                        value={filters.designation}
                        onChange={(e) => setFilters(prev => ({ ...prev, designation: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-slate-700"
                      >
                        <option value="">All Designations</option>
                        {filterOptions.designations.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Entered By</label>
                      <select
                        value={filters.enteredBy}
                        onChange={(e) => setFilters(prev => ({ ...prev, enteredBy: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-slate-700"
                      >
                        <option value="">All Operators</option>
                        {filterOptions.operators.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <SearchableDropdown
                      label="Remarks (OPF)"
                      value={filters.remarks}
                      onChange={(val) => setFilters(prev => ({ ...prev, remarks: val }))}
                      options={filterOptions.remarks}
                      placeholder="Search Remarks..."
                      allLabel="All Remarks"
                    />
                    <SearchableDropdown
                      label="Reason for Overtime"
                      value={filters.reasonForOvertime}
                      onChange={(val) => setFilters(prev => ({ ...prev, reasonForOvertime: val }))}
                      options={filterOptions.reasons}
                      placeholder="Search Reasons..."
                      allLabel="All Reasons"
                    />
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Hours Limit</label>
                      <div className="flex gap-2">
                        <select
                          value={filters.overtimeHoursOperator}
                          onChange={(e) => setFilters(prev => ({ 
                            ...prev, 
                            overtimeHoursOperator: e.target.value as any,
                            overtimeHoursValue: e.target.value === 'all' ? '' : prev.overtimeHoursValue
                          }))}
                          className="px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium w-24 shrink-0 text-slate-700"
                        >
                          <option value="all">All</option>
                          <option value="gt">&gt;</option>
                          <option value="lt">&lt;</option>
                          <option value="eq">=</option>
                        </select>
                        {filters.overtimeHoursOperator !== 'all' && (
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            placeholder="Hrs"
                            value={filters.overtimeHoursValue}
                            onChange={(e) => setFilters(prev => ({ ...prev, overtimeHoursValue: e.target.value }))}
                            className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-slate-700"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Top Quick Export & Download Reports Bar (Placed below Filter Records & above KPIs) */}
                <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500 mb-0.5">Quick Export</div>
                    <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                      <Download className="w-4 h-4 text-indigo-600" />
                      Export Attendance & Overtime Reports
                    </h4>
                  </div>
                  <div className="flex flex-col items-start md:items-end gap-2 w-full md:w-auto">
                    {/* Attendance Reports Row */}
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        onClick={handleExportPDF}
                        className="bg-slate-900 hover:bg-black text-white px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer transition-all"
                        title="Download Attendance Matrix PDF"
                      >
                        <FileText className="w-3.5 h-3.5 text-blue-400" /> Attendance Report PDF
                      </button>
                      <button
                        onClick={handleExportExcel}
                        className="bg-emerald-700 hover:bg-emerald-800 text-white px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer transition-all"
                        title="Download Attendance Matrix Excel (.xlsx)"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-200" /> Attendance Report Excel
                      </button>
                    </div>
                    {/* Overtime Reports Row */}
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        onClick={handleExportOvertimePDF}
                        className="bg-indigo-700 hover:bg-indigo-800 text-white px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer transition-all"
                        title="Download Admin Overtime Report PDF (With Salaries & Combined Totals)"
                      >
                        <FileText className="w-3.5 h-3.5 text-indigo-200" /> Overtime Report PDF
                      </button>
                      <button
                        onClick={handleExportOvertimeExcel}
                        className="bg-teal-700 hover:bg-teal-800 text-white px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer transition-all"
                        title="Download Admin Overtime Report Excel (.xlsx) (With Salaries & Combined Totals)"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5 text-teal-200" /> Overtime Report Excel
                      </button>
                    </div>
                  </div>
                </div>

                {/* Real-Time Estimated Salary This Month */}
                {sheetData && (
                  <SalaryEstimatorCard employees={sheetData.employees} records={sheetData.records} />
                )}

                {/* 3. Admin Dashboard KPI Cards Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-xs flex items-center gap-3">
                    <div className="bg-slate-50 p-2 rounded-xl text-slate-600 border border-slate-100/55"><Users className="w-5 h-5" /></div>
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block leading-tight">Total Employees</span>
                      <span className="text-sm font-semibold text-slate-900 block mt-1">{dashboardKPIs.totalEmployees}</span>
                    </div>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-xs flex items-center gap-3">
                    <div className="bg-slate-50 p-2 rounded-xl text-slate-600 border border-slate-100/55"><UserCheck className="w-5 h-5" /></div>
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block leading-tight">Active Employees</span>
                      <span className="text-sm font-semibold text-slate-900 block mt-1">{dashboardKPIs.employeesWithOT}</span>
                    </div>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-xs flex items-center gap-3">
                    <div className="bg-slate-50 p-2 rounded-xl text-slate-600 border border-slate-100/55"><Clock className="w-5 h-5" /></div>
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block leading-tight">Total Hours</span>
                      <span className="text-sm font-semibold text-indigo-600 block mt-1">{dashboardKPIs.totalOTHours} Hrs <span className="text-[10px] text-slate-400 font-medium">({dashboardKPIs.averageOTHours} Avg)</span></span>
                    </div>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-xs flex items-center gap-3">
                    <div className="bg-slate-50 p-2 rounded-xl text-slate-600 border border-slate-100/55"><Coffee className="w-5 h-5" /></div>
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block leading-tight">Food Allowance</span>
                      <span className="text-sm font-semibold text-amber-600 block mt-1">{formatCurrency(dashboardKPIs.totalFoodingCost)} <span className="text-[10px] text-slate-400 font-medium">({dashboardKPIs.totalFoodingCount}x)</span></span>
                    </div>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-xs flex items-center gap-3">
                    <div className="bg-slate-50 p-2 rounded-xl text-slate-600 border border-slate-100/55"><IndianRupee className="w-5 h-5" /></div>
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block leading-tight">Overtime Cost</span>
                      <span className="text-sm font-semibold text-emerald-600 block mt-1">{formatCurrency(dashboardKPIs.totalEstimatedOTCost)}</span>
                    </div>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-xs flex items-center gap-3">
                    <div className="bg-slate-50 p-2 rounded-xl text-slate-600 border border-slate-100/55"><IndianRupee className="w-5 h-5" /></div>
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block leading-tight">Combined Cost</span>
                      <span className="text-sm font-semibold text-slate-900 block mt-1">{formatCurrency(dashboardKPIs.totalCumulativeCost)}</span>
                    </div>
                  </div>
                </div>

                {/* Additional Admin KPIs block */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-slate-50 px-4 py-3 rounded-xl border border-slate-100 text-xs flex justify-between items-center shadow-3xs">
                    <span className="font-semibold text-[10px] uppercase tracking-wider text-slate-500">Highest Overtime Department</span>
                    <span className="font-semibold text-slate-800 bg-white px-2.5 py-1 rounded-md shadow-3xs border border-slate-100 text-[11px]">{dashboardKPIs.highestOTDepartmentName}</span>
                  </div>
                  <div className="bg-slate-50 px-4 py-3 rounded-xl border border-slate-100 text-xs flex justify-between items-center shadow-3xs">
                    <span className="font-semibold text-[10px] uppercase tracking-wider text-slate-500">Highest Overtime Worker</span>
                    <span className="font-semibold text-slate-800 bg-white px-2.5 py-1 rounded-md shadow-3xs border border-slate-100 text-[11px]">{dashboardKPIs.highestOTEmployeeName}</span>
                  </div>
                </div>

                {/* 3. Dashboard Interactive Charts Visualization */}
                {sheetData && (
                  <DashboardCharts 
                    records={filteredRecords} 
                    employees={sheetData.employees} 
                    onFilterChange={handleChartFilterChange}
                  />
                )}

                {/* 4. Deep Analytics Tabs */}
                {sheetData && (
                  <AnalyticsTabs 
                    records={filteredRecords} 
                    employees={sheetData.employees} 
                    onEmployeeClick={(code) => setDrillDownCode(code)}
                  />
                )}

                {/* 5. Complete Admin Overtime records view */}
                <div className="bg-white rounded-xl border border-slate-100 p-6 space-y-4 print:p-0 print:border-none shadow-xs font-sans">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 pb-4 print:hidden">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500 mb-0.5">Overtime Ledger</div>
                      <h3 className="text-base font-semibold tracking-tight text-slate-900">Overtime Logs</h3>
                      <p className="text-xs text-slate-400 font-medium">Review, update, or remove overtime records</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={handleExportCSV}
                        className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-xl flex items-center gap-1.5 shadow-3xs cursor-pointer transition-all"
                        title="Export Raw CSV Data"
                      >
                        <Download className="w-3.5 h-3.5 text-slate-500" /> Export CSV
                      </button>
                    </div>
                  </div>

                  {/* Main Record Table */}
                  <div className="border border-slate-100 rounded-xl overflow-x-auto bg-white print:border-none shadow-3xs max-w-full">
                    <table className="w-full text-left text-xs border-collapse min-w-[900px]">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-semibold uppercase tracking-wider text-[9px] select-none whitespace-nowrap">
                          <th className="py-3 px-3 min-w-[95px]">Date</th>
                          <th className="py-3 px-3 min-w-[170px]">Employee Details</th>
                          <th className="py-3 px-3 min-w-[120px]">Department</th>
                          <th className="py-3 px-3 text-center min-w-[90px]">Overtime Hours</th>
                          <th className="py-3 px-3 text-center min-w-[95px]">Fooding</th>
                          <th className="py-3 px-3 min-w-[160px]">Reason</th>
                          <th className="py-3 px-3 min-w-[130px]">OPF Number</th>
                          <th className="py-3 px-3 text-center min-w-[100px]">Approval Link</th>
                          <th className="py-3 px-3 min-w-[90px]">Operator ID</th>
                          {appUser.type === 'Admin' && <th className="py-3 px-3 text-right print:hidden min-w-[80px]">Actions</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {filteredRecords.length === 0 ? (
                          <tr>
                            <td colSpan={appUser.type === 'Admin' ? 10 : 9} className="py-12 text-center text-slate-400 font-medium">
                              No overtime records found.
                            </td>
                          </tr>
                        ) : (
                          paginatedRecords.map(rec => (
                            <tr key={rec.rowIndex} className="hover:bg-slate-50/80 transition-colors">
                              <td className="py-3 px-3 font-semibold text-slate-800 whitespace-nowrap min-w-[95px]">{formatDateToDDMMYYYY(rec.date)}</td>
                              <td className="py-3 px-3 min-w-[170px]">
                                <div className="font-semibold text-slate-900 break-words whitespace-normal">{formatToProperTitleCase(rec.employeeName)}</div>
                                <div className="text-[10px] text-slate-400 mt-0.5 font-medium break-words whitespace-normal">{formatEmployeeCode(rec.employeeCode)} • {formatToProperTitleCase(rec.designation)}</div>
                              </td>
                              <td className="py-3 px-3 text-slate-500 font-semibold min-w-[120px] break-words whitespace-normal">{formatToProperTitleCase(rec.department)}</td>
                              <td className="py-3 px-3 text-center text-indigo-600 font-semibold text-sm whitespace-nowrap min-w-[90px]">{rec.overtimeHours} h</td>
                              <td className="py-3 px-3 text-center whitespace-nowrap min-w-[95px]">
                                {rec.foodingApplicable > 0 ? (
                                  <span className="bg-amber-50 text-amber-800 px-2 py-0.5 rounded-md text-[9px] font-semibold border border-amber-100 inline-block whitespace-nowrap">Rs. 50 Flat</span>
                                ) : (
                                  <span className="text-slate-400 italic font-medium">-</span>
                                )}
                              </td>
                              <td className="py-3 px-3 text-indigo-700 font-semibold min-w-[160px] break-words whitespace-normal">{rec.reasonForOvertime || <span className="text-slate-300 italic">-</span>}</td>
                              <td className="py-3 px-3 text-slate-500 min-w-[130px] break-words whitespace-normal" title={rec.remarks}>{rec.remarks || <span className="text-slate-400 italic">-</span>}</td>
                              <td className="py-3 px-3 text-center whitespace-nowrap min-w-[100px]">
                                {rec.approvalForOT ? (
                                  <a 
                                    href={rec.approvalForOT} 
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 hover:text-indigo-800 px-2 py-1 rounded-md transition-colors"
                                  >
                                    <Eye className="w-3.5 h-3.5" /> View
                                  </a>
                                ) : (
                                  <span className="text-slate-400 italic font-medium text-[10px]">No link</span>
                                )}
                              </td>
                              <td className="py-3 px-3 text-slate-400 text-[10px] font-medium whitespace-nowrap min-w-[90px]">{rec.enteredBy}</td>
                              {appUser.type === 'Admin' && (
                                <td className="py-3 px-3 text-right print:hidden whitespace-nowrap min-w-[80px]">
                                  <button
                                    onClick={() => handleOpenEditRecord(rec)}
                                    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg inline-block mr-1 cursor-pointer transition-colors"
                                    title="Edit entry"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteRecord(rec)}
                                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg inline-block cursor-pointer transition-colors"
                                    title="Delete entry"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination Controls Bar */}
                  {filteredRecords.length > 0 && (
                    <div className="flex flex-col gap-2.5 pt-3 border-t border-slate-100 text-xs text-slate-500 font-medium print:hidden">
                      {/* Top line: Entry counter & Rows per page selector */}
                      <div className="flex flex-wrap items-center gap-3">
                        <span>
                          Showing <span className="font-semibold text-slate-800">{startEntry}</span> to{' '}
                          <span className="font-semibold text-slate-800">{endEntry}</span> of{' '}
                          <span className="font-semibold text-slate-800">{filteredRecords.length}</span> entries
                        </span>
                        <div className="flex items-center gap-1.5 ml-2 border-l border-slate-200 pl-3">
                          <label htmlFor="pageSizeSelect" className="text-slate-400 font-normal">Rows per page:</label>
                          <select
                            id="pageSizeSelect"
                            value={pageSize}
                            onChange={(e) => {
                              const val = e.target.value === 'all' ? 'all' : Number(e.target.value);
                              setPageSize(val);
                              setCurrentPage(1);
                            }}
                            className="bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-2 py-1 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                          >
                            <option value={10}>10</option>
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                            <option value="all">All ({filteredRecords.length})</option>
                          </select>
                        </div>
                      </div>

                      {/* Below line: Page Navigation Buttons */}
                      {pageSize !== 'all' && totalPages > 1 && (
                        <div className="flex items-center gap-1 pt-1">
                          <button
                            onClick={() => setCurrentPage(1)}
                            disabled={validCurrentPage === 1}
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors cursor-pointer"
                            title="First Page"
                          >
                            <ChevronsLeft className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                            disabled={validCurrentPage === 1}
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors cursor-pointer"
                            title="Previous Page"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>

                          <span className="px-2 text-xs font-semibold text-slate-700">
                            Page {validCurrentPage} of {totalPages}
                          </span>

                          <button
                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                            disabled={validCurrentPage >= totalPages}
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors cursor-pointer"
                            title="Next Page"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setCurrentPage(totalPages)}
                            disabled={validCurrentPage >= totalPages}
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors cursor-pointer"
                            title="Last Page"
                          >
                            <ChevronsRight className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

            </div>

          </div>
        )}

      </main>

      {/* --- Footer Signature --- */}
      <footer className="bg-white border-t border-slate-100 py-4 mt-8 text-center text-xs text-slate-400 font-medium select-none print:hidden font-sans w-full">
        <div className="w-full px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-4">
          <span>Employee Overtime © 2026.</span>
          <span className="flex items-center gap-1">Synced with Live Google Sheets</span>
        </div>
      </footer>

      {/* ==============================================
          MODALS & OVERLAYS VIEW
          ============================================== */}

      {/* I. Employee History Drill Down Modal */}
      {drillDownCode && sheetData && (
        <EmployeeHistoryModal
          employeeCode={drillDownCode}
          employees={sheetData.employees}
          records={sheetData.records}
          onClose={() => setDrillDownCode(null)}
        />
      )}

      {/* II. Overtime Entry Edit Modal (Admin Row Modification) */}
      {editingRecord && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="relative bg-white w-full max-w-md rounded-2xl shadow-xl border border-slate-100 flex flex-col p-6 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-base font-semibold text-slate-800 mb-1 font-sans">Edit Overtime Record</h3>
            <p className="text-xs text-slate-400 mb-4 font-sans">Edit the details of this record.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">Employee Name</label>
                <div className="px-3 py-1.5 bg-slate-50 border border-slate-100 rounded-lg text-sm text-slate-600 font-semibold">{editingRecord.employeeName} ({editingRecord.employeeCode})</div>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">Overtime Hours (0.5 increments)</label>
                <select
                  value={editHoursStr}
                  onChange={(e) => setEditHoursStr(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-hidden"
                >
                  {Array.from({ length: 48 }, (_, i) => String((i + 1) * 0.5)).map(hrs => (
                    <option key={hrs} value={hrs}>{hrs} Hours</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">OT Date</label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">
                  Reason for Overtime <span className="text-rose-500">*</span>
                </label>
                <select
                  value={editReasonForOvertime}
                  onChange={(e) => setEditReasonForOvertime(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-hidden"
                >
                  <option value="">-- Select Reason --</option>
                  {(sheetData?.reasons || [
                    "Machine Breakdown",
                    "Urgent Shipment Demand",
                    "Quarterly Close Support",
                    "Stock Verification",
                    "Client Urgent Support",
                    "Maintenance & Cleanup",
                    "System Upgrade",
                    "Pending Audit Support"
                  ]).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">
                  OPF Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Enter OPF Number..."
                  value={editRemarks}
                  onChange={(e) => setEditRemarks(e.target.value.toUpperCase())}
                  onBlur={(e) => setEditRemarks(e.target.value.toUpperCase())}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">Approval Link (Drive URL)</label>
                <input
                  type="text"
                  placeholder="No Google Drive document attached"
                  value={editApprovalForOT}
                  onChange={(e) => setEditApprovalForOT(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-hidden text-slate-500"
                />
                {editApprovalForOT && (
                  <a 
                    href={editApprovalForOT} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="inline-block text-[10px] text-indigo-600 hover:text-indigo-800 font-bold underline mt-1"
                  >
                    Open Google Drive Link
                  </a>
                )}
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setEditingRecord(null)}
                className="flex-1 py-2 text-xs font-semibold text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-lg shadow-3xs cursor-pointer transition-colors"
              >
                Cancel Changes
              </button>
              <button
                onClick={handleSaveEditedRecord}
                disabled={isSaving}
                className="flex-1 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-black rounded-lg shadow-3xs disabled:opacity-50 cursor-pointer transition-colors"
              >
                {isSaving ? 'Saving...' : 'Save Updates'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Floating Overtime Tracker AI Assistant --- */}
      <AIChatAssistant sheetData={sheetData} />

    </div>
  );
}
