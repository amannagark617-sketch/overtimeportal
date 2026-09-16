import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { OvertimeRecord, Employee } from '../types';
import { formatDateToDDMMMYYYY, calculateOTCost } from './calculations';

async function saveExcelJSWorkbook(workbook: ExcelJS.Workbook, filename: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

const grandTotalBorder: Partial<ExcelJS.Borders> = {
  top: { style: 'medium', color: { argb: 'FF0F172A' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'double', color: { argb: 'FF0F172A' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

export interface ReportExportOptions {
  records: OvertimeRecord[];
  startDate?: string;
  endDate?: string;
  title?: string;
  subtitle?: string;
}

export interface OvertimeReportExportOptions extends ReportExportOptions {
  employees?: Employee[];
}

export interface EmployeeMatrixData {
  employeeCode: string;
  employeeName: string;
  designation: string;
  department: string;
  payroll: string;
  otByDate: Record<string, number>;
  foodingByDate: Record<string, number>;
  totalOT: number;
  totalFooding: number;
}

export interface OvertimeReportEmployeeData {
  employeeCode: string;
  employeeName: string;
  designation: string;
  department: string;
  payroll: string;
  basic: number;
  hra: number;
  splAllowance: number;
  conveyance: number;
  lta: number;
  otherAllowance: number;
  bonus: number;
  totalSalary: number;
  totalOTHours: number;
  totalFoodingApplicable: number;
  totalOTAmount: number;
  totalFoodingAmount: number;
  totalCombinedAmount: number;
}

export interface PayrollSummaryItem {
  payrollCategory: string;
  staffCount: number;
  totalOTHours: number;
  totalFoodingCount: number;
  totalFoodingAmount: number;
  totalOTAmount: number;
  totalCombinedAmount: number;
}

/**
 * Format string to Proper Title Case (e.g. "ramesh kumar" -> "Ramesh Kumar", "SENIOR TECHNICIAN" -> "Senior Technician")
 */
export function formatToProperTitleCase(str: string | undefined | null): string {
  if (!str) return '-';
  const trimmed = str.trim();
  if (!trimmed || trimmed === '-') return '-';

  const lower = trimmed.toLowerCase();
  if (lower === 'little nap' || lower.includes('little nap')) {
    return 'Little Nap';
  }
  if (lower === 'ciel' || lower.includes('ciel')) {
    return 'CIEL';
  }

  const upperAcronyms = new Set([
    'IT', 'HR', 'QC', 'QA', 'CIEL', 'R&D', 'CMD', 'VP', 'MD', 'GM', 'AGM', 'DGM', 'OPF', 'MIS'
  ]);

  return trimmed
    .split(/\s+/)
    .map((word) => {
      if (!word) return '';
      const upperWord = word.toUpperCase();
      if (upperAcronyms.has(upperWord)) return upperWord;

      if (word.includes('/')) {
        return word
          .split('/')
          .map((sub) => (upperAcronyms.has(sub.toUpperCase()) ? sub.toUpperCase() : sub.charAt(0).toUpperCase() + sub.slice(1).toLowerCase()))
          .join('/');
      }

      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Format Employee Code cleanly (e.g. "ln001" -> "LN001")
 */
export function formatEmployeeCode(code: string | undefined | null): string {
  if (!code) return '-';
  const trimmed = code.trim();
  if (!trimmed || trimmed === '-') return '-';
  return trimmed.toUpperCase();
}

/**
 * Priority for sorting payrolls:
 * 1. Little Nap
 * 2. CIEL
 * 3. Others
 */
export function getPayrollPriority(payroll: string | undefined): number {
  if (!payroll) return 3;
  const p = payroll.trim().toLowerCase();
  if (p === 'little nap' || p.startsWith('little nap') || p.includes('little nap')) return 1;
  if (p === 'ciel' || p.startsWith('ciel') || p.includes('ciel')) return 2;
  return 3; // Others
}

export function comparePayrollAndName<T extends { payroll?: string; employeeName?: string }>(a: T, b: T): number {
  const prioA = getPayrollPriority(a.payroll);
  const prioB = getPayrollPriority(b.payroll);
  if (prioA !== prioB) {
    return prioA - prioB;
  }
  const nameA = (a.employeeName || '').trim();
  const nameB = (b.employeeName || '').trim();
  return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
}

/**
 * Extract sorted list of YYYY-MM-DD date strings for the selected range or records
 */
export function getSortedDateList(records: OvertimeRecord[], startDate?: string, endDate?: string): string[] {
  let dates: string[] = [];

  if (startDate && endDate && startDate <= endDate) {
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    const current = new Date(start);

    let count = 0;
    while (current <= end && count < 62) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      const day = String(current.getDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${day}`);
      current.setDate(current.getDate() + 1);
      count++;
    }
  }

  if (dates.length === 0) {
    const uniqueSet = new Set<string>();
    records.forEach((r) => {
      if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
        uniqueSet.add(r.date);
      }
    });
    dates = Array.from(uniqueSet).sort();
  }

  if (dates.length === 0) {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const daysInMonth = new Date(year, today.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = String(d).padStart(2, '0');
      dates.push(`${year}-${month}-${dayStr}`);
    }
  }

  return dates;
}

/**
 * Aggregate overtime records into matrix structure per employee sorted by Little Nap -> CIEL -> Others, then Name A-Z
 */
export function buildEmployeeMatrixData(records: OvertimeRecord[]): EmployeeMatrixData[] {
  const map = new Map<string, EmployeeMatrixData>();

  records.forEach((r) => {
    const rawCode = formatEmployeeCode(r.employeeCode);
    const rawName = formatToProperTitleCase(r.employeeName);
    const key = (rawCode !== '-' ? rawCode : rawName).toUpperCase();

    if (!map.has(key)) {
      map.set(key, {
        employeeCode: rawCode,
        employeeName: rawName,
        designation: formatToProperTitleCase(r.designation),
        department: formatToProperTitleCase(r.department),
        payroll: formatToProperTitleCase(r.payroll),
        otByDate: {},
        foodingByDate: {},
        totalOT: 0,
        totalFooding: 0
      });
    }

    const emp = map.get(key)!;
    const dateKey = r.date;
    const ot = Number(r.overtimeHours) || 0;
    const fooding = r.foodingApplicable > 0 ? 1 : 0;

    if (dateKey) {
      emp.otByDate[dateKey] = (emp.otByDate[dateKey] || 0) + ot;
      emp.foodingByDate[dateKey] = (emp.foodingByDate[dateKey] || 0) + fooding;
    }
    emp.totalOT += ot;
    emp.totalFooding += fooding;
  });

  return Array.from(map.values()).sort(comparePayrollAndName);
}

/**
 * Build aggregated data for the Admin Overtime Report
 */
export function buildOvertimeReportData(
  records: OvertimeRecord[],
  employees: Employee[] = []
): {
  employeeList: OvertimeReportEmployeeData[];
  payrollSummary: PayrollSummaryItem[];
} {
  const empMap = new Map<string, Employee>();
  employees.forEach((e) => {
    if (e.employeeCode) empMap.set(e.employeeCode.trim().toUpperCase(), e);
  });

  const map = new Map<string, OvertimeReportEmployeeData>();

  records.forEach((r) => {
    const rawCode = formatEmployeeCode(r.employeeCode);
    const rawName = formatToProperTitleCase(r.employeeName);
    const codeKey = (rawCode !== '-' ? rawCode : rawName).toUpperCase();
    const empMaster = empMap.get(codeKey);

    if (!map.has(codeKey)) {
      const basic = r.basic ?? empMaster?.basic ?? 0;
      const hra = r.hra ?? empMaster?.hra ?? 0;
      const splAllowance = r.splAllowance ?? empMaster?.splAllowance ?? 0;
      const conveyance = r.conveyance ?? empMaster?.conveyance ?? 0;
      const lta = r.lta ?? empMaster?.lta ?? 0;
      const otherAllowance = r.otherAllowance ?? empMaster?.otherAllowance ?? 0;
      const bonus = r.bonus ?? empMaster?.bonus ?? 0;
      const totalSalary = r.totalSalary ?? empMaster?.totalSalary ?? (basic + hra + splAllowance + conveyance + lta + otherAllowance + bonus);

      map.set(codeKey, {
        employeeCode: rawCode !== '-' ? rawCode : formatEmployeeCode(empMaster?.employeeCode),
        employeeName: rawName !== '-' ? rawName : formatToProperTitleCase(empMaster?.employeeName),
        designation: formatToProperTitleCase(r.designation || empMaster?.designation),
        department: formatToProperTitleCase(r.department || empMaster?.department),
        payroll: formatToProperTitleCase(r.payroll || empMaster?.payroll),
        basic,
        hra,
        splAllowance,
        conveyance,
        lta,
        otherAllowance,
        bonus,
        totalSalary,
        totalOTHours: 0,
        totalFoodingApplicable: 0,
        totalOTAmount: 0,
        totalFoodingAmount: 0,
        totalCombinedAmount: 0,
      });
    }

    const item = map.get(codeKey)!;
    const ot = Number(r.overtimeHours) || 0;
    const fooding = r.foodingApplicable > 0 ? 1 : 0;
    const otCost = r.precomputedOTCost ?? calculateOTCost(r, ot, r.date);

    item.totalOTHours += ot;
    item.totalFoodingApplicable += fooding;
    item.totalOTAmount += otCost;
  });

  const employeeList = Array.from(map.values()).map((item) => {
    const totalFoodingAmount = item.totalFoodingApplicable * 50;
    const totalCombinedAmount = item.totalOTAmount + totalFoodingAmount;
    return {
      ...item,
      totalFoodingAmount,
      totalCombinedAmount,
    };
  });

  // Sort by Little Nap -> CIEL -> Others, then Name A-Z
  employeeList.sort(comparePayrollAndName);

  // Payroll Summary
  const summaryCategories: Record<string, PayrollSummaryItem> = {
    'Little Nap': { payrollCategory: 'Little Nap', staffCount: 0, totalOTHours: 0, totalFoodingCount: 0, totalFoodingAmount: 0, totalOTAmount: 0, totalCombinedAmount: 0 },
    'CIEL': { payrollCategory: 'CIEL', staffCount: 0, totalOTHours: 0, totalFoodingCount: 0, totalFoodingAmount: 0, totalOTAmount: 0, totalCombinedAmount: 0 },
    'Others': { payrollCategory: 'Others', staffCount: 0, totalOTHours: 0, totalFoodingCount: 0, totalFoodingAmount: 0, totalOTAmount: 0, totalCombinedAmount: 0 },
  };

  employeeList.forEach((emp) => {
    const prio = getPayrollPriority(emp.payroll);
    let catKey = 'Others';
    if (prio === 1) catKey = 'Little Nap';
    else if (prio === 2) catKey = 'CIEL';

    const cat = summaryCategories[catKey];
    cat.staffCount += 1;
    cat.totalOTHours += emp.totalOTHours;
    cat.totalFoodingCount += emp.totalFoodingApplicable;
    cat.totalFoodingAmount += emp.totalFoodingAmount;
    cat.totalOTAmount += emp.totalOTAmount;
    cat.totalCombinedAmount += emp.totalCombinedAmount;
  });

  const payrollSummary = [
    summaryCategories['Little Nap'],
    summaryCategories['CIEL'],
    summaryCategories['Others'],
  ];

  return { employeeList, payrollSummary };
}

/**
 * Format date range display string using Month as Text DD-MMM-YYYY format
 */
function getDateRangeLabel(startDate?: string, endDate?: string): string {
  if (startDate && endDate) {
    if (startDate === endDate) {
      return formatDateToDDMMMYYYY(startDate);
    }
    return `${formatDateToDDMMMYYYY(startDate)} to ${formatDateToDDMMMYYYY(endDate)}`;
  } else if (startDate) {
    return `From ${formatDateToDDMMMYYYY(startDate)}`;
  } else if (endDate) {
    return `Up to ${formatDateToDDMMMYYYY(endDate)}`;
  }
  return 'All Selected Dates';
}

/**
 * Helper to parse day display string (e.g., '1', '2', '31')
 */
function getDayNumberDisplay(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return String(parseInt(parts[2], 10));
  }
  return dateStr;
}

/**
 * Helper to format numbers with Indian comma separation without currency symbol
 */
function formatIndianNumber(amount: number): string {
  return Math.round(amount).toLocaleString('en-IN');
}

/**
 * Generates Matrix Attendance Sheet PDF in Navy & Gray palette
 */
export async function generatePDFReport({
  records,
  startDate,
  endDate,
  title = 'LITTLE NAP RECLINERS',
  subtitle = 'WORKFORCE ATTENDANCE MATRIX REPORT'
}: ReportExportOptions): Promise<void> {
  const dateList = getSortedDateList(records, startDate, endDate);
  const matrixData = buildEmployeeMatrixData(records);
  const dateRangeLabel = getDateRangeLabel(startDate, endDate);

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const navyDark: [number, number, number] = [15, 23, 42];
  const navyMedium: [number, number, number] = [30, 41, 59];
  const grayLight: [number, number, number] = [248, 250, 252];
  const grayBorder: [number, number, number] = [226, 232, 240];
  const textDark: [number, number, number] = [15, 23, 42];
  const textMuted: [number, number, number] = [100, 116, 139];

  doc.setFillColor(navyDark[0], navyDark[1], navyDark[2]);
  doc.rect(0, 0, 297, 24, 'F');

  doc.setFillColor(59, 130, 246);
  doc.rect(0, 24, 297, 1.2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(title, 10, 9.5);

  doc.setFontSize(9.5);
  doc.setTextColor(226, 232, 240);
  doc.text(subtitle, 10, 15.5);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225);
  doc.text(`DATE RANGE: ${dateRangeLabel}   |   TOTAL EMPLOYEES: ${matrixData.length}`, 10, 21.0);

  const overallOT = matrixData.reduce((sum, emp) => sum + emp.totalOT, 0);
  const overallFooding = matrixData.reduce((sum, emp) => sum + emp.totalFooding, 0);

  doc.setFillColor(grayLight[0], grayLight[1], grayLight[2]);
  doc.setDrawColor(grayBorder[0], grayBorder[1], grayBorder[2]);
  doc.roundedRect(10, 27.5, 277, 9.0, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.0);
  doc.setTextColor(navyMedium[0], navyMedium[1], navyMedium[2]);

  doc.text(`Total Staff: `, 14, 33.2);
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text(`${matrixData.length}`, 34, 33.2);

  doc.setTextColor(navyMedium[0], navyMedium[1], navyMedium[2]);
  doc.text(`Total Overtime: `, 75, 33.2);
  doc.setTextColor(30, 58, 138);
  doc.text(`${overallOT} Hrs`, 103, 33.2);

  doc.setTextColor(navyMedium[0], navyMedium[1], navyMedium[2]);
  doc.text(`Total Fooding: `, 155, 33.2);
  doc.setTextColor(180, 83, 9);
  doc.text(`${overallFooding}`, 182, 33.2);

  const dayHeaders = dateList.map((d) => getDayNumberDisplay(d));
  const tableHeaders = [
    'Code',
    'Employee Name',
    'Designation',
    'Dept',
    'Payroll',
    ...dayHeaders,
    'Total\nOT',
    'Total\nFooding'
  ];

  const tableBody = matrixData.map((emp) => {
    const dayCells = dateList.map((dateStr) => {
      const ot = emp.otByDate[dateStr];
      return ot && ot > 0 ? `${ot}` : '-';
    });

    return [
      emp.employeeCode,
      emp.employeeName,
      emp.designation,
      emp.department,
      emp.payroll,
      ...dayCells,
      `${emp.totalOT}`,
      `${emp.totalFooding}`
    ];
  });

  const dateTotals = dateList.map((dateStr) => {
    const sumDateOT = matrixData.reduce((acc, emp) => acc + (emp.otByDate[dateStr] || 0), 0);
    return sumDateOT > 0 ? `${sumDateOT}` : '-';
  });

  const tableFoot = [
    [
      { content: `GRAND TOTALS (${matrixData.length} Staff)`, colSpan: 5, styles: { halign: 'left' as const, fontStyle: 'bold' as const } },
      ...dateTotals,
      `${overallOT}`,
      `${overallFooding}`
    ]
  ];

  const codeWidth = 14;
  const nameWidth = 25;
  const desigWidth = 18;
  const deptWidth = 14;
  const payrollWidth = 13;
  const otTotalWidth = 12;
  const foodingTotalWidth = 13;

  const totalFixedColsWidth = codeWidth + nameWidth + desigWidth + deptWidth + payrollWidth + otTotalWidth + foodingTotalWidth;
  const printableWidth = 297 - 12;
  const remainingWidthForDays = printableWidth - totalFixedColsWidth;

  const numDays = dateList.length;
  const eachDayWidth = Math.max(4.2, remainingWidthForDays / Math.max(1, numDays));

  let fontSize = 6.2;
  let cellPadding = 1.0;
  let minCellHeight = 5.5;

  if (numDays > 25) {
    fontSize = 5.2;
    cellPadding = 0.8;
    minCellHeight = 4.8;
  } else if (numDays > 15) {
    fontSize = 5.7;
    cellPadding = 0.9;
    minCellHeight = 5.2;
  }

  const columnStylesObj: Record<number, any> = {
    0: { halign: 'left', cellWidth: codeWidth },
    1: { halign: 'left', cellWidth: nameWidth },
    2: { halign: 'left', cellWidth: desigWidth },
    3: { halign: 'left', cellWidth: deptWidth },
    4: { halign: 'left', cellWidth: payrollWidth }
  };

  for (let i = 0; i < numDays; i++) {
    columnStylesObj[5 + i] = {
      halign: 'center',
      cellWidth: eachDayWidth,
      cellPadding: { top: cellPadding, bottom: cellPadding, left: 0.1, right: 0.1 }
    };
  }

  const totalOtColIdx = 5 + numDays;
  const totalFoodingColIdx = 6 + numDays;
  columnStylesObj[totalOtColIdx] = { halign: 'center', cellWidth: otTotalWidth, fontStyle: 'bold', fillColor: [241, 245, 249] };
  columnStylesObj[totalFoodingColIdx] = { halign: 'center', cellWidth: foodingTotalWidth, fontStyle: 'bold', fillColor: [254, 243, 199] };

  autoTable(doc, {
    head: [tableHeaders],
    body: tableBody,
    foot: tableFoot,
    showFoot: 'lastPage',
    startY: 39,
    margin: { left: 6, right: 6, top: 10, bottom: 12 },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: fontSize,
      cellPadding: cellPadding,
      minCellHeight: minCellHeight,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.12,
      halign: 'center',
      valign: 'middle',
      overflow: 'linebreak'
    },
    headStyles: {
      fillColor: navyMedium,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: fontSize + 0.3,
      cellPadding: cellPadding + 0.3,
      halign: 'center',
      valign: 'middle',
      overflow: 'linebreak'
    },
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: navyDark,
      fontStyle: 'bold',
      fontSize: fontSize + 0.3,
      cellPadding: cellPadding + 0.3,
      lineColor: [203, 213, 225],
      lineWidth: 0.2,
      halign: 'center',
      valign: 'middle'
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    },
    columnStyles: columnStylesObj,
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        doc.setFillColor(navyDark[0], navyDark[1], navyDark[2]);
        doc.rect(0, 0, 297, 7.5, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.text(`${title} - ${subtitle} (${dateRangeLabel})`, 10, 5);
      }

      const totalPages = (doc as any).internal.getNumberOfPages();
      doc.setFontSize(7.0);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
      doc.text(
        `Page ${data.pageNumber} of ${totalPages}   |   Little Nap Recliners Internal Attendance Report`,
        10,
        205
      );
    }
  });

  const filename = `Attendance_Matrix_Report_${startDate || 'all'}_to_${endDate || 'all'}.pdf`;
  doc.save(filename);
}

/**
 * Generates Matrix Attendance Excel (.xlsx) Report in Navy & Gray styling with ExcelJS
 */
export async function generateExcelReport({
  records,
  startDate,
  endDate,
  title = 'LITTLE NAP RECLINERS',
  subtitle = 'WORKFORCE ATTENDANCE MATRIX REPORT'
}: ReportExportOptions): Promise<void> {
  const dateList = getSortedDateList(records, startDate, endDate);
  const matrixData = buildEmployeeMatrixData(records);
  const dateRangeLabel = getDateRangeLabel(startDate, endDate);

  const overallOT = matrixData.reduce((sum, emp) => sum + emp.totalOT, 0);
  const overallFooding = matrixData.reduce((sum, emp) => sum + emp.totalFooding, 0);

  const dayHeaders = dateList.map((d) => `${getDayNumberDisplay(d)} (${formatDateToDDMMMYYYY(d)})`);
  const headers = [
    'Employee Code',
    'Employee Name',
    'Designation',
    'Department',
    'Payroll',
    ...dayHeaders,
    'Total OT Hours',
    'Total Fooding'
  ];

  const totalCols = headers.length;
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Attendance Matrix', {
    views: [{ showGridLines: true }]
  });

  // Set column widths
  worksheet.columns = [
    { width: 18 },
    { width: 28 },
    { width: 22 },
    { width: 18 },
    { width: 16 },
    ...dateList.map(() => ({ width: 16 })),
    { width: 18 },
    { width: 16 }
  ];

  // Row 1: Title
  const r1 = worksheet.getRow(1);
  r1.height = 32;
  worksheet.mergeCells(1, 1, 1, totalCols);
  const cellA1 = worksheet.getCell(1, 1);
  cellA1.value = title;
  cellA1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  cellA1.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  cellA1.alignment = { horizontal: 'center', vertical: 'middle' };

  // Row 2: Subtitle
  const r2 = worksheet.getRow(2);
  r2.height = 24;
  worksheet.mergeCells(2, 1, 2, totalCols);
  const cellA2 = worksheet.getCell(2, 1);
  cellA2.value = subtitle;
  cellA2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
  cellA2.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  cellA2.alignment = { horizontal: 'center', vertical: 'middle' };

  // Row 3: Date Range
  const r3 = worksheet.getRow(3);
  r3.height = 20;
  worksheet.mergeCells(3, 1, 3, totalCols);
  const cellA3 = worksheet.getCell(3, 1);
  cellA3.value = `Date Range: ${dateRangeLabel}`;
  cellA3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } };
  cellA3.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FFF8FAFC' } };
  cellA3.alignment = { horizontal: 'center', vertical: 'middle' };

  // Row 4: Summary Info bar
  const r4 = worksheet.getRow(4);
  r4.height = 22;
  worksheet.mergeCells(4, 1, 4, 3);
  const c4_1 = worksheet.getCell(4, 1);
  c4_1.value = `Total Active Staff: ${matrixData.length}`;
  c4_1.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
  c4_1.alignment = { horizontal: 'left', vertical: 'middle' };

  const colOt = 6;
  const c4_ot = worksheet.getCell(4, colOt);
  c4_ot.value = `Total Overtime: ${overallOT} Hrs`;
  c4_ot.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };

  const colFood = totalCols;
  const c4_food = worksheet.getCell(4, colFood);
  c4_food.value = `Total Fooding: ${overallFooding}`;
  c4_food.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };

  for (let col = 1; col <= totalCols; col++) {
    const c = worksheet.getCell(4, col);
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    c.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
  }

  // Row 5: Spacing
  worksheet.getRow(5).height = 12;

  // Row 6: Table Headers
  const headerRow = worksheet.getRow(6);
  headerRow.height = 32;
  headers.forEach((h, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = h;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF475569' } },
      bottom: { style: 'thin', color: { argb: 'FF475569' } },
      left: { style: 'thin', color: { argb: 'FF475569' } },
      right: { style: 'thin', color: { argb: 'FF475569' } }
    };
  });

  // Data Rows (Row 7 to 6 + N)
  matrixData.forEach((emp, rIdx) => {
    const rowNum = 7 + rIdx;
    const row = worksheet.getRow(rowNum);
    row.height = 20;

    const isOdd = rIdx % 2 === 1;
    const rowBg = isOdd ? 'FFF8FAFC' : 'FFFFFFFF';

    const dayCells = dateList.map((dateStr) => emp.otByDate[dateStr] || 0);
    const rowValues = [
      emp.employeeCode,
      emp.employeeName,
      emp.designation,
      emp.department,
      emp.payroll,
      ...dayCells,
      emp.totalOT,
      emp.totalFooding
    ];

    rowValues.forEach((val, cIdx) => {
      const colNum = cIdx + 1;
      const cell = row.getCell(colNum);
      cell.value = val;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
      cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };
      cell.border = thinBorder;

      if (colNum === 1) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (colNum >= 2 && colNum <= 4) {
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      } else if (colNum === 5) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (colNum >= 6 && colNum <= 5 + dateList.length) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.numFmt = '0.0';
      } else if (colNum === 6 + dateList.length) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1E293B' } };
        cell.numFmt = '#,##0.0';
      } else if (colNum === 7 + dateList.length) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1E293B' } };
        cell.numFmt = '#,##0';
      }
    });
  });

  // Grand Total Row (Row 7 + N)
  const gtRowIndex = 7 + matrixData.length;
  const gtRow = worksheet.getRow(gtRowIndex);
  gtRow.height = 26;

  worksheet.mergeCells(gtRowIndex, 1, gtRowIndex, 5);
  const cellGtLabel = gtRow.getCell(1);
  cellGtLabel.value = `GRAND TOTALS (Staff: ${matrixData.length})`;
  cellGtLabel.alignment = { horizontal: 'left', vertical: 'middle' };

  const dateTotals = dateList.map((dateStr) =>
    matrixData.reduce((acc, emp) => acc + (emp.otByDate[dateStr] || 0), 0)
  );

  const gtValues = [...dateTotals, overallOT, overallFooding];
  gtValues.forEach((val, idx) => {
    const colNum = 6 + idx;
    const cell = gtRow.getCell(colNum);
    cell.value = val;
    if (colNum <= 5 + dateList.length || colNum === 6 + dateList.length) {
      cell.numFmt = '#,##0.0';
    } else {
      cell.numFmt = '#,##0';
    }
  });

  for (let c = 1; c <= totalCols; c++) {
    const cell = gtRow.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.border = grandTotalBorder;
    if (c >= 6) {
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
  }

  const filename = `Attendance_Matrix_Report_${startDate || 'all'}_to_${endDate || 'all'}.xlsx`;
  await saveExcelJSWorkbook(workbook, filename);
}

/**
 * Generates Admin Overtime PDF Report with 18 columns + Payroll Summary
 */
export async function generateOvertimePDFReport({
  records,
  employees = [],
  startDate,
  endDate,
  title = 'LITTLE NAP RECLINERS',
  subtitle = 'ADMIN WORKFORCE OVERTIME REPORT'
}: OvertimeReportExportOptions): Promise<void> {
  const { employeeList, payrollSummary } = buildOvertimeReportData(records, employees);
  const dateRangeLabel = getDateRangeLabel(startDate, endDate);

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const navyDark: [number, number, number] = [15, 23, 42];
  const navyMedium: [number, number, number] = [30, 41, 59];
  const grayLight: [number, number, number] = [248, 250, 252];
  const grayBorder: [number, number, number] = [226, 232, 240];
  const textDark: [number, number, number] = [15, 23, 42];
  const textMuted: [number, number, number] = [100, 116, 139];

  // Header Banner
  doc.setFillColor(navyDark[0], navyDark[1], navyDark[2]);
  doc.rect(0, 0, 297, 24, 'F');

  doc.setFillColor(79, 70, 229); // Indigo Accent
  doc.rect(0, 24, 297, 1.2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(title, 10, 9.5);

  doc.setFontSize(9.5);
  doc.setTextColor(226, 232, 240);
  doc.text(subtitle, 10, 15.5);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225);
  doc.text(`DATE RANGE: ${dateRangeLabel}   |   TOTAL ACTIVE WORKERS: ${employeeList.length}`, 10, 21.0);

  // Overall KPI sums
  const grandOTHours = employeeList.reduce((sum, e) => sum + e.totalOTHours, 0);
  const grandFoodingCount = employeeList.reduce((sum, e) => sum + e.totalFoodingApplicable, 0);
  const grandOTAmount = employeeList.reduce((sum, e) => sum + e.totalOTAmount, 0);
  const grandFoodingAmount = employeeList.reduce((sum, e) => sum + e.totalFoodingAmount, 0);
  const grandCombinedAmount = employeeList.reduce((sum, e) => sum + e.totalCombinedAmount, 0);

  // KPI Ribbon
  doc.setFillColor(grayLight[0], grayLight[1], grayLight[2]);
  doc.setDrawColor(grayBorder[0], grayBorder[1], grayBorder[2]);
  doc.roundedRect(10, 27.5, 277, 9.0, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(navyMedium[0], navyMedium[1], navyMedium[2]);

  doc.text(`Staff: `, 14, 33.2);
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text(`${employeeList.length}`, 26, 33.2);

  doc.setTextColor(navyMedium[0], navyMedium[1], navyMedium[2]);
  doc.text(`OT Hours: `, 50, 33.2);
  doc.setTextColor(30, 58, 138);
  doc.text(`${grandOTHours} Hrs`, 68, 33.2);

  doc.setTextColor(navyMedium[0], navyMedium[1], navyMedium[2]);
  doc.text(`Fooding (In Rs.): `, 105, 33.2);
  doc.setTextColor(180, 83, 9);
  doc.text(`${formatIndianNumber(grandFoodingAmount)} (${grandFoodingCount}x)`, 132, 33.2);

  doc.setTextColor(navyMedium[0], navyMedium[1], navyMedium[2]);
  doc.text(`OT Amount (In Rs.): `, 175, 33.2);
  doc.setTextColor(16, 185, 129);
  doc.text(`${formatIndianNumber(grandOTAmount)}`, 207, 33.2);

  doc.setTextColor(navyMedium[0], navyMedium[1], navyMedium[2]);
  doc.text(`Combined (In Rs.): `, 238, 33.2);
  doc.setTextColor(79, 70, 229);
  doc.text(`${formatIndianNumber(grandCombinedAmount)}`, 268, 33.2);

  // 18 Table Headers with (In Rs.)
  const headers18 = [
    'Emp Code',
    'Employee Name',
    'Designation',
    'Dept',
    'Payroll',
    'Basic\n(In Rs.)',
    'HRA\n(In Rs.)',
    'Spl All.\n(In Rs.)',
    'Conv.\n(In Rs.)',
    'LTA\n(In Rs.)',
    'Other All.\n(In Rs.)',
    'Bonus\n(In Rs.)',
    'Total Sal.\n(In Rs.)',
    'OT Hours',
    'Fooding',
    'OT Amount\n(In Rs.)',
    'Food Amount\n(In Rs.)',
    'Combined\n(In Rs.)'
  ];

  const body18 = employeeList.map((e) => [
    e.employeeCode,
    e.employeeName,
    e.designation,
    e.department,
    e.payroll,
    formatIndianNumber(e.basic),
    formatIndianNumber(e.hra),
    formatIndianNumber(e.splAllowance),
    formatIndianNumber(e.conveyance),
    formatIndianNumber(e.lta),
    formatIndianNumber(e.otherAllowance),
    formatIndianNumber(e.bonus),
    formatIndianNumber(e.totalSalary),
    `${e.totalOTHours} Hrs`,
    `${e.totalFoodingApplicable}`,
    formatIndianNumber(e.totalOTAmount),
    formatIndianNumber(e.totalFoodingAmount),
    formatIndianNumber(e.totalCombinedAmount),
  ]);

  const grandBasic = employeeList.reduce((sum, e) => sum + e.basic, 0);
  const grandHRA = employeeList.reduce((sum, e) => sum + e.hra, 0);
  const grandSpl = employeeList.reduce((sum, e) => sum + e.splAllowance, 0);
  const grandConv = employeeList.reduce((sum, e) => sum + e.conveyance, 0);
  const grandLTA = employeeList.reduce((sum, e) => sum + e.lta, 0);
  const grandOther = employeeList.reduce((sum, e) => sum + e.otherAllowance, 0);
  const grandBonus = employeeList.reduce((sum, e) => sum + e.bonus, 0);
  const grandSalary = employeeList.reduce((sum, e) => sum + e.totalSalary, 0);

  const foot18 = [
    [
      { content: 'GRAND TOTALS', colSpan: 5, styles: { halign: 'left' as const, fontStyle: 'bold' as const } },
      formatIndianNumber(grandBasic),
      formatIndianNumber(grandHRA),
      formatIndianNumber(grandSpl),
      formatIndianNumber(grandConv),
      formatIndianNumber(grandLTA),
      formatIndianNumber(grandOther),
      formatIndianNumber(grandBonus),
      formatIndianNumber(grandSalary),
      `${grandOTHours} Hrs`,
      `${grandFoodingCount}`,
      formatIndianNumber(grandOTAmount),
      formatIndianNumber(grandFoodingAmount),
      formatIndianNumber(grandCombinedAmount),
    ]
  ];

  autoTable(doc, {
    head: [headers18],
    body: body18,
    foot: foot18,
    showFoot: 'lastPage',
    startY: 39,
    margin: { left: 6, right: 6, top: 10, bottom: 12 },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 5.4,
      cellPadding: 0.8,
      minCellHeight: 5.0,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.1,
      halign: 'center',
      valign: 'middle',
      overflow: 'linebreak'
    },
    headStyles: {
      fillColor: navyMedium,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 5.6,
      cellPadding: 0.9,
      halign: 'center',
      valign: 'middle',
      overflow: 'linebreak'
    },
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: navyDark,
      fontStyle: 'bold',
      fontSize: 5.6,
      cellPadding: 1.0,
      lineColor: [203, 213, 225],
      lineWidth: 0.2,
      halign: 'center'
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    },
    columnStyles: {
      0: { cellWidth: 16, halign: 'left' },
      1: { cellWidth: 25, halign: 'left' },
      2: { cellWidth: 18, halign: 'left' },
      3: { cellWidth: 15, halign: 'left' },
      4: { cellWidth: 15, halign: 'left' },
      5: { cellWidth: 15, halign: 'center' },
      6: { cellWidth: 14, halign: 'center' },
      7: { cellWidth: 14, halign: 'center' },
      8: { cellWidth: 14, halign: 'center' },
      9: { cellWidth: 14, halign: 'center' },
      10: { cellWidth: 14, halign: 'center' },
      11: { cellWidth: 14, halign: 'center' },
      12: { cellWidth: 17, halign: 'center', fontStyle: 'bold' },
      13: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
      14: { cellWidth: 14, halign: 'center' },
      15: { cellWidth: 17, halign: 'center', fontStyle: 'bold' },
      16: { cellWidth: 16, halign: 'center' },
      17: { cellWidth: 19, halign: 'center', fontStyle: 'bold', fillColor: [238, 242, 255] },
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        doc.setFillColor(navyDark[0], navyDark[1], navyDark[2]);
        doc.rect(0, 0, 297, 7.5, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.text(`${title} - ${subtitle} (${dateRangeLabel})`, 10, 5);
      }

      const totalPages = (doc as any).internal.getNumberOfPages();
      doc.setFontSize(7.0);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
      doc.text(
        `Page ${data.pageNumber} of ${totalPages}   |   Little Nap Recliners Admin Overtime Report`,
        10,
        205
      );
    }
  });

  // Render Summary Table at the end
  const finalY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 8 : 45;

  let summaryStartY = finalY;
  if (summaryStartY > 160) {
    doc.addPage();
    summaryStartY = 15;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(navyDark[0], navyDark[1], navyDark[2]);
  doc.text('PAYROLL WISE OVERTIME & FOODING SUMMARY', 10, summaryStartY);

  const summaryHeaders = [
    'Payroll Category',
    'Total Staff',
    'Total OT Hours',
    'Total Fooding Count',
    'Fooding Amount\n(In Rs.)',
    'Overtime Amount\n(In Rs.)',
    'Total Combined Amount\n(In Rs.)'
  ];

  const summaryRows = payrollSummary.map((ps) => [
    ps.payrollCategory,
    `${ps.staffCount}`,
    `${ps.totalOTHours} Hrs`,
    `${ps.totalFoodingCount}`,
    formatIndianNumber(ps.totalFoodingAmount),
    formatIndianNumber(ps.totalOTAmount),
    formatIndianNumber(ps.totalCombinedAmount),
  ]);

  const summaryFoot = [
    [
      { content: 'TOTAL SUMMARY', styles: { halign: 'left' as const, fontStyle: 'bold' as const } },
      `${employeeList.length}`,
      `${grandOTHours} Hrs`,
      `${grandFoodingCount}`,
      formatIndianNumber(grandFoodingAmount),
      formatIndianNumber(grandOTAmount),
      formatIndianNumber(grandCombinedAmount),
    ]
  ];

  autoTable(doc, {
    head: [summaryHeaders],
    body: summaryRows,
    foot: summaryFoot,
    startY: summaryStartY + 3,
    margin: { left: 10, right: 10 },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 7.0,
      cellPadding: 1.5,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.15,
      halign: 'center',
      valign: 'middle'
    },
    headStyles: {
      fillColor: navyDark,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
      halign: 'center'
    },
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: navyDark,
      fontStyle: 'bold',
      fontSize: 7.5,
      halign: 'center'
    },
    columnStyles: {
      0: { halign: 'left', fontStyle: 'bold', cellWidth: 42 },
      1: { halign: 'center', cellWidth: 32 },
      2: { halign: 'center', cellWidth: 36 },
      3: { halign: 'center', cellWidth: 36 },
      4: { halign: 'center', cellWidth: 42 },
      5: { halign: 'center', cellWidth: 44 },
      6: { halign: 'center', fontStyle: 'bold', fillColor: [238, 242, 255], cellWidth: 45 },
    }
  });

  const filename = `Overtime_Report_Admin_${startDate || 'all'}_to_${endDate || 'all'}.pdf`;
  doc.save(filename);
}

/**
 * Generates Admin Overtime Excel (.xlsx) Report with 18 columns + Payroll Summary in styled ExcelJS
 */
export async function generateOvertimeExcelReport({
  records,
  employees = [],
  startDate,
  endDate,
  title = 'LITTLE NAP RECLINERS',
  subtitle = 'ADMIN WORKFORCE OVERTIME REPORT'
}: OvertimeReportExportOptions): Promise<void> {
  const { employeeList, payrollSummary } = buildOvertimeReportData(records, employees);
  const dateRangeLabel = getDateRangeLabel(startDate, endDate);

  const grandOTHours = employeeList.reduce((sum, e) => sum + e.totalOTHours, 0);
  const grandFoodingCount = employeeList.reduce((sum, e) => sum + e.totalFoodingApplicable, 0);
  const grandOTAmount = employeeList.reduce((sum, e) => sum + e.totalOTAmount, 0);
  const grandFoodingAmount = employeeList.reduce((sum, e) => sum + e.totalFoodingAmount, 0);
  const grandCombinedAmount = employeeList.reduce((sum, e) => sum + e.totalCombinedAmount, 0);

  const grandBasic = employeeList.reduce((sum, e) => sum + e.basic, 0);
  const grandHRA = employeeList.reduce((sum, e) => sum + e.hra, 0);
  const grandSpl = employeeList.reduce((sum, e) => sum + e.splAllowance, 0);
  const grandConv = employeeList.reduce((sum, e) => sum + e.conveyance, 0);
  const grandLTA = employeeList.reduce((sum, e) => sum + e.lta, 0);
  const grandOther = employeeList.reduce((sum, e) => sum + e.otherAllowance, 0);
  const grandBonus = employeeList.reduce((sum, e) => sum + e.bonus, 0);
  const grandSalary = employeeList.reduce((sum, e) => sum + e.totalSalary, 0);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Overtime Report', {
    views: [{ showGridLines: true }]
  });

  worksheet.columns = [
    { width: 18 }, // Emp Code
    { width: 30 }, // Name
    { width: 24 }, // Designation
    { width: 20 }, // Dept
    { width: 16 }, // Payroll
    { width: 16 }, // Basic
    { width: 16 }, // HRA
    { width: 18 }, // Spl All.
    { width: 16 }, // Conv.
    { width: 16 }, // LTA
    { width: 18 }, // Other
    { width: 16 }, // Bonus
    { width: 20 }, // Total Sal
    { width: 16 }, // OT Hours
    { width: 16 }, // Fooding
    { width: 22 }, // OT Amount
    { width: 22 }, // Food Amount
    { width: 24 }, // Combined
  ];

  // Row 1: Title
  worksheet.mergeCells(1, 1, 1, 18);
  const r1 = worksheet.getRow(1);
  r1.height = 32;
  const cellA1 = worksheet.getCell(1, 1);
  cellA1.value = title;
  cellA1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  cellA1.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  cellA1.alignment = { horizontal: 'center', vertical: 'middle' };

  // Row 2: Subtitle
  worksheet.mergeCells(2, 1, 2, 18);
  const r2 = worksheet.getRow(2);
  r2.height = 24;
  const cellA2 = worksheet.getCell(2, 1);
  cellA2.value = subtitle;
  cellA2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
  cellA2.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  cellA2.alignment = { horizontal: 'center', vertical: 'middle' };

  // Row 3: Date Range
  worksheet.mergeCells(3, 1, 3, 18);
  const r3 = worksheet.getRow(3);
  r3.height = 20;
  const cellA3 = worksheet.getCell(3, 1);
  cellA3.value = `Date Range: ${dateRangeLabel}`;
  cellA3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } };
  cellA3.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FFF8FAFC' } };
  cellA3.alignment = { horizontal: 'center', vertical: 'middle' };

  // Row 4: Summary Bar
  const r4 = worksheet.getRow(4);
  r4.height = 22;
  worksheet.getCell(4, 1).value = `Total Active Staff: ${employeeList.length}`;
  worksheet.getCell(4, 6).value = `Total OT Hours: ${grandOTHours.toLocaleString('en-IN')}`;
  worksheet.getCell(4, 14).value = `Total OT Amount: Rs. ${grandOTAmount.toLocaleString('en-IN')}`;
  worksheet.getCell(4, 17).value = `Combined Total: Rs. ${grandCombinedAmount.toLocaleString('en-IN')}`;

  for (let c = 1; c <= 18; c++) {
    const cell = worksheet.getCell(4, c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
    cell.alignment = { vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
  }

  // Row 5: Spacing
  worksheet.getRow(5).height = 12;

  // Row 6: Main Headers
  const headers18 = [
    'Employee Code',
    'Employee Name',
    'Designation',
    'Department',
    'Payroll',
    'Basic\n(In Rs.)',
    'HRA\n(In Rs.)',
    'Spl Allowance\n(In Rs.)',
    'Conveyance\n(In Rs.)',
    'LTA\n(In Rs.)',
    'Other Allowance\n(In Rs.)',
    'Bonus\n(In Rs.)',
    'Total Salary\n(In Rs.)',
    'Total OT\nHours',
    'Fooding\nCount',
    'Overtime Amount\n(In Rs.)',
    'Fooding Amount\n(In Rs.)',
    'Combined Total\n(In Rs.)'
  ];

  const headerRow = worksheet.getRow(6);
  headerRow.height = 36;
  headers18.forEach((h, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = h;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF475569' } },
      bottom: { style: 'thin', color: { argb: 'FF475569' } },
      left: { style: 'thin', color: { argb: 'FF475569' } },
      right: { style: 'thin', color: { argb: 'FF475569' } }
    };
  });

  // Data Rows (Row 7 to 6 + N)
  employeeList.forEach((e, idx) => {
    const rowNum = 7 + idx;
    const row = worksheet.getRow(rowNum);
    row.height = 20;

    const isOdd = idx % 2 === 1;
    const rowBg = isOdd ? 'FFF8FAFC' : 'FFFFFFFF';

    const vals = [
      e.employeeCode,
      e.employeeName,
      e.designation,
      e.department,
      e.payroll,
      e.basic,
      e.hra,
      e.splAllowance,
      e.conveyance,
      e.lta,
      e.otherAllowance,
      e.bonus,
      e.totalSalary,
      e.totalOTHours,
      e.totalFoodingApplicable,
      e.totalOTAmount,
      e.totalFoodingAmount,
      e.totalCombinedAmount
    ];

    vals.forEach((val, cIdx) => {
      const colNum = cIdx + 1;
      const cell = row.getCell(colNum);
      cell.value = val;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colNum === 18 ? 'FFEEF2FF' : rowBg } };
      cell.font = { name: 'Calibri', size: 10, bold: colNum >= 14, color: { argb: 'FF1E293B' } };
      cell.border = thinBorder;

      if (colNum === 1 || colNum === 5) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (colNum >= 2 && colNum <= 4) {
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      } else if (colNum >= 6 && colNum <= 13) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.numFmt = '#,##0';
      } else if (colNum === 14) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.numFmt = '#,##0.0';
      } else if (colNum === 15) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.numFmt = '#,##0';
      } else if (colNum >= 16) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.numFmt = '#,##0';
      }
    });
  });

  // Grand Total Row (Row 7 + N)
  const N = employeeList.length;
  const gtRowIndex = 7 + N;
  const gtRow = worksheet.getRow(gtRowIndex);
  gtRow.height = 26;

  worksheet.mergeCells(gtRowIndex, 1, gtRowIndex, 5);
  const cellGtLabel = gtRow.getCell(1);
  cellGtLabel.value = `GRAND TOTALS (Workers: ${N})`;
  cellGtLabel.alignment = { horizontal: 'left', vertical: 'middle' };

  const gtVals = [
    grandBasic,
    grandHRA,
    grandSpl,
    grandConv,
    grandLTA,
    grandOther,
    grandBonus,
    grandSalary,
    grandOTHours,
    grandFoodingCount,
    grandOTAmount,
    grandFoodingAmount,
    grandCombinedAmount
  ];

  gtVals.forEach((val, idx) => {
    const colNum = 6 + idx;
    const cell = gtRow.getCell(colNum);
    cell.value = val;
    cell.numFmt = colNum === 14 ? '#,##0.0' : '#,##0';
  });

  for (let c = 1; c <= 18; c++) {
    const cell = gtRow.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.border = grandTotalBorder;
    if (c >= 6) {
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
  }

  // Spacing
  worksheet.getRow(8 + N).height = 12;
  worksheet.getRow(9 + N).height = 12;

  // Summary Section Header (Row 10 + N)
  const sumHeaderRowIdx = 10 + N;
  worksheet.mergeCells(sumHeaderRowIdx, 1, sumHeaderRowIdx, 7);
  const sumHeaderRow = worksheet.getRow(sumHeaderRowIdx);
  sumHeaderRow.height = 26;
  const sumHeaderCell = sumHeaderRow.getCell(1);
  sumHeaderCell.value = 'PAYROLL WISE OVERTIME & FOODING SUMMARY';
  sumHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF312E81' } };
  sumHeaderCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  sumHeaderCell.alignment = { horizontal: 'left', vertical: 'middle' };

  // Summary Column Headers (Row 11 + N)
  const sumColHeaderRowIdx = 11 + N;
  const sumColHeaderRow = worksheet.getRow(sumColHeaderRowIdx);
  sumColHeaderRow.height = 28;
  const summaryColHeaders = [
    'Payroll Category',
    'Total Staff',
    'Total OT Hours',
    'Total Fooding Count',
    'Total Fooding Amount (In Rs.)',
    'Total Overtime Amount (In Rs.)',
    'Total Combined Amount (In Rs.)'
  ];

  summaryColHeaders.forEach((sh, idx) => {
    const cell = sumColHeaderRow.getCell(idx + 1);
    cell.value = sh;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF312E81' } },
      bottom: { style: 'thin', color: { argb: 'FF312E81' } },
      left: { style: 'thin', color: { argb: 'FF312E81' } },
      right: { style: 'thin', color: { argb: 'FF312E81' } }
    };
  });

  // Summary Data Rows
  const S = payrollSummary.length;
  payrollSummary.forEach((ps, idx) => {
    const rowNum = 12 + N + idx;
    const row = worksheet.getRow(rowNum);
    row.height = 20;

    const isOdd = idx % 2 === 1;
    const rowBg = isOdd ? 'FFF8FAFC' : 'FFFFFFFF';

    const sumVals = [
      ps.payrollCategory,
      ps.staffCount,
      ps.totalOTHours,
      ps.totalFoodingCount,
      ps.totalFoodingAmount,
      ps.totalOTAmount,
      ps.totalCombinedAmount
    ];

    sumVals.forEach((val, cIdx) => {
      const colNum = cIdx + 1;
      const cell = row.getCell(colNum);
      cell.value = val;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colNum === 7 ? 'FFEEF2FF' : rowBg } };
      cell.font = { name: 'Calibri', size: 10, bold: colNum === 7, color: { argb: 'FF1E293B' } };
      cell.border = thinBorder;

      if (colNum === 1) {
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      } else {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.numFmt = colNum === 3 ? '#,##0.0' : '#,##0';
      }
    });
  });

  // Summary Total Row
  const sumTotalRowIdx = 12 + N + S;
  const sumTotalRow = worksheet.getRow(sumTotalRowIdx);
  sumTotalRow.height = 26;

  const sumTotVals = [
    'TOTAL SUMMARY',
    employeeList.length,
    grandOTHours,
    grandFoodingCount,
    grandFoodingAmount,
    grandOTAmount,
    grandCombinedAmount
  ];

  sumTotVals.forEach((val, cIdx) => {
    const colNum = cIdx + 1;
    const cell = sumTotalRow.getCell(colNum);
    cell.value = val;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.border = grandTotalBorder;

    if (colNum === 1) {
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
    } else {
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.numFmt = colNum === 3 ? '#,##0.0' : '#,##0';
    }
  });

  const filename = `Overtime_Report_Admin_${startDate || 'all'}_to_${endDate || 'all'}.xlsx`;
  await saveExcelJSWorkbook(workbook, filename);
}
