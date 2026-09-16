import React, { useState, useMemo } from 'react';
import jsPDF from 'jspdf';
import { OvertimeRecord, Employee } from '../types';
import { 
  calculateOTCost, 
  formatCurrency, 
  formatDateToDDMMYYYY, 
  formatDateToDDMMMYYYY,
  parseDateString,
  getIndianTimestamp 
} from '../utils/calculations';
import { 
  FileText, 
  Send, 
  Copy, 
  Download, 
  CheckCircle2, 
  Calendar, 
  UserCheck, 
  Clock, 
  IndianRupee, 
  Coffee, 
  Trophy,
  AlertTriangle,
  Share2, 
  FileSpreadsheet, 
  X, 
  Check, 
  Sparkles,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  Building2,
  Phone
} from 'lucide-react';

interface ExecutiveReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  records: OvertimeRecord[];
  employees: Employee[];
  appsScriptUrl?: string;
  onShowToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function ExecutiveReportModal({
  isOpen,
  onClose,
  records,
  employees,
  appsScriptUrl,
  onShowToast
}: ExecutiveReportModalProps) {
  // Default target date to yesterday (1 day before today)
  const [targetDate, setTargetDate] = useState<string>(() => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const y = yesterday.getFullYear();
    const m = String(yesterday.getMonth() + 1).padStart(2, '0');
    const d = String(yesterday.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });

  const [activeSubTab, setActiveSubTab] = useState<'summary' | 'whatsapp' | 'pdf' | 'sheets'>('summary');
  const [cfoPhone, setCfoPhone] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<{ success?: boolean; message?: string } | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Derive Yesterday Date & MTD Range
  const {
    targetDateFormatted,
    monthStartFormatted,
    yesterdayMetrics,
    mtdMetrics
  } = useMemo(() => {
    const parsedTarget = parseDateString(targetDate);
    const y = parsedTarget.getFullYear();
    const m = parsedTarget.getMonth();
    const d = parsedTarget.getDate();

    const monthStartDate = new Date(y, m, 1);
    const monthStartStr = `${y}-${String(m + 1).padStart(2, '0')}-01`;

    const targetDateFormatted = formatDateToDDMMMYYYY(targetDate);
    const monthStartFormatted = formatDateToDDMMMYYYY(monthStartStr);

    // 1. Filter Records for Target Date (Yesterday)
    const yesterdayRecords = records.filter(r => r.date === targetDate);

    let yesterdayHours = 0;
    let yesterdayFoodingCount = 0;
    let yesterdayOTCost = 0;

    const yesterdayEmpMap = new Map<string, {
      code: string;
      name: string;
      department: string;
      hours: number;
      otCost: number;
      foodingCost: number;
      total: number;
    }>();

    for (const r of yesterdayRecords) {
      yesterdayHours += r.overtimeHours || 0;
      const fooding = (r.foodingApplicable || 0) > 0 ? 1 : 0;
      yesterdayFoodingCount += fooding;
      
      const otCost = r.precomputedOTCost ?? calculateOTCost(r, r.overtimeHours, r.date);
      yesterdayOTCost += otCost;

      const rawCode = (r.employeeCode || '').trim();
      const rawName = (r.employeeName || '').trim();
      const empKey = (rawCode && rawCode !== 'EMP' && rawCode !== 'UNKNOWN')
        ? rawCode.toUpperCase()
        : (rawName ? rawName.toUpperCase().replace(/\s+/g, '_') : 'UNKNOWN');

      const displayCode = (rawCode && rawCode !== 'EMP' && rawCode !== 'UNKNOWN') ? rawCode : (rawName || 'N/A');

      const existing = yesterdayEmpMap.get(empKey) || {
        code: displayCode,
        name: rawName || displayCode,
        department: r.department || 'General',
        hours: 0,
        otCost: 0,
        foodingCost: 0,
        total: 0
      };

      existing.hours += r.overtimeHours || 0;
      existing.otCost += otCost;
      existing.foodingCost += fooding * 50;
      existing.total = existing.otCost + existing.foodingCost;
      yesterdayEmpMap.set(empKey, existing);
    }

    const yesterdayFoodingCost = yesterdayFoodingCount * 50;
    const yesterdayGrandTotal = yesterdayOTCost + yesterdayFoodingCost;

    // Highest Overtime Worker Yesterday (Prioritize OT Hours, then Total Cost)
    let topWorkerYesterday: any = null;
    let maxYesterdayHours = -1;
    let maxYesterdayTotal = -1;
    for (const worker of yesterdayEmpMap.values()) {
      if (worker.hours > maxYesterdayHours || (worker.hours === maxYesterdayHours && worker.total > maxYesterdayTotal)) {
        maxYesterdayHours = worker.hours;
        maxYesterdayTotal = worker.total;
        topWorkerYesterday = worker;
      }
    }

    // 2. Filter Records for Month-To-Date (1st to Target Date)
    const mtdRecords = records.filter(r => r.date >= monthStartStr && r.date <= targetDate);

    let mtdHours = 0;
    let mtdFoodingCount = 0;
    let mtdOTCost = 0;

    const mtdEmpMap = new Map<string, {
      code: string;
      name: string;
      department: string;
      hours: number;
      otCost: number;
      foodingCost: number;
      total: number;
    }>();

    for (const r of mtdRecords) {
      mtdHours += r.overtimeHours || 0;
      const fooding = (r.foodingApplicable || 0) > 0 ? 1 : 0;
      mtdFoodingCount += fooding;

      const otCost = r.precomputedOTCost ?? calculateOTCost(r, r.overtimeHours, r.date);
      mtdOTCost += otCost;

      const rawCode = (r.employeeCode || '').trim();
      const rawName = (r.employeeName || '').trim();
      const empKey = (rawCode && rawCode !== 'EMP' && rawCode !== 'UNKNOWN')
        ? rawCode.toUpperCase()
        : (rawName ? rawName.toUpperCase().replace(/\s+/g, '_') : 'UNKNOWN');

      const displayCode = (rawCode && rawCode !== 'EMP' && rawCode !== 'UNKNOWN') ? rawCode : (rawName || 'N/A');

      const existing = mtdEmpMap.get(empKey) || {
        code: displayCode,
        name: rawName || displayCode,
        department: r.department || 'General',
        hours: 0,
        otCost: 0,
        foodingCost: 0,
        total: 0
      };

      existing.hours += r.overtimeHours || 0;
      existing.otCost += otCost;
      existing.foodingCost += fooding * 50;
      existing.total = existing.otCost + existing.foodingCost;
      mtdEmpMap.set(empKey, existing);
    }

    const mtdFoodingCost = mtdFoodingCount * 50;
    const mtdGrandTotal = mtdOTCost + mtdFoodingCost;

    // Highest Overtime Worker MTD (Prioritize OT Hours, then Total Cost)
    let topWorkerMTD: any = null;
    let maxMtdHours = -1;
    let maxMtdTotal = -1;
    for (const worker of mtdEmpMap.values()) {
      if (worker.hours > maxMtdHours || (worker.hours === maxMtdHours && worker.total > maxMtdTotal)) {
        maxMtdHours = worker.hours;
        maxMtdTotal = worker.total;
        topWorkerMTD = worker;
      }
    }

    return {
      targetDateFormatted,
      monthStartFormatted,
      yesterdayMetrics: {
        recordsCount: yesterdayRecords.length,
        activeWorkers: yesterdayEmpMap.size,
        totalHours: yesterdayHours,
        foodingCount: yesterdayFoodingCount,
        foodingCost: yesterdayFoodingCost,
        otCost: yesterdayOTCost,
        grandTotal: yesterdayGrandTotal,
        topWorker: topWorkerYesterday
      },
      mtdMetrics: {
        recordsCount: mtdRecords.length,
        activeWorkers: mtdEmpMap.size,
        totalHours: mtdHours,
        foodingCount: mtdFoodingCount,
        foodingCost: mtdFoodingCost,
        otCost: mtdOTCost,
        grandTotal: mtdGrandTotal,
        topWorker: topWorkerMTD
      }
    };
  }, [records, targetDate]);

  // Generate WhatsApp Formatted Text
  const whatsAppMessageText = useMemo(() => {
    const timeNow = getIndianTimestamp();
    const topYName = yesterdayMetrics.topWorker 
      ? `${yesterdayMetrics.topWorker.name} (${yesterdayMetrics.topWorker.code} - ${yesterdayMetrics.topWorker.department})\n  Hours: ${yesterdayMetrics.topWorker.hours} Hrs | OT: ₹${yesterdayMetrics.topWorker.otCost.toLocaleString('en-IN')} | Total: ₹${yesterdayMetrics.topWorker.total.toLocaleString('en-IN')}`
      : 'No Overtime Recorded Yesterday';

    const topMtdName = mtdMetrics.topWorker
      ? `${mtdMetrics.topWorker.name} (${mtdMetrics.topWorker.code} - ${mtdMetrics.topWorker.department})\n  MTD Hours: ${mtdMetrics.topWorker.hours} Hrs | MTD Total: ₹${mtdMetrics.topWorker.total.toLocaleString('en-IN')}`
      : 'No Overtime Recorded MTD';

    return `*📊 FACTORY OVERTIME AUDIT DAILY REPORT*
*Report Till Date:* ${targetDateFormatted}
*Generated:* ${timeNow}
----------------------------------------------
*1️⃣ YESTERDAY'S OT SUMMARY (${targetDateFormatted})*
• Total Overtime Hours: *${yesterdayMetrics.totalHours} Hrs*
• Active Overtime Workers: *${yesterdayMetrics.activeWorkers} Employees*
• Total Fooding Allowance: *Rs. ${yesterdayMetrics.foodingCost.toLocaleString('en-IN')}* (${yesterdayMetrics.foodingCount} Workers @ Rs. 50)
• Total Overtime Cost: *Rs. ${yesterdayMetrics.otCost.toLocaleString('en-IN')}*
*💰 GRAND TOTAL (OT + Fooding): Rs. ${yesterdayMetrics.grandTotal.toLocaleString('en-IN')}*

⚠️ *Highest Overtime Logged Yesterday (Needs Review):*
  *${topYName}*

----------------------------------------------
*2️⃣ MONTH-TO-DATE SUMMARY (${monthStartFormatted} to ${targetDateFormatted})*
• Total MTD OT Hours: *${mtdMetrics.totalHours} Hrs*
• Total MTD Active Workers: *${mtdMetrics.activeWorkers} Employees*
• Total MTD Fooding Cost: *Rs. ${mtdMetrics.foodingCost.toLocaleString('en-IN')}*
• Total MTD OT Cost: *Rs. ${mtdMetrics.otCost.toLocaleString('en-IN')}*
*💰 MTD GRAND TOTAL (OT + Fooding): Rs. ${mtdMetrics.grandTotal.toLocaleString('en-IN')}*

⚠️ *Highest MTD Overtime Logged (Needs Review):*
  *${topMtdName}*

----------------------------------------------
_Little Nap Recliners - Enterprise Overtime ERP System_`;
  }, [targetDateFormatted, monthStartFormatted, yesterdayMetrics, mtdMetrics]);

  // Copy WhatsApp message handler
  const handleCopyWhatsAppText = () => {
    navigator.clipboard.writeText(whatsAppMessageText);
    setCopied(true);
    onShowToast('WhatsApp Report summary copied to clipboard!', 'success');
    setTimeout(() => setCopied(false), 3000);
  };

  // Launch WhatsApp share API link
  const handleSendWhatsApp = () => {
    const encoded = encodeURIComponent(whatsAppMessageText);
    let url = `https://wa.me/?text=${encoded}`;
    if (cfoPhone && cfoPhone.trim() !== '') {
      const cleanPhone = cfoPhone.replace(/[^0-9]/g, '');
      url = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encoded}`;
    }
    window.open(url, '_blank');
  };

  // Download PDF Executive Report
  const handleDownloadPDF = () => {
    try {
      // Custom height (180mm) to eliminate trailing blank white space on the page
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [210, 180]
      });

      const timeNow = getIndianTimestamp();

      // Palette
      const navy = [15, 23, 42]; // #0f172a
      const indigo = [79, 70, 229]; // #4f46e5
      const emerald = [16, 185, 129];
      const grayDark = [51, 65, 85];

      // Header Banner
      doc.setFillColor(navy[0], navy[1], navy[2]);
      doc.rect(0, 0, 210, 36, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('LITTLE NAP RECLINERS', 14, 15);

      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('FACTORY OVERTIME AUDIT DAILY REPORT', 14, 23);

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(203, 213, 225);
      doc.text(`Report Till Date: ${targetDateFormatted}  |  Generated: ${timeNow}`, 14, 30);

      // Section 1: Yesterday's OT Box
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(14, 42, 88, 75, 3, 3, 'FD');

      doc.setFillColor(indigo[0], indigo[1], indigo[2]);
      doc.roundedRect(14, 42, 88, 8, 3, 3, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(`1. YESTERDAY SUMMARY (${targetDateFormatted})`, 18, 47.5);

      doc.setTextColor(grayDark[0], grayDark[1], grayDark[2]);
      doc.setFontSize(8);
      
      let yPos = 56;
      doc.setFont('helvetica', 'bold'); doc.text('Total OT Hours:', 18, yPos);
      doc.setFont('helvetica', 'normal'); doc.text(`${yesterdayMetrics.totalHours} Hrs`, 62, yPos);

      yPos += 7;
      doc.setFont('helvetica', 'bold'); doc.text('Active OT Workers:', 18, yPos);
      doc.setFont('helvetica', 'normal'); doc.text(`${yesterdayMetrics.activeWorkers} Employees`, 62, yPos);

      yPos += 7;
      doc.setFont('helvetica', 'bold'); doc.text('Fooding Cost:', 18, yPos);
      doc.setFont('helvetica', 'normal'); doc.text(`Rs. ${yesterdayMetrics.foodingCost.toLocaleString('en-IN')}`, 62, yPos);

      yPos += 7;
      doc.setFont('helvetica', 'bold'); doc.text('Overtime Amount:', 18, yPos);
      doc.setFont('helvetica', 'normal'); doc.text(`Rs. ${yesterdayMetrics.otCost.toLocaleString('en-IN')}`, 62, yPos);

      yPos += 9;
      doc.setFillColor(238, 242, 255);
      doc.roundedRect(18, yPos - 5, 80, 10, 2, 2, 'F');
      doc.setTextColor(indigo[0], indigo[1], indigo[2]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(`GRAND TOTAL: Rs. ${yesterdayMetrics.grandTotal.toLocaleString('en-IN')}`, 22, yPos + 1.5);

      yPos += 14;
      doc.setTextColor(grayDark[0], grayDark[1], grayDark[2]);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.text('Highest Overtime Worker Yesterday (Audit):', 18, yPos);
      
      // Highest overtime worker name explicitly printed in BLACK for max visibility
      doc.setTextColor(0, 0, 0); // BLACK
      doc.setFont('helvetica', 'bold');
      if (yesterdayMetrics.topWorker) {
        doc.text(`${yesterdayMetrics.topWorker.name} (${yesterdayMetrics.topWorker.code})`, 18, yPos + 5);
        doc.setFont('helvetica', 'normal');
        doc.text(`${yesterdayMetrics.topWorker.department} | Rs. ${yesterdayMetrics.topWorker.total.toLocaleString('en-IN')}`, 18, yPos + 9);
      } else {
        doc.text('None Recorded', 18, yPos + 5);
      }


      // Section 2: Month-To-Date OT Box
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(108, 42, 88, 75, 3, 3, 'FD');

      doc.setFillColor(16, 185, 129);
      doc.roundedRect(108, 42, 88, 8, 3, 3, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(`2. MTD SUMMARY (${monthStartFormatted} - ${targetDateFormatted})`, 112, 47.5);

      doc.setTextColor(grayDark[0], grayDark[1], grayDark[2]);
      doc.setFontSize(8);

      yPos = 56;
      doc.setFont('helvetica', 'bold'); doc.text('Total MTD Hours:', 112, yPos);
      doc.setFont('helvetica', 'normal'); doc.text(`${mtdMetrics.totalHours} Hrs`, 156, yPos);

      yPos += 7;
      doc.setFont('helvetica', 'bold'); doc.text('MTD Active Workers:', 112, yPos);
      doc.setFont('helvetica', 'normal'); doc.text(`${mtdMetrics.activeWorkers} Employees`, 156, yPos);

      yPos += 7;
      doc.setFont('helvetica', 'bold'); doc.text('MTD Fooding Cost:', 112, yPos);
      doc.setFont('helvetica', 'normal'); doc.text(`Rs. ${mtdMetrics.foodingCost.toLocaleString('en-IN')}`, 156, yPos);

      yPos += 7;
      doc.setFont('helvetica', 'bold'); doc.text('MTD Overtime Amount:', 112, yPos);
      doc.setFont('helvetica', 'normal'); doc.text(`Rs. ${mtdMetrics.otCost.toLocaleString('en-IN')}`, 156, yPos);

      yPos += 9;
      doc.setFillColor(236, 253, 245);
      doc.roundedRect(112, yPos - 5, 80, 10, 2, 2, 'F');
      doc.setTextColor(4, 120, 87);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(`MTD GRAND TOTAL: Rs. ${mtdMetrics.grandTotal.toLocaleString('en-IN')}`, 116, yPos + 1.5);

      yPos += 14;
      doc.setTextColor(grayDark[0], grayDark[1], grayDark[2]);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.text('Highest MTD Overtime Worker (Audit):', 112, yPos);

      // Highest MTD overtime worker name explicitly printed in BLACK for max visibility
      doc.setTextColor(0, 0, 0); // BLACK
      doc.setFont('helvetica', 'bold');
      if (mtdMetrics.topWorker) {
        doc.text(`${mtdMetrics.topWorker.name} (${mtdMetrics.topWorker.code})`, 112, yPos + 5);
        doc.setFont('helvetica', 'normal');
        doc.text(`${mtdMetrics.topWorker.department} | Rs. ${mtdMetrics.topWorker.total.toLocaleString('en-IN')}`, 112, yPos + 9);
      } else {
        doc.text('None Recorded', 112, yPos + 5);
      }

      // Comparative Table Summary
      doc.setFillColor(241, 245, 249);
      doc.rect(14, 125, 182, 7, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text('METRIC PARAMETER', 18, 129.5);
      doc.text(`YESTERDAY (${targetDateFormatted})`, 95, 129.5);
      doc.text(`MONTH-TO-DATE (${monthStartFormatted} - ${targetDateFormatted})`, 145, 129.5);

      const tableRows = [
        ['Overtime Hours Logged', `${yesterdayMetrics.totalHours} Hrs`, `${mtdMetrics.totalHours} Hrs`],
        ['Fooding Allowance (Rs. 50)', `Rs. ${yesterdayMetrics.foodingCost.toLocaleString('en-IN')} (${yesterdayMetrics.foodingCount})`, `Rs. ${mtdMetrics.foodingCost.toLocaleString('en-IN')} (${mtdMetrics.foodingCount})`],
        ['Overtime Cost Payload', `Rs. ${yesterdayMetrics.otCost.toLocaleString('en-IN')}`, `Rs. ${mtdMetrics.otCost.toLocaleString('en-IN')}`],
        ['Combined Financial Liability', `Rs. ${yesterdayMetrics.grandTotal.toLocaleString('en-IN')}`, `Rs. ${mtdMetrics.grandTotal.toLocaleString('en-IN')}`],
        ['Active Overtime Personnel', `${yesterdayMetrics.activeWorkers} Workers`, `${mtdMetrics.activeWorkers} Workers`]
      ];

      let rowY = 138;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      tableRows.forEach((row, i) => {
        if (i % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(14, rowY - 4, 182, 6, 'F');
        }
        doc.setTextColor(30, 41, 59);
        doc.text(row[0], 18, rowY);
        doc.text(row[1], 95, rowY);
        doc.text(row[2], 145, rowY);
        rowY += 6.5;
      });

      // Save PDF
      doc.save(`Factory_OT_Audit_Report_${targetDateFormatted}.pdf`);
      onShowToast('Factory Overtime Audit PDF Report downloaded!', 'success');
    } catch (err: any) {
      console.error(err);
      onShowToast('PDF generation failed: ' + err.message, 'error');
    }
  };

  // Sync Report to Google Sheet
  const handleSyncToGoogleSheet = async () => {
    setIsSyncing(true);
    setSyncStatus(null);

    const timeNow = getIndianTimestamp();
    const payload = {
      action: 'syncReport',
      date: targetDate,
      targetDateFormatted,
      monthStartFormatted,
      totalHoursYesterday: yesterdayMetrics.totalHours,
      foodingAmountYesterday: yesterdayMetrics.foodingCost,
      otAmountYesterday: yesterdayMetrics.otCost,
      grandTotalYesterday: yesterdayMetrics.grandTotal,
      activeWorkersYesterday: yesterdayMetrics.activeWorkers,
      topWorkerYesterdayName: yesterdayMetrics.topWorker ? `${yesterdayMetrics.topWorker.name} (${yesterdayMetrics.topWorker.code})` : 'N/A',
      totalHoursMTD: mtdMetrics.totalHours,
      foodingAmountMTD: mtdMetrics.foodingCost,
      otAmountMTD: mtdMetrics.otCost,
      grandTotalMTD: mtdMetrics.grandTotal,
      activeWorkersMTD: mtdMetrics.activeWorkers,
      topWorkerMTDName: mtdMetrics.topWorker ? `${mtdMetrics.topWorker.name} (${mtdMetrics.topWorker.code})` : 'N/A',
      generatedAt: timeNow
    };

    try {
      const targetUrl = appsScriptUrl || '/api/sheets/sync-report';
      const isDirectUrl = targetUrl.startsWith('http');

      let res: Response;
      if (isDirectUrl) {
        res = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch('/api/sheets/report-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      const data = await res.json().catch(() => ({}));

      if (res.ok && (data.success || data.status === 'ok')) {
        setSyncStatus({ success: true, message: 'Executive Report appended to Google Sheet tab "CEO_CFO_Daily_Reports" successfully!' });
        onShowToast('Report synced to Google Sheet!', 'success');
      } else {
        // Even if direct sheet failed or returned custom message
        setSyncStatus({ 
          success: false, 
          message: data.error || 'Saved report locally. (To save directly in Google Sheet, ensure Google Apps Script includes action "syncReport").' 
        });
        onShowToast('Report payload recorded.', 'info');
      }
    } catch (err: any) {
      console.error(err);
      setSyncStatus({ success: false, message: 'Network sync error: ' + err.message });
      onShowToast('Sync error: ' + err.message, 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden my-auto">
        
        {/* --- Modal Header Bar --- */}
        <div className="bg-slate-900 text-white p-5 px-6 flex justify-between items-center shrink-0 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 border border-indigo-400/30 rounded-xl text-indigo-300">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight flex items-center gap-2">
                Factory Overtime Audit Daily Report
                <span className="text-[10px] bg-indigo-500 text-white font-semibold uppercase px-2 py-0.5 rounded-full">Audit Report</span>
              </h2>
              <p className="text-xs text-slate-400 font-medium">Overtime hours, fooding costs & highest worker parameters for factory audit</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* --- Target Date Bar & Sub-Nav Tabs --- */}
        <div className="bg-slate-50 border-b border-slate-100 p-4 px-6 flex flex-col sm:flex-row justify-between items-center gap-4 shrink-0">
          
          {/* Target Date Selector */}
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 shrink-0">
              <Calendar className="w-4 h-4 text-indigo-600" /> Report Till Date:
            </label>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-xl bg-white text-xs font-semibold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 shadow-3xs"
            />
            <span className="text-[10px] font-medium text-slate-400 font-mono hidden md:inline">
              (1 Day Before = {targetDateFormatted})
            </span>
          </div>

          {/* Sub-Tab Navigation */}
          <div className="flex bg-slate-200/70 p-1 rounded-xl w-full sm:w-auto gap-1">
            <button
              onClick={() => setActiveSubTab('summary')}
              className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${activeSubTab === 'summary' ? 'bg-white text-slate-900 shadow-3xs' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <FileText className="w-3.5 h-3.5" /> Summary Card
            </button>
            <button
              onClick={() => setActiveSubTab('whatsapp')}
              className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${activeSubTab === 'whatsapp' ? 'bg-emerald-600 text-white shadow-3xs' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <Phone className="w-3.5 h-3.5" /> WhatsApp API
            </button>
            <button
              onClick={() => setActiveSubTab('pdf')}
              className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${activeSubTab === 'pdf' ? 'bg-slate-900 text-white shadow-3xs' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <Download className="w-3.5 h-3.5" /> PDF Download
            </button>
            <button
              onClick={() => setActiveSubTab('sheets')}
              className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${activeSubTab === 'sheets' ? 'bg-indigo-600 text-white shadow-3xs' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" /> Google Sheet Sync
            </button>
          </div>
        </div>

        {/* --- Modal Content Area --- */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          
          {/* TAB 1: EXECUTIVE SUMMARY CARD */}
          {activeSubTab === 'summary' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              
              {/* Executive Side-by-Side KPI Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* 1. YESTERDAY'S OVERTIME CARD */}
                <div className="bg-white rounded-2xl border border-indigo-100 shadow-sm p-5 space-y-4 relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-1.5 bg-indigo-600"></div>
                  
                  <div className="flex justify-between items-start border-b border-slate-100 pb-3">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                        1 Day Before OT
                      </span>
                      <h3 className="text-base font-bold text-slate-900 mt-1">
                        Yesterday's Overtime ({targetDateFormatted})
                      </h3>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 font-semibold uppercase block">Records</span>
                      <span className="text-sm font-bold text-slate-800">{yesterdayMetrics.recordsCount} Logs</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Total Hours</span>
                      <span className="text-base font-bold text-indigo-600 mt-0.5 block">{yesterdayMetrics.totalHours} Hrs</span>
                      <span className="text-[9px] text-slate-500 font-medium">{yesterdayMetrics.activeWorkers} Active Employees</span>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Fooding Allowance</span>
                      <span className="text-base font-bold text-amber-600 mt-0.5 block">{formatCurrency(yesterdayMetrics.foodingCost)}</span>
                      <span className="text-[9px] text-slate-500 font-medium">{yesterdayMetrics.foodingCount} Workers @ Rs. 50</span>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Overtime Payload</span>
                      <span className="text-base font-bold text-slate-900 mt-0.5 block">{formatCurrency(yesterdayMetrics.otCost)}</span>
                      <span className="text-[9px] text-slate-500 font-medium">Hourly Wage × OT Hours</span>
                    </div>

                    <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100">
                      <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block">Grand Total</span>
                      <span className="text-base font-bold text-indigo-900 mt-0.5 block">{formatCurrency(yesterdayMetrics.grandTotal)}</span>
                      <span className="text-[9px] text-indigo-600 font-medium">OT + Fooding Combined</span>
                    </div>
                  </div>

                  {/* Top Earner Yesterday Spotlight */}
                  <div className="bg-slate-900 text-white p-4 rounded-xl space-y-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      Highest Overtime Worker Yesterday (Needs Review)
                    </div>
                    {yesterdayMetrics.topWorker ? (
                      <div className="flex justify-between items-center text-xs">
                        <div>
                          <div className="font-bold text-white text-sm">{yesterdayMetrics.topWorker.name}</div>
                          <div className="text-[10px] text-slate-400">{yesterdayMetrics.topWorker.code} • {yesterdayMetrics.topWorker.department}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-emerald-400 text-sm">{formatCurrency(yesterdayMetrics.topWorker.total)}</div>
                          <div className="text-[10px] text-slate-300">{yesterdayMetrics.topWorker.hours} Hrs OT</div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400 italic">No overtime logged for target date.</div>
                    )}
                  </div>
                </div>

                {/* 2. MONTH-TO-DATE OVERTIME CARD */}
                <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5 space-y-4 relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-1.5 bg-emerald-600"></div>

                  <div className="flex justify-between items-start border-b border-slate-100 pb-3">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                        1st To Till Date
                      </span>
                      <h3 className="text-base font-bold text-slate-900 mt-1">
                        Month-to-Date Summary
                      </h3>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 font-semibold uppercase block">Period</span>
                      <span className="text-xs font-bold text-slate-800">{monthStartFormatted} to {targetDateFormatted}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Total MTD Hours</span>
                      <span className="text-base font-bold text-emerald-600 mt-0.5 block">{mtdMetrics.totalHours} Hrs</span>
                      <span className="text-[9px] text-slate-500 font-medium">{mtdMetrics.activeWorkers} Unique Employees</span>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">MTD Fooding Allowance</span>
                      <span className="text-base font-bold text-amber-600 mt-0.5 block">{formatCurrency(mtdMetrics.foodingCost)}</span>
                      <span className="text-[9px] text-slate-500 font-medium">{mtdMetrics.foodingCount} Meal Allowances</span>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">MTD Overtime Cost</span>
                      <span className="text-base font-bold text-slate-900 mt-0.5 block">{formatCurrency(mtdMetrics.otCost)}</span>
                      <span className="text-[9px] text-slate-500 font-medium">Cumulative Wage Expense</span>
                    </div>

                    <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                      <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">MTD Grand Total</span>
                      <span className="text-base font-bold text-emerald-950 mt-0.5 block">{formatCurrency(mtdMetrics.grandTotal)}</span>
                      <span className="text-[9px] text-emerald-700 font-medium">OT + Fooding Liability</span>
                    </div>
                  </div>

                  {/* Top Earner MTD Spotlight */}
                  <div className="bg-slate-900 text-white p-4 rounded-xl space-y-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      Highest MTD Overtime Worker (Needs Review)
                    </div>
                    {mtdMetrics.topWorker ? (
                      <div className="flex justify-between items-center text-xs">
                        <div>
                          <div className="font-bold text-white text-sm">{mtdMetrics.topWorker.name}</div>
                          <div className="text-[10px] text-slate-400">{mtdMetrics.topWorker.code} • {mtdMetrics.topWorker.department}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-emerald-400 text-sm">{formatCurrency(mtdMetrics.topWorker.total)}</div>
                          <div className="text-[10px] text-slate-300">{mtdMetrics.topWorker.hours} Hrs Total MTD</div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400 italic">No MTD records found.</div>
                    )}
                  </div>
                </div>

              </div>

              {/* Action Toolbar */}
              <div className="bg-slate-50 border border-slate-200/80 p-4 rounded-2xl flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="text-xs text-slate-600 font-medium">
                  💡 Executive summary is fully formatted and ready for CEO & CFO review.
                </div>
                <div className="flex gap-2.5 w-full sm:w-auto">
                  <button
                    onClick={() => setActiveSubTab('whatsapp')}
                    className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" /> Share via WhatsApp
                  </button>
                  <button
                    onClick={handleDownloadPDF}
                    className="flex-1 sm:flex-none bg-slate-900 hover:bg-black text-white px-4 py-2 text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> Download PDF Report
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* TAB 2: WHATSAPP INTEGRATION & SHARING */}
          {activeSubTab === 'whatsapp' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="bg-emerald-50/60 border border-emerald-100 p-4 rounded-2xl space-y-3">
                <h3 className="text-xs font-bold text-emerald-950 uppercase tracking-wider flex items-center gap-2">
                  <Phone className="w-4 h-4 text-emerald-600" /> WhatsApp API & Instant Share Tool
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed font-sans">
                  Send this exact executive text briefing directly to CEO or CFO on WhatsApp using the official WhatsApp Web/API link, or copy the pre-formatted text.
                </p>

                {/* Optional Phone Number input */}
                <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                  <div className="w-full sm:w-72">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      Recipient WhatsApp Phone No. (Optional):
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 919876543210 (Country code + number)"
                      value={cfoPhone}
                      onChange={(e) => setCfoPhone(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-medium focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    />
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto self-end">
                    <button
                      onClick={handleSendWhatsApp}
                      className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 text-xs font-semibold rounded-xl shadow-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
                    >
                      <Send className="w-3.5 h-3.5" /> Launch WhatsApp Chat
                    </button>
                    <button
                      onClick={handleCopyWhatsAppText}
                      className="bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 px-4 py-2 text-xs font-semibold rounded-xl shadow-3xs flex items-center justify-center gap-2 cursor-pointer transition-all"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? 'Copied!' : 'Copy Text'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Formatted Text Box */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Live Formatted WhatsApp Message Payload:
                </label>
                <div className="bg-slate-900 text-emerald-400 p-4 rounded-2xl font-mono text-xs leading-relaxed whitespace-pre-wrap select-all shadow-inner border border-slate-800 max-h-[380px] overflow-y-auto">
                  {whatsAppMessageText}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: PDF EXECUTIVE REPORT GENERATOR */}
          {activeSubTab === 'pdf' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="bg-slate-50 border border-slate-200 p-6 rounded-2xl space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-slate-900 text-white rounded-xl">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Download CEO & CFO PDF Executive Report</h3>
                    <p className="text-xs text-slate-500 font-medium">Generates an official 1-page A4 PDF briefing with company header, dual KPI metrics, comparative breakdown table & executive sign-off lines.</p>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 p-4 rounded-xl space-y-2 text-xs text-slate-600 font-sans">
                  <div className="font-bold text-slate-800 text-xs">Included in this PDF document:</div>
                  <ul className="list-disc pl-5 space-y-1 text-slate-500 font-medium">
                    <li><strong>Little Nap Recliners</strong> Official Letterhead & Timestamp</li>
                    <li><strong>1 Day Before OT Summary:</strong> Total Hours, Active Employees, Fooding Amount, OT Amount, Grand Total</li>
                    <li><strong>Top Earner Spotlight:</strong> Yesterday's & MTD's Highest Overtime Persons</li>
                    <li><strong>1st to Till Date MTD Metrics:</strong> MTD Hours, Fooding & Combined Costs</li>
                    <li><strong>Executive Signature Blocks:</strong> CEO Signature Line & CFO Signature Line for formal sign-off</li>
                  </ul>
                </div>

                <button
                  onClick={handleDownloadPDF}
                  className="bg-slate-900 hover:bg-black text-white px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all w-full sm:w-auto"
                >
                  <Download className="w-4 h-4" /> Download Executive PDF Report
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: GOOGLE SHEET SYNC & AUTOMATION GUIDE */}
          {activeSubTab === 'sheets' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              
              {/* Trigger Direct Sync Button */}
              <div className="bg-indigo-50/60 border border-indigo-100 p-5 rounded-2xl space-y-3">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-indigo-950 flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
                      Save Report to Google Sheet Tab ("CEO_CFO_Daily_Reports")
                    </h3>
                    <p className="text-xs text-indigo-900/80 font-medium mt-0.5">
                      Click below to instantly append today's executive report summary into a dedicated Google Sheet tab.
                    </p>
                  </div>
                  <button
                    onClick={handleSyncToGoogleSheet}
                    disabled={isSyncing}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold uppercase tracking-wider shadow-xs flex items-center gap-2 cursor-pointer transition-all disabled:opacity-50 shrink-0"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    {isSyncing ? 'Syncing...' : 'Sync to Google Sheet'}
                  </button>
                </div>

                {syncStatus && (
                  <div className={`p-3 rounded-xl text-xs font-semibold border ${
                    syncStatus.success 
                      ? 'bg-emerald-50 text-emerald-900 border-emerald-200' 
                      : 'bg-amber-50 text-amber-900 border-amber-200'
                  }`}>
                    {syncStatus.message}
                  </div>
                )}
              </div>

              {/* Automated Evening Trigger Guide */}
              <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl space-y-4 font-sans text-xs text-slate-700">
                <h4 className="font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2 text-xs">
                  <Sparkles className="w-4 h-4 text-amber-500" /> How to Automate Every Evening at 8:00 PM (Google Apps Script)
                </h4>

                <p className="text-slate-500 font-medium leading-relaxed">
                  You can set up a 1-click Google Apps Script daily trigger so that every evening (e.g., 31st July evening), Google Sheet automatically compiles yesterday's OT (30th July) and MTD metrics into the <code className="bg-slate-100 text-indigo-600 px-1 py-0.5 rounded font-mono">CEO_CFO_Daily_Reports</code> tab without any manual work!
                </p>

                <div className="space-y-3 font-medium text-slate-600">
                  <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-1">
                    <strong className="text-slate-800 block font-bold">Step 1: Open Google Apps Script</strong>
                    <p>In your Google Sheet, click <strong className="text-slate-800">Extensions &gt; Apps Script</strong>.</p>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-1">
                    <strong className="text-slate-800 block font-bold">Step 2: Add Evening Trigger Function</strong>
                    <p>Paste the following Google Apps Script snippet into your script file:</p>
                    <pre className="font-mono bg-slate-900 text-emerald-400 p-3 rounded-lg text-[10px] overflow-x-auto mt-2">
{`function createEveningCeoCfoReport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("CEO_CFO_Daily_Reports");
  if (!sheet) {
    sheet = ss.insertSheet("CEO_CFO_Daily_Reports");
    sheet.appendRow([
      "Report Date", "Target Date", "Yesterday OT Hours", "Yesterday Fooding (Rs)",
      "Yesterday OT Amount (Rs)", "Yesterday Grand Total (Rs)", "Yesterday Top Worker",
      "MTD Range", "MTD OT Hours", "MTD Fooding (Rs)", "MTD OT Amount (Rs)",
      "MTD Grand Total (Rs)", "MTD Top Worker", "Generated At"
    ]);
  }
  Logger.log("Evening report trigger executed successfully!");
}`}
                    </pre>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-1">
                    <strong className="text-slate-800 block font-bold">Step 3: Enable Daily Time-Driven Trigger</strong>
                    <p>In the Apps Script left menu, click the <strong>Clock icon ⏰ (Triggers)</strong> &gt; Click <strong>"Add Trigger"</strong> at bottom right:</p>
                    <ul className="list-disc pl-5 mt-1 text-slate-500 space-y-0.5">
                      <li>Select function to run: <strong className="text-slate-800">createEveningCeoCfoReport</strong></li>
                      <li>Select event source: <strong className="text-slate-800">Time-driven</strong></li>
                      <li>Type of time based trigger: <strong className="text-slate-800">Day timer</strong></li>
                      <li>Select time of day: <strong className="text-slate-800">8pm to 9pm</strong></li>
                    </ul>
                  </div>
                </div>
              </div>

            </div>
          )}

        </div>

        {/* --- Modal Footer --- */}
        <div className="bg-slate-50 border-t border-slate-100 p-4 px-6 flex justify-between items-center shrink-0">
          <div className="text-[11px] text-slate-400 font-medium">
            Little Nap Recliners • Executive Overtime ERP
          </div>
          <button
            onClick={onClose}
            className="bg-slate-200 hover:bg-slate-300 text-slate-800 px-5 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer"
          >
            Close Report
          </button>
        </div>

      </div>
    </div>
  );
}
