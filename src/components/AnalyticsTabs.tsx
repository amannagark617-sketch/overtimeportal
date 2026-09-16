import React, { useState, useMemo } from 'react';
import { OvertimeRecord, Employee } from '../types';
import { calculateOTCost, formatCurrency, formatDateToDDMMYYYY, parseIndianTimestamp, formatIndianTimestamp, parseDateString } from '../utils/calculations';
import { 
  Users, 
  Building2, 
  TrendingUp, 
  IndianRupee, 
  AlertTriangle, 
  Coffee, 
  Search, 
  ArrowRight,
  ArrowUpDown,
  UserCheck
} from 'lucide-react';

interface AnalyticsTabsProps {
  records: OvertimeRecord[];
  employees: Employee[];
  onEmployeeClick: (employeeCode: string) => void;
}

type TabType = 'employees' | 'departments' | 'salary_vs_ot' | 'fooding' | 'months' | 'users';

const AnalyticsTabsComponent: React.FC<AnalyticsTabsProps> = ({
  records,
  employees,
  onEmployeeClick,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('employees');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('otHours');
  const [sortAsc, setSortAsc] = useState(false);

  // Helper Map
  const employeeMap = useMemo(() => {
    const map = new Map<string, Employee>();
    for (const emp of employees) {
      map.set(emp.employeeCode, emp);
    }
    return map;
  }, [employees]);

  // Handle sorting
  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  // --- 1. Employee Deep Analysis ---
  const employeeAnalysisData = useMemo(() => {
    const empMetrics: Record<string, {
      code: string;
      name: string;
      department: string;
      designation: string;
      salary: number;
      basic: number;
      totalOTHours: number;
      otDays: number;
      foodingCount: number;
      foodingCost: number;
      estimatedOTCost: number;
      lastOTDate: string;
      enteredBy: string;
      monthlyHours: Record<string, number>;
      otRatio: number;
      combinedCost: number;
    }> = {};

    // Seed from employees
    for (const emp of employees) {
      const codeKey = (emp.employeeCode || emp.employeeName || '').trim().toUpperCase();
      if (!codeKey) continue;

      empMetrics[codeKey] = {
        code: emp.employeeCode || emp.employeeName || codeKey,
        name: emp.employeeName || 'Unknown',
        department: emp.department || '-',
        designation: emp.designation || '-',
        salary: undefined as any,
        basic: undefined as any,
        totalOTHours: 0,
        otDays: 0,
        foodingCount: 0,
        foodingCost: 0,
        estimatedOTCost: 0,
        lastOTDate: 'N/A',
        enteredBy: 'N/A',
        monthlyHours: {},
        otRatio: 0,
        combinedCost: 0,
      };
    }

    // Accumulate records
    for (const r of records) {
      const rKey = (r.employeeCode || r.employeeName || '').trim().toUpperCase();
      if (!rKey) continue;

      let metric = empMetrics[rKey];
      if (!metric) {
        // If employee is missing from master database (shouldn't happen but fallback)
        empMetrics[rKey] = {
          code: r.employeeCode || r.employeeName || rKey,
          name: r.employeeName || 'Unknown',
          department: r.department || '-',
          designation: r.designation || '-',
          salary: undefined as any,
          basic: undefined as any,
          totalOTHours: 0,
          otDays: 0,
          foodingCount: 0,
          foodingCost: 0,
          estimatedOTCost: 0,
          lastOTDate: 'N/A',
          enteredBy: 'N/A',
          monthlyHours: {},
          otRatio: 0,
          combinedCost: 0,
        };
        metric = empMetrics[rKey];
      }

      metric.totalOTHours += r.overtimeHours;
      metric.otDays += 1;
      metric.foodingCount += r.foodingApplicable;
      metric.foodingCost += r.foodingApplicable * 50;
      
      // Take salary data strictly from Response record (even if blank)
      metric.salary = r.totalSalary;
      metric.basic = r.basic;
      
      metric.estimatedOTCost += r.precomputedOTCost ?? calculateOTCost(r, r.overtimeHours, r.date);

      if (metric.lastOTDate === 'N/A' || r.date > metric.lastOTDate) {
        metric.lastOTDate = r.date;
        metric.enteredBy = r.enteredBy;
      }

      // Calculate monthly hours
      const mKey = r.monthKey ? r.monthKey.split('-')[0] : 'Unknown';
      if (mKey !== 'Unknown') {
        metric.monthlyHours[mKey] = (metric.monthlyHours[mKey] || 0) + r.overtimeHours;
      }
    }

    // Calculate final ratio and combined cost for each metric
    Object.values(empMetrics).forEach(m => {
      m.combinedCost = (m.estimatedOTCost || 0) + (m.foodingCost || 0);
      m.otRatio = m.salary > 0 ? (m.estimatedOTCost / m.salary) * 100 : 0;
    });

    const list = Object.values(empMetrics).filter(e => {
      // Show only employees with overtime if search is empty, or match search
      if (searchTerm.trim() === '') {
        return e.totalOTHours > 0;
      }
      const term = searchTerm.toLowerCase();
      return (
        e.name.toLowerCase().includes(term) ||
        e.code.toLowerCase().includes(term) ||
        e.department.toLowerCase().includes(term) ||
        e.designation.toLowerCase().includes(term)
      );
    });

    // Apply sorting
    return list.sort((a, b) => {
      let valA: any = a[sortField as keyof typeof a];
      let valB: any = b[sortField as keyof typeof b];

      // Handle undefined/string vs number
      if (valA === undefined) valA = 0;
      if (valB === undefined) valB = 0;

      if (typeof valA === 'string') {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      } else {
        return sortAsc ? valA - valB : valB - valA;
      }
    });
  }, [records, employees, employeeMap, searchTerm, sortField, sortAsc]);

  // --- 2. Department Deep Analysis ---
  const departmentAnalysisData = useMemo(() => {
    const deptMetrics: Record<string, {
      department: string;
      employeesCount: number;
      totalOTHours: number;
      averageOTHours: number;
      otCost: number;
      foodingCost: number;
      highestOTCost: number;
      highestOTEmpName: string;
      lowestOTCost: number;
      lowestOTEmpName: string;
      monthlyHours: Record<string, number>;
    }> = {};

    // Get employees count per dept
    const deptEmployees: Record<string, Set<string>> = {};
    for (const emp of employees) {
      if (!deptEmployees[emp.department]) deptEmployees[emp.department] = new Set();
      deptEmployees[emp.department].add(emp.employeeCode);
    }

    // Accumulate records per department
    for (const r of records) {
      if (!deptMetrics[r.department]) {
        deptMetrics[r.department] = {
          department: r.department,
          employeesCount: deptEmployees[r.department]?.size || 0,
          totalOTHours: 0,
          averageOTHours: 0,
          otCost: 0,
          foodingCost: 0,
          highestOTCost: 0,
          highestOTEmpName: 'N/A',
          lowestOTCost: 0,
          lowestOTEmpName: 'N/A',
          monthlyHours: {},
        };
      }

      const metric = deptMetrics[r.department];
      metric.totalOTHours += r.overtimeHours;
      metric.foodingCost += r.foodingApplicable * 50;

      metric.otCost += r.precomputedOTCost ?? calculateOTCost(r, r.overtimeHours, r.date);

      // Monthly hours
      const mKey = r.monthKey ? r.monthKey.split('-')[0] : 'Unknown';
      if (mKey !== 'Unknown') {
        metric.monthlyHours[mKey] = (metric.monthlyHours[mKey] || 0) + r.overtimeHours;
      }
    }

    // Calculate highest/lowest per employee in department by cost (money spent)
    const deptEmpCost: Record<string, Record<string, { name: string; cost: number }>> = {};
    for (const r of records) {
      if (!deptEmpCost[r.department]) deptEmpCost[r.department] = {};
      if (!deptEmpCost[r.department][r.employeeCode]) {
        deptEmpCost[r.department][r.employeeCode] = { name: r.employeeName, cost: 0 };
      }
      deptEmpCost[r.department][r.employeeCode].cost += (r.precomputedOTCost ?? calculateOTCost(r, r.overtimeHours, r.date));
    }

    Object.keys(deptMetrics).forEach(dept => {
      const metric = deptMetrics[dept];
      metric.averageOTHours = metric.employeesCount > 0 ? (metric.totalOTHours / metric.employeesCount) : 0;
      metric.averageOTHours = Math.round(metric.averageOTHours * 10) / 10;

      // Find highest/lowest by cost
      const empList = Object.values(deptEmpCost[dept] || {});
      if (empList.length > 0) {
        const sorted = [...empList].sort((a, b) => b.cost - a.cost);
        metric.highestOTCost = sorted[0].cost;
        metric.highestOTEmpName = sorted[0].name;
        
        const lowest = sorted[sorted.length - 1];
        metric.lowestOTCost = lowest.cost;
        metric.lowestOTEmpName = lowest.name;
      }
    });

    return Object.values(deptMetrics).sort((a, b) => b.otCost - a.otCost);
  }, [records, employees, employeeMap]);

  // --- 3. User Deep Analysis ---
  const userAnalysisData = useMemo(() => {
    const userMap: Record<string, {
      userId: string;
      entriesCount: number;
      lastActive: string;
      lastOTDate: string;
      employeesProcessed: Set<string>;
      totalHoursProcessed: number;
    }> = {};

    for (const r of records) {
      const u = r.enteredBy || 'System';
      if (!userMap[u]) {
        userMap[u] = {
          userId: u,
          entriesCount: 0,
          lastActive: 'N/A',
          lastOTDate: 'N/A',
          employeesProcessed: new Set(),
          totalHoursProcessed: 0,
        };
      }

      const metric = userMap[u];
      metric.entriesCount += 1;
      metric.totalHoursProcessed += r.overtimeHours;
      metric.employeesProcessed.add(r.employeeCode);

      if (metric.lastActive === 'N/A' || parseIndianTimestamp(r.timestamp) > parseIndianTimestamp(metric.lastActive)) {
        metric.lastActive = r.timestamp;
      }

      if (metric.lastOTDate === 'N/A' || new Date(r.date) > new Date(metric.lastOTDate)) {
        metric.lastOTDate = r.date;
      }
    }

    return Object.values(userMap).sort((a, b) => b.entriesCount - a.entriesCount);
  }, [records]);

  // --- 4. Fooding Deep Analysis ---
  const foodingAnalysisData = useMemo(() => {
    let totalCount = 0;
    const employeeFooding: Record<string, { name: string; dept: string; count: number; cost: number }> = {};
    const departmentFooding: Record<string, { name: string; count: number; cost: number }> = {};

    for (const r of records) {
      if (r.foodingApplicable > 0) {
        totalCount += r.foodingApplicable;

        if (!employeeFooding[r.employeeCode]) {
          employeeFooding[r.employeeCode] = { name: r.employeeName, dept: r.department, count: 0, cost: 0 };
        }
        employeeFooding[r.employeeCode].count += r.foodingApplicable;
        employeeFooding[r.employeeCode].cost += r.foodingApplicable * 50;

        if (!departmentFooding[r.department]) {
          departmentFooding[r.department] = { name: r.department, count: 0, cost: 0 };
        }
        departmentFooding[r.department].count += r.foodingApplicable;
        departmentFooding[r.department].cost += r.foodingApplicable * 50;
      }
    }

    return {
      totalCount,
      totalCost: totalCount * 50,
      employees: Object.values(employeeFooding).sort((a, b) => b.count - a.count).slice(0, 10),
      departments: Object.values(departmentFooding).sort((a, b) => b.count - a.count),
    };
  }, [records]);

  // --- 5. Monthly Deep Analysis ---
  const monthlyAnalysisData = useMemo(() => {
    const monthsMap: Record<string, {
      monthName: string;
      totalHours: number;
      employeesCount: Set<string>;
      otCost: number;
      foodingCost: number;
      averageHours: number;
      sortTimestamp: number;
    }> = {};

    for (const r of records) {
      const mKey = r.longMonthKey || 'Unknown';
      const sortTimestamp = r.monthSortTimestamp || 0;

      if (mKey !== 'Unknown') {
        if (!monthsMap[mKey]) {
          monthsMap[mKey] = {
            monthName: mKey,
            totalHours: 0,
            employeesCount: new Set(),
            otCost: 0,
            foodingCost: 0,
            averageHours: 0,
            sortTimestamp,
          };
        }

        const metric = monthsMap[mKey];
        metric.totalHours += r.overtimeHours;
        metric.employeesCount.add(r.employeeCode);
        metric.foodingCost += r.foodingApplicable * 50;
        metric.otCost += r.precomputedOTCost ?? calculateOTCost(r, r.overtimeHours, r.date);
      }
    }

    return Object.values(monthsMap).map(m => {
      const activeEmps = m.employeesCount.size;
      return {
        ...m,
        employeeCount: activeEmps,
        averageHours: activeEmps > 0 ? Math.round((m.totalHours / activeEmps) * 10) / 10 : 0,
      };
    }).sort((a, b) => b.sortTimestamp - a.sortTimestamp);
  }, [records, employeeMap]);

  // --- 6. Company-Wide Cumulative Budget & OT Impact Analysis ---
  const budgetImpact = useMemo(() => {
    let totalMasterPayroll = 0;
    let totalBasicPayroll = 0;

    // Group by employee code to get the latest/representative salary from the records (Response tab)
    const uniqueEmpSalaries = new Map<string, { totalSalary?: number; basic?: number }>();
    for (const r of records) {
      uniqueEmpSalaries.set(r.employeeCode, {
        totalSalary: r.totalSalary,
        basic: r.basic
      });
    }

    for (const [_, sal] of uniqueEmpSalaries) {
      totalMasterPayroll += sal.totalSalary || 0;
      totalBasicPayroll += sal.basic || 0;
    }

    let totalOTPayout = 0;
    let totalFoodingPayout = 0;
    const activeOTEmpCodes = new Set<string>();

    for (const r of records) {
      totalOTPayout += calculateOTCost(r, r.overtimeHours, r.date);
      totalFoodingPayout += r.foodingApplicable * 50;
      if (r.overtimeHours > 0) {
        activeOTEmpCodes.add(r.employeeCode);
      }
    }

    const totalCombinedOTCost = totalOTPayout + totalFoodingPayout;
    const extraOTPercentOfMaster = totalMasterPayroll > 0 ? (totalCombinedOTCost / totalMasterPayroll) * 100 : 0;
    const extraOTPercentOfBasic = totalBasicPayroll > 0 ? (totalCombinedOTCost / totalBasicPayroll) * 100 : 0;

    return {
      totalMasterPayroll,
      totalBasicPayroll,
      totalOTPayout,
      totalFoodingPayout,
      totalCombinedOTCost,
      extraOTPercentOfMaster,
      extraOTPercentOfBasic,
      activeOTEmployeesCount: activeOTEmpCodes.size,
    };
  }, [employees, records, employeeMap]);

  return (
    <div className="bg-white/60 backdrop-blur-md rounded-2xl border border-slate-200/50 p-6 shadow-sm">
      {/* Tab Navigation header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200/50">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500 mb-1">Detailed Insights</div>
          <h3 className="text-lg font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-indigo-600" />
            Deep Analytics
          </h3>
          <p className="text-xs font-medium text-slate-400">Compare employee details with live overtime records</p>
        </div>
        
        {/* Horizontal scrollable navigation */}
        <div className="flex bg-slate-100/80 p-1 rounded-xl overflow-x-auto max-w-full border border-slate-200/40">
          <button
            onClick={() => { setActiveTab('employees'); setSearchTerm(''); }}
            className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-lg transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'employees' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-950'
            }`}
          >
            Employee Analysis
          </button>
          <button
            onClick={() => setActiveTab('salary_vs_ot')}
            className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-lg transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'salary_vs_ot' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-950'
            }`}
          >
            Salary vs OT Ratio
          </button>
          <button
            onClick={() => { setActiveTab('departments'); setSearchTerm(''); }}
            className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-lg transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'departments' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-950'
            }`}
          >
            Departments
          </button>
          <button
            onClick={() => setActiveTab('fooding')}
            className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-lg transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'fooding' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-950'
            }`}
          >
            Fooding Details
          </button>
          <button
            onClick={() => setActiveTab('months')}
            className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-lg transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'months' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-950'
            }`}
          >
            Monthly Trends
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-lg transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'users' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-950'
            }`}
          >
            Operators
          </button>
        </div>
      </div>

      {/* Company-Wide Budget Impact Header Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6 p-4 bg-slate-50/80 rounded-2xl border border-slate-200/30">
        <div className="bg-white p-4 rounded-xl border border-slate-100/80 shadow-3xs">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Total Gross Salary Budget</span>
          <span className="text-lg font-black text-slate-900 block mt-1">{formatCurrency(budgetImpact.totalMasterPayroll)}</span>
          <span className="text-[10px] text-slate-500 font-medium mt-1 block">Basic Pay: {formatCurrency(budgetImpact.totalBasicPayroll)}</span>
        </div>
        
        <div className="bg-white p-4 rounded-xl border border-slate-100/80 shadow-3xs">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Total Overtime Expenses</span>
          <span className="text-lg font-black text-indigo-700 block mt-1">{formatCurrency(budgetImpact.totalCombinedOTCost)}</span>
          <span className="text-[10px] text-slate-500 font-medium mt-1 block">
            {formatCurrency(budgetImpact.totalOTPayout)} pay + {formatCurrency(budgetImpact.totalFoodingPayout)} food
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-100/80 shadow-3xs">
          <span className="text-[9px] font-bold text-indigo-600 uppercase tracking-wider block">Extra Overtime Overhead</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-lg font-black text-rose-600">{budgetImpact.extraOTPercentOfMaster.toFixed(2)}%</span>
            <span className="text-[10px] text-slate-500 font-medium">of Total Gross Salary</span>
          </div>
          <span className="text-[10px] text-slate-500 font-medium mt-1 block">
            {budgetImpact.extraOTPercentOfBasic.toFixed(1)}% of Basic Salary budget
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-100/80 shadow-3xs">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Overtime Active Employees</span>
          <span className="text-lg font-black text-slate-800 block mt-1">
            {budgetImpact.activeOTEmployeesCount} / {employees.length}
          </span>
          <span className="text-[10px] text-slate-500 font-medium mt-1 block">
            {Math.round((budgetImpact.activeOTEmployeesCount / (employees.length || 1)) * 100)}% of workers have OT logs
          </span>
        </div>
      </div>

      {/* Tab Body */}
      <div className="pt-6">
        {/* --- 1. Employee Deep Analysis --- */}
        {activeTab === 'employees' && (
          <div className="space-y-4">
            {/* Search filter for employee list */}
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by Code, Name, Department or Designation..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
              <div className="text-xs text-slate-500 font-medium">
                Showing {employeeAnalysisData.length} employees with overtime logs
              </div>
            </div>

            {/* Employee Audit Table */}
            <div className="overflow-x-auto border border-slate-100 rounded-lg">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50/75 border-b border-slate-100 text-slate-500 font-semibold select-none">
                    <th className="py-3 px-4">Employee</th>
                    <th className="py-3 px-3 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('salary')}>
                      <div className="flex items-center gap-1">Total Gross Salary <ArrowUpDown className="w-3.5 h-3.5" /></div>
                    </th>
                    <th className="py-3 px-3 cursor-pointer hover:bg-slate-100 font-semibold text-indigo-900 bg-indigo-50/50" onClick={() => toggleSort('combinedCost')}>
                      <div className="flex items-center gap-1">Total Combined Cost <ArrowUpDown className="w-3.5 h-3.5" /></div>
                    </th>
                    <th className="py-3 px-3 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('totalOTHours')}>
                      <div className="flex items-center gap-1">OT Hours <ArrowUpDown className="w-3.5 h-3.5" /></div>
                    </th>
                    <th className="py-3 px-3 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('estimatedOTCost')}>
                      <div className="flex items-center gap-1">Est. OT Cost <ArrowUpDown className="w-3.5 h-3.5" /></div>
                    </th>
                    <th className="py-3 px-3 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('otRatio')}>
                      <div className="flex items-center gap-1">% OT of Gross Salary <ArrowUpDown className="w-3.5 h-3.5" /></div>
                    </th>
                    <th className="py-3 px-3">Avg/Day</th>
                    <th className="py-3 px-3">Food Allowance</th>
                    <th className="py-3 px-3">Audit Review</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {employeeAnalysisData.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-slate-400">
                        No employee records found matching filter criteria.
                      </td>
                    </tr>
                  ) : (
                    employeeAnalysisData.map((emp) => {
                      const otRatio = emp.otRatio;
                      let reviewBadge = null;

                      if (otRatio >= 100) {
                        reviewBadge = (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-100 animate-pulse">
                            <AlertTriangle className="w-3.5 h-3.5" /> Critical Review
                          </span>
                        );
                      } else if (otRatio >= 50) {
                        reviewBadge = (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-100">
                            <AlertTriangle className="w-3.5 h-3.5" /> Needs Review
                          </span>
                        );
                      } else {
                        reviewBadge = (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                            Normal Load
                          </span>
                        );
                      }

                      return (
                        <tr key={emp.code} className="hover:bg-slate-50/50 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-slate-800">{emp.name}</div>
                            <div className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                              <span className="font-mono bg-slate-100 px-1 py-0.2 rounded text-[10px]">{emp.code}</span>
                              <span>|</span>
                              <span>{emp.department}</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-3">
                            <div className="font-semibold text-slate-700">{formatCurrency(emp.salary)}</div>
                            <div className="text-[10px] text-slate-400">Basic: {formatCurrency(emp.basic)}</div>
                          </td>
                          <td className="py-3.5 px-3 font-bold text-indigo-700 bg-indigo-50/20">
                            {formatCurrency(emp.estimatedOTCost + emp.foodingCost)}
                          </td>
                          <td className="py-3.5 px-3 font-semibold text-slate-700">{emp.totalOTHours} Hrs</td>
                          <td className="py-3.5 px-3 font-semibold text-slate-900">{formatCurrency(emp.estimatedOTCost)}</td>
                          <td className="py-3.5 px-3">
                            <div className="flex items-center gap-2">
                              <span className={`font-bold px-2 py-0.5 rounded text-xs ${
                                otRatio >= 100 ? 'bg-red-50 text-red-700 border border-red-100 animate-pulse' :
                                otRatio >= 50 ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                                'bg-slate-100 text-slate-700'
                              }`}>
                                {otRatio.toFixed(1)}%
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">of Gross Salary</div>
                          </td>
                          <td className="py-3.5 px-3 text-slate-500">
                            {emp.otDays > 0 ? (Math.round((emp.totalOTHours / emp.otDays) * 10) / 10) : 0} Hrs
                          </td>
                          <td className="py-3.5 px-3 text-slate-500">
                            <div className="font-medium text-slate-700">{emp.foodingCount} Allocations</div>
                            <div className="text-xs text-slate-400">{formatCurrency(emp.foodingCost)} Total</div>
                          </td>
                          <td className="py-3.5 px-3">{reviewBadge}</td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              onClick={() => onEmployeeClick(emp.code)}
                              className="text-indigo-600 hover:text-indigo-900 font-semibold text-xs flex items-center justify-end gap-1 ml-auto group"
                            >
                              Employee History 
                              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* --- 2. Salary vs Overtime Ratio Limit Analysis --- */}
        {activeTab === 'salary_vs_ot' && (
          <div className="space-y-6">
            <div className="bg-indigo-50/30 p-4 rounded-xl border border-indigo-100 text-sm text-indigo-900 font-sans">
              <h4 className="font-bold mb-1 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-indigo-600" /> Overtime vs Basic Salary Ratio
              </h4>
              <p className="text-indigo-950/80 leading-relaxed text-xs">
                Ideally, overtime cost should remain within 50% of the employee's basic monthly pay. Employees with high ratios are highlighted for review.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...employeeAnalysisData]
                .filter(e => e.totalOTHours > 0)
                .sort((a, b) => b.otRatio - a.otRatio)
                .map(emp => {
                  const otPercentage = emp.otRatio;
                  let colorClass = 'indigo';
                  if (otPercentage >= 100) colorClass = 'red';
                  else if (otPercentage >= 50) colorClass = 'amber';

                  return (
                    <div key={emp.code} className="bg-slate-50 rounded-xl border border-slate-100 p-4 flex flex-col justify-between">
                      <div>
                        <div className="flex justify-between items-start gap-2 mb-2">
                          <h5 className="font-bold text-slate-800 text-sm truncate">{emp.name}</h5>
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm ${
                            colorClass === 'red' ? 'bg-red-100 text-red-800' :
                            colorClass === 'amber' ? 'bg-amber-100 text-amber-800' :
                            'bg-slate-200 text-slate-700'
                          }`}>
                            {otPercentage.toFixed(1)}% Ratio
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mb-4">{emp.department} | {emp.code}</div>
                        
                        <div className="space-y-2 mb-4">
                          <div className="flex justify-between text-xs">
                            <span className="text-slate-500">Total Gross Salary:</span>
                            <span className="font-semibold text-slate-800">{formatCurrency(emp.salary)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-slate-500">Est. Overtime:</span>
                            <span className="font-semibold text-slate-900">{formatCurrency(emp.estimatedOTCost)}</span>
                          </div>
                        </div>
                      </div>

                      <div>
                        {/* Custom gauge progress bar */}
                        <div className="w-full bg-slate-200 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${
                              colorClass === 'red' ? 'bg-red-500' :
                              colorClass === 'amber' ? 'bg-amber-500' :
                              'bg-indigo-500'
                            }`}
                            style={{ width: `${Math.min(otPercentage, 100)}%` }}
                          ></div>
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-400 mt-1.5 font-medium">
                          <span>0% Base</span>
                          <span>50% Threshold</span>
                          <span>100%+ Critical</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* --- 3. Department Deep Analysis --- */}
        {activeTab === 'departments' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {departmentAnalysisData.map((dept, index) => (
              <div key={dept.department} className="bg-slate-50/50 p-5 rounded-xl border border-slate-100">
                <div className="flex justify-between items-start pb-3 border-b border-slate-100 mb-4">
                  <div>
                    <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-sm">Rank #{index + 1}</span>
                    <h4 className="font-bold text-slate-800 text-base mt-1.5">{dept.department}</h4>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-400 font-medium">OT Cost</div>
                    <div className="text-lg font-bold text-slate-900">{formatCurrency(dept.otCost)}</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="bg-white p-3 rounded-lg border border-slate-100 text-center">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">Active Employees</span>
                    <span className="text-base font-bold text-slate-700 block mt-0.5">{dept.employeesCount}</span>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-slate-100 text-center">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">Total Hours</span>
                    <span className="text-base font-bold text-indigo-600 block mt-0.5">{dept.totalOTHours}</span>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-slate-100 text-center">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">Avg Hrs/Emp</span>
                    <span className="text-base font-bold text-slate-700 block mt-0.5">{dept.averageOTHours}</span>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1.5 px-2 bg-white rounded-md border border-slate-50">
                    <span className="text-slate-500">Highest OT (By Amount):</span>
                    <span className="font-bold text-slate-700">{dept.highestOTEmpName} ({formatCurrency(dept.highestOTCost)})</span>
                  </div>
                  <div className="flex justify-between py-1.5 px-2 bg-white rounded-md border border-slate-50">
                    <span className="text-slate-500">Lowest OT (By Amount):</span>
                    <span className="font-semibold text-slate-600">{dept.lowestOTEmpName} ({formatCurrency(dept.lowestOTCost)})</span>
                  </div>
                  <div className="flex justify-between py-1.5 px-2 bg-white rounded-md border border-slate-50">
                    <span className="text-slate-500">Fooding Cost:</span>
                    <span className="font-bold text-orange-600">{formatCurrency(dept.foodingCost)}</span>
                  </div>
                  <div className="flex justify-between py-1.5 px-2 bg-indigo-50/50 rounded-md border border-indigo-100 text-indigo-950 font-semibold">
                    <span className="text-indigo-800 font-bold">Total Combined Cost:</span>
                    <span className="font-bold">{formatCurrency(dept.otCost + dept.foodingCost)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* --- 4. Fooding Deep Analysis --- */}
        {activeTab === 'fooding' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-orange-50/50 border border-orange-100 p-4 rounded-xl flex items-center gap-4">
                <div className="bg-orange-100 p-3 rounded-lg text-orange-600"><Coffee className="w-6 h-6" /></div>
                <div>
                  <span className="text-xs text-orange-700 uppercase tracking-wider block font-semibold">Fooding Count</span>
                  <span className="text-2xl font-black text-orange-900 block mt-0.5">{foodingAnalysisData.totalCount}</span>
                </div>
              </div>
              <div className="bg-emerald-50/50 border border-emerald-100 p-4 rounded-xl flex items-center gap-4">
                <div className="bg-emerald-100 p-3 rounded-lg text-emerald-600"><IndianRupee className="w-6 h-6" /></div>
                <div>
                  <span className="text-xs text-emerald-700 uppercase tracking-wider block font-semibold">Fooding Allowance Cost</span>
                  <span className="text-2xl font-black text-emerald-900 block mt-0.5">{formatCurrency(foodingAnalysisData.totalCost)}</span>
                </div>
              </div>
              <div className="bg-slate-50/50 border border-slate-100 p-4 rounded-xl flex items-center gap-4 col-span-1 md:col-span-2">
                <div className="bg-slate-100 p-3 rounded-lg text-slate-600"><Users className="w-6 h-6" /></div>
                <div>
                  <span className="text-xs text-slate-500 uppercase tracking-wider block font-semibold">Allowance Rule</span>
                  <span className="text-xs leading-relaxed text-slate-600 block mt-1">
                    Meal allowance is Rs. 50 flat for records with exactly 4.5 or 5.0 overtime hours.
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Top Employees Fooding */}
              <div className="bg-slate-50 p-5 rounded-xl border border-slate-100">
                <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-1.5 text-sm">
                  <Coffee className="w-4 h-4 text-orange-600" /> Top 10 Employees Recieving Food Allowance
                </h4>
                <div className="divide-y divide-slate-100 text-xs">
                  {foodingAnalysisData.employees.map((emp) => (
                    <div key={emp.name} className="flex justify-between py-2.5">
                      <div>
                        <div className="font-semibold text-slate-700">{emp.name}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{emp.dept}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-slate-900">{emp.count} times</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{formatCurrency(emp.cost)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Department Fooding Cost */}
              <div className="bg-slate-50 p-5 rounded-xl border border-slate-100">
                <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-1.5 text-sm">
                  <Building2 className="w-4 h-4 text-teal-600" /> Department-wise Food Allowance Budget
                </h4>
                <div className="divide-y divide-slate-100 text-xs">
                  {foodingAnalysisData.departments.map((dept) => (
                    <div key={dept.name} className="flex justify-between py-2.5">
                      <span className="font-semibold text-slate-700">{dept.name}</span>
                      <div className="text-right">
                        <div className="font-bold text-slate-900">{formatCurrency(dept.cost)}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{dept.count} occurrences</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- 5. Monthly Deep Analysis --- */}
        {activeTab === 'months' && (
          <div className="overflow-x-auto border border-slate-100 rounded-lg">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50/75 border-b border-slate-100 text-slate-500 font-semibold select-none">
                  <th className="py-3 px-4">Billing Month</th>
                  <th className="py-3 px-4">Active Employee Count</th>
                  <th className="py-3 px-4">Cumulative OT Hours</th>
                  <th className="py-3 px-4">Average Hours/Employee</th>
                  <th className="py-3 px-4">Est. Overtime Payout (Rs)</th>
                  <th className="py-3 px-4">Food Allowance Payout (Rs)</th>
                  <th className="py-3 px-4 font-semibold text-indigo-900 bg-indigo-50/50">Total Combined Payout (Rs)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {monthlyAnalysisData.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      No monthly historical trends found.
                    </td>
                  </tr>
                ) : (
                  monthlyAnalysisData.map((mon) => (
                    <tr key={mon.monthName} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-800">{mon.monthName}</td>
                      <td className="py-3.5 px-4 text-slate-600">{mon.employeeCount} Employees</td>
                      <td className="py-3.5 px-4 font-semibold text-indigo-600">{mon.totalHours} Hrs</td>
                      <td className="py-3.5 px-4 text-slate-500">{mon.averageHours} Hrs/day</td>
                      <td className="py-3.5 px-4 font-bold text-slate-900">{formatCurrency(mon.otCost)}</td>
                      <td className="py-3.5 px-4 font-semibold text-orange-600">{formatCurrency(mon.foodingCost)}</td>
                      <td className="py-3.5 px-4 font-bold text-indigo-700 bg-indigo-50/20">{formatCurrency(mon.otCost + mon.foodingCost)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* --- 6. User Deep Analysis --- */}
        {activeTab === 'users' && (
          <div className="overflow-x-auto border border-slate-100 rounded-lg">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50/75 border-b border-slate-100 text-slate-500 font-semibold select-none">
                  <th className="py-3 px-4">Data Entry Operator ID</th>
                  <th className="py-3 px-4">Records Submitted</th>
                  <th className="py-3 px-4">Total Hours Processed</th>
                  <th className="py-3 px-4">Distinct Employees Logged</th>
                  <th className="py-3 px-4">Last Submitted Record</th>
                  <th className="py-3 px-4">Last Activity Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {userAnalysisData.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      No operator audit trails found.
                    </td>
                  </tr>
                ) : (
                  userAnalysisData.map((user) => (
                    <tr key={user.userId} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-800 flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center font-bold text-[11px] uppercase">
                          {user.userId.slice(0, 2)}
                        </div>
                        {user.userId}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 font-semibold">{user.entriesCount} entries</td>
                      <td className="py-3.5 px-4 text-indigo-600 font-medium">{user.totalHoursProcessed} Hrs</td>
                      <td className="py-3.5 px-4 text-slate-500">{user.employeesProcessed.size} Employees</td>
                      <td className="py-3.5 px-4 text-slate-500">{formatDateToDDMMYYYY(user.lastOTDate)}</td>
                      <td className="py-3.5 px-4 text-slate-400 text-xs font-mono">{formatIndianTimestamp(user.lastActive)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export const AnalyticsTabs = React.memo(AnalyticsTabsComponent);
