import React, { useMemo } from 'react';
import { OvertimeRecord, Employee } from '../types';
import { calculateOTCost, formatCurrency, formatDateToDDMMYYYY, parseDateString } from '../utils/calculations';
import { X, Briefcase, Calendar, Coffee, IndianRupee, Clock, FileSpreadsheet, Eye, TrendingUp } from 'lucide-react';

interface EmployeeHistoryModalProps {
  employeeCode: string;
  employees: Employee[];
  records: OvertimeRecord[];
  onClose: () => void;
}

export const EmployeeHistoryModal: React.FC<EmployeeHistoryModalProps> = ({
  employeeCode,
  employees,
  records,
  onClose,
}) => {
  // Find employee master detail
  const employee = useMemo(() => {
    const key = (employeeCode || '').trim().toUpperCase();
    if (!key) return undefined;
    return employees.find(e => {
      const eCode = (e.employeeCode || '').trim().toUpperCase();
      const eName = (e.employeeName || '').trim().toUpperCase();
      return (eCode !== '' && eCode === key) || (eName !== '' && eName === key);
    });
  }, [employees, employeeCode]);

  // Filter records specifically for this employee
  const employeeRecords = useMemo(() => {
    const key = (employeeCode || '').trim().toUpperCase();
    if (!key) return [];
    return records
      .filter(r => {
        const rCode = (r.employeeCode || '').trim().toUpperCase();
        const rName = (r.employeeName || '').trim().toUpperCase();
        return (rCode !== '' && rCode === key) || (rName !== '' && rName === key);
      })
      .sort((a, b) => (b.parsedTimestamp ?? 0) - (a.parsedTimestamp ?? 0));
  }, [records, employeeCode]);

  // Calculate history-specific summaries
  const stats = useMemo(() => {
    let totalHours = 0;
    let totalFooding = 0;
    let totalOTEarnings = 0;

    for (const r of employeeRecords) {
      totalHours += r.overtimeHours;
      totalFooding += r.foodingApplicable;
      totalOTEarnings += calculateOTCost(r, r.overtimeHours, r.date);
    }

    // Monthly breakdown with specific recorded salaries and sorted descending (newest month first)
    const monthlyMap: Record<string, { 
      monthLabel: string;
      hours: number; 
      cost: number; 
      count: number;
      totalSalary: number;
      basic: number;
      hra: number;
      splAllowance: number;
      conveyance: number;
      lta: number;
      otherAllowance: number;
      bonus: number;
    }> = {};

    for (const r of employeeRecords) {
      const monthSortKey = r.date ? r.date.slice(0, 7) : '1970-01';
      const monthLabel = r.longMonthKey || 'Unknown';

      if (!monthlyMap[monthSortKey]) {
        // Use only response record salary, do not fall back to master employee
        const sourceSalary = r;
        monthlyMap[monthSortKey] = { 
          monthLabel,
          hours: 0, 
          cost: 0, 
          count: 0,
          totalSalary: sourceSalary?.totalSalary || 0,
          basic: sourceSalary?.basic || 0,
          hra: sourceSalary?.hra || 0,
          splAllowance: sourceSalary?.splAllowance || 0,
          conveyance: sourceSalary?.conveyance || 0,
          lta: sourceSalary?.lta || 0,
          otherAllowance: sourceSalary?.otherAllowance || 0,
          bonus: sourceSalary?.bonus || 0,
        };
      }
      monthlyMap[monthSortKey].hours += r.overtimeHours;
      monthlyMap[monthSortKey].cost += r.precomputedOTCost ?? calculateOTCost(r, r.overtimeHours, r.date);
      monthlyMap[monthSortKey].count += 1;
    }

    return {
      totalHours,
      totalFooding,
      totalFoodingCost: totalFooding * 50,
      totalOTEarnings,
      totalDays: employeeRecords.length,
      monthlyBreakdown: Object.entries(monthlyMap)
        .sort((a, b) => b[0].localeCompare(a[0])) // Sort descending by YYYY-MM (newest month first)
        .map(([key, data]) => ({
          monthSortKey: key,
          ...data,
        })),
    };
  }, [employeeRecords, employee]);

  const latestRecord = employeeRecords[0];
  const activeSalarySource = (latestRecord && latestRecord.totalSalary !== undefined && latestRecord.totalSalary > 0) 
    ? latestRecord 
    : employee;

  const totalSalary = activeSalarySource?.totalSalary || 0;
  
  // Dynamic days in the month for EmployeeHistoryModal
  let modalDaysInMonth = 31;
  if (latestRecord && latestRecord.date) {
    const parsedDate = parseDateString(latestRecord.date);
    if (parsedDate && !isNaN(parsedDate.getTime()) && parsedDate.getTime() !== 0) {
      modalDaysInMonth = new Date(parsedDate.getFullYear(), parsedDate.getMonth() + 1, 0).getDate();
    }
  } else {
    const d = new Date();
    modalDaysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  }
  
  const hourlyOTRate = totalSalary > 0 ? (totalSalary / modalDaysInMonth / 8) : 0;
  const otPercentageOfGross = totalSalary > 0 ? (stats.totalOTEarnings / totalSalary) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md">
      <div className="relative bg-white/95 backdrop-blur-xl w-full max-w-5xl rounded-2xl shadow-2xl border border-slate-200/50 flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="flex justify-between items-start bg-slate-900 text-white p-6 pb-8 rounded-t-2xl border-b border-slate-800/40">
          <div>
            <span className="text-[10px] font-bold tracking-wider uppercase bg-indigo-600 text-white px-2.5 py-0.5 rounded-md">Employee History</span>
            <h3 className="text-xl font-bold tracking-tight text-white mt-3">{employee?.employeeName || latestRecord?.employeeName || 'Unknown Employee'}</h3>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-400 mt-2 font-medium">
              <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-slate-500" /> ID: <span className="text-indigo-400 font-bold">{employee?.employeeCode || latestRecord?.employeeCode || employeeCode}</span></span>
              <span className="text-slate-700">•</span>
              <span className="flex items-center gap-1"><Briefcase className="w-3.5 h-3.5 text-slate-500" /> {employee?.designation || latestRecord?.designation || 'N/A'}</span>
              <span className="text-slate-700">•</span>
              <span className="text-slate-300">Department: <strong className="text-white">{employee?.department || latestRecord?.department || 'N/A'}</strong></span>
              <span className="text-slate-700">•</span>
              <span className="text-slate-300">Segment: <strong className="text-white">{employee?.payroll || latestRecord?.payroll || 'N/A'}</strong></span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-850 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors border border-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body / Scroll Content */}
        <div className="p-6 overflow-y-auto space-y-6 bg-slate-50/50">
          {/* Summary counters row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="bg-white/80 backdrop-blur-xs p-4 rounded-xl border border-slate-200/60 shadow-xs flex items-center gap-3">
              <div className="bg-indigo-50 p-2.5 rounded-lg text-indigo-600 border border-indigo-100/40"><Clock className="w-5 h-5" /></div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Total Hours</span>
                <span className="text-base font-bold text-slate-900 block mt-0.5">{stats.totalHours} Hrs</span>
              </div>
            </div>
            <div className="bg-white/80 backdrop-blur-xs p-4 rounded-xl border border-slate-200/60 shadow-xs flex items-center gap-3">
              <div className="bg-emerald-50 p-2.5 rounded-lg text-emerald-600 border border-emerald-100/40"><Calendar className="w-5 h-5" /></div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Active Days</span>
                <span className="text-base font-bold text-slate-900 block mt-0.5">{stats.totalDays} Days</span>
              </div>
            </div>
            <div className="bg-white/80 backdrop-blur-xs p-4 rounded-xl border border-slate-200/60 shadow-xs flex items-center gap-3">
              <div className="bg-amber-50 p-2.5 rounded-lg text-amber-600 border border-amber-100/40"><Coffee className="w-5 h-5" /></div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Fooding</span>
                <span className="text-base font-bold text-slate-900 block mt-0.5">{stats.totalFooding} Logs</span>
              </div>
            </div>
            <div className="bg-white/80 backdrop-blur-xs p-4 rounded-xl border border-slate-200/60 shadow-xs flex items-center gap-3">
              <div className="bg-rose-50 p-2.5 rounded-lg text-rose-600 border border-rose-100/40"><IndianRupee className="w-5 h-5" /></div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Est. Earnings</span>
                <span className="text-base font-bold text-slate-900 block mt-0.5">{formatCurrency(stats.totalOTEarnings)}</span>
              </div>
            </div>
            <div className="bg-white/80 backdrop-blur-xs p-4 rounded-xl border border-slate-200/60 shadow-xs flex items-center gap-3">
              <div className="bg-indigo-50 p-2.5 rounded-lg text-indigo-600 border border-indigo-100/40"><Clock className="w-5 h-5" /></div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Hourly OT Rate</span>
                <span className="text-base font-bold text-slate-900 block mt-0.5">
                  {hourlyOTRate > 0 ? `${formatCurrency(hourlyOTRate)}/hr` : 'Rs. 0/hr'}
                </span>
              </div>
            </div>
            <div className="bg-white/80 backdrop-blur-xs p-4 rounded-xl border border-slate-200/60 shadow-xs flex items-center gap-3">
              <div className="bg-emerald-50 p-2.5 rounded-lg text-emerald-600 border border-emerald-100/40"><TrendingUp className="w-5 h-5" /></div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">OT vs Gross %</span>
                <span className={`text-base font-bold block mt-0.5 ${otPercentageOfGross > 20 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {otPercentageOfGross.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* Table & Monthly Breakdown Section */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* History Table */}
            <div className="bg-white rounded-xl border border-slate-200/60 shadow-xs p-5 lg:col-span-2">
              <h4 className="font-bold text-slate-900 text-sm mb-4 flex items-center gap-1.5 uppercase tracking-wide">
                <FileSpreadsheet className="w-4 h-4 text-indigo-600" /> Daily Overtime Logs
              </h4>
              <div className="max-h-[350px] overflow-y-auto overflow-x-auto border border-slate-100 rounded-lg max-w-full">
                <table className="w-full text-left text-xs border-collapse min-w-[750px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-semibold uppercase tracking-wider text-[9px] select-none whitespace-nowrap">
                      <th className="py-2.5 px-3 min-w-[90px]">Date</th>
                      <th className="py-2.5 px-3 min-w-[140px]">Recorded Gross Salary</th>
                      <th className="py-2.5 px-3 text-center min-w-[80px]">Hours</th>
                      <th className="py-2.5 px-3 min-w-[90px]">Fooding</th>
                      <th className="py-2.5 px-3 min-w-[150px]">Reason</th>
                      <th className="py-2.5 px-3 min-w-[120px]">OPF Number</th>
                      <th className="py-2.5 px-3 text-center min-w-[110px]">Approval</th>
                      <th className="py-2.5 px-3 min-w-[80px]">Operator</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 font-medium">
                    {employeeRecords.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-300">No logs found.</td>
                      </tr>
                    ) : (
                      employeeRecords.map((r) => {
                        const recSalary = r.totalSalary && r.totalSalary > 0 ? r.totalSalary : (employee?.totalSalary || 0);
                        return (
                          <tr key={r.rowIndex} className="hover:bg-slate-50/50">
                            <td className="py-2.5 px-3 text-slate-700 font-bold whitespace-nowrap min-w-[90px]">{formatDateToDDMMYYYY(r.date)}</td>
                            <td className="py-2.5 px-3 font-semibold text-slate-800 whitespace-nowrap min-w-[140px]">
                              {recSalary > 0 ? formatCurrency(recSalary) : <span className="text-slate-300 italic">Not set</span>}
                            </td>
                            <td className="py-2.5 px-3 text-center text-indigo-600 font-bold whitespace-nowrap min-w-[80px]">{r.overtimeHours} Hrs</td>
                            <td className="py-2.5 px-3 whitespace-nowrap min-w-[90px]">
                              {r.foodingApplicable > 0 ? (
                                <span className="bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded text-[9px] font-bold inline-block">Rs. 50 Paid</span>
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-indigo-700 font-semibold min-w-[150px] break-words whitespace-normal" title={r.reasonForOvertime}>
                              {r.reasonForOvertime || <span className="text-slate-300 italic">-</span>}
                            </td>
                            <td className="py-2.5 px-3 text-slate-500 min-w-[120px] break-words whitespace-normal" title={r.remarks}>
                              {r.remarks || <span className="text-slate-300 italic">-</span>}
                            </td>
                            <td className="py-2.5 px-3 text-center whitespace-nowrap min-w-[110px]">
                              {r.approvalForOT ? (
                                <a 
                                  href={r.approvalForOT} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="inline-flex items-center gap-1 text-[9px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 hover:text-indigo-800 px-2 py-0.5 rounded-md transition-colors"
                                >
                                  <Eye className="w-3 h-3" /> View Document
                                </a>
                              ) : (
                                <span className="text-slate-400 italic text-[9px]">No link</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-slate-400 text-[10px] whitespace-nowrap min-w-[80px]">{r.enteredBy}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Monthly Trend List */}
            <div className="bg-white rounded-xl border border-slate-100 shadow-xs p-5">
              <h4 className="font-bold text-slate-800 text-sm mb-4 flex items-center gap-1.5 uppercase tracking-wide">
                <Calendar className="w-4 h-4 text-emerald-600" /> Monthly Summary Breakdown
              </h4>
              <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                {stats.monthlyBreakdown.length === 0 ? (
                  <span className="text-xs text-slate-300">No monthly aggregations available.</span>
                ) : (
                  stats.monthlyBreakdown.map((item) => {
                    const otPercent = item.totalSalary > 0 ? (item.cost / item.totalSalary) * 100 : 0;
                    return (
                      <div key={item.monthSortKey} className="p-3 bg-slate-50 border border-slate-100 rounded-lg text-xs space-y-2">
                        <div className="flex items-center justify-between font-bold text-slate-700">
                          <span>{item.monthLabel}</span>
                          <span className="text-[10px] px-2 py-0.5 bg-indigo-50 border border-indigo-100/40 text-indigo-600 rounded-md font-semibold">
                            Salary: {item.totalSalary > 0 ? formatCurrency(item.totalSalary) : 'N/A'}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 font-medium text-slate-500">
                          <div>
                            Hours: <span className="text-indigo-600 font-bold">{item.hours} Hrs</span>
                          </div>
                          <div className="text-right">
                            Total Pay: <span className="text-emerald-700 font-bold">{formatCurrency(item.cost)}</span>
                          </div>
                          <div>
                            OT %: <span className="text-indigo-600 font-bold">{otPercent > 0 ? `${otPercent.toFixed(1)}%` : '0%'}</span>
                          </div>
                          <div className="text-right">
                            OT Days: <span className="text-slate-700 font-bold">{item.count} Days</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex justify-between items-center p-5 bg-slate-100 border-t border-slate-200 text-xs text-slate-500 rounded-b-2xl">
          <span>Employee Code: <span className="font-mono font-bold text-slate-700">{employeeCode}</span></span>
          <button
            onClick={onClose}
            className="px-4 py-2 font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-xs"
          >
            Close History Profile
          </button>
        </div>

      </div>
    </div>
  );
};
