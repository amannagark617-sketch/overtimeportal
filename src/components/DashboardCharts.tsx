import React, { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { OvertimeRecord, Employee } from '../types';
import { calculateOTCost, formatCurrency, parseDateString } from '../utils/calculations';
import { BarChart3, TrendingUp, Users, UserCheck, Calendar, Download } from 'lucide-react';

const exportToCSV = (data: any[], filename: string, headers: { key: string; label: string }[]) => {
  const bom = '\uFEFF';
  const csvContent = data.map(row => {
    return headers.map(header => {
      const cellValue = row[header.key] !== undefined && row[header.key] !== null ? row[header.key] : '';
      if (typeof cellValue === 'number') {
        return cellValue;
      }
      // Wrap in quotes and escape existing quotes
      const stringValue = String(cellValue).replace(/"/g, '""');
      return `"${stringValue}"`;
    }).join(',');
  });

  const headerRow = headers.map(h => `"${h.label.replace(/"/g, '""')}"`).join(',');
  const fullCSV = bom + [headerRow, ...csvContent].join('\n');

  const blob = new Blob([fullCSV], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

interface DashboardChartsProps {
  records: OvertimeRecord[];
  employees: Employee[];
  onFilterChange: (key: string, value: string) => void;
}

const COLORS = [
  '#0f172a', // Slate 900
  '#0284c7', // Sky 600
  '#0d9488', // Teal 600
  '#4f46e5', // Indigo 600
  '#ea580c', // Orange 600
  '#db2777', // Pink 600
  '#16a34a', // Green 600
  '#ca8a04', // Yellow 600
  '#7c3aed', // Violet 600
  '#e11d48', // Rose 600
];

const formatXAxisDate = (tick: string) => {
  if (!tick) return '';
  const cleanStr = String(tick).trim();
  const match = cleanStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) {
    const [, , month, day] = match;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthIndex = parseInt(month, 10) - 1;
    const monthName = months[monthIndex] || month;
    return `${day.padStart(2, '0')} ${monthName}`;
  }
  try {
    const d = new Date(cleanStr);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${day} ${months[d.getMonth()]}`;
    }
  } catch (e) {}
  return cleanStr;
};

const DashboardChartsComponent: React.FC<DashboardChartsProps> = ({
  records,
  employees,
  onFilterChange,
}) => {
  const [activeChartGroup, setActiveChartGroup] = useState<'trends' | 'departments' | 'topLists' | 'users'>('trends');

  const employeeMap = React.useMemo(() => {
    const map = new Map<string, Employee>();
    for (const emp of employees) {
      map.set(emp.employeeCode, emp);
    }
    return map;
  }, [employees]);

  // Pre-calculate data for trends
  const trendData = React.useMemo(() => {
    const dailyMap: Record<string, { date: string; hours: number; cost: number; fooding: number; ts: number }> = {};
    const monthlyMap: Record<string, { month: string; hours: number; cost: number; fooding: number; sortTimestamp: number }> = {};
    const dayOfWeekMap: Record<string, { day: string; hours: number; cost: number }> = {
      'Sunday': { day: 'Sunday', hours: 0, cost: 0 },
      'Monday': { day: 'Monday', hours: 0, cost: 0 },
      'Tuesday': { day: 'Tuesday', hours: 0, cost: 0 },
      'Wednesday': { day: 'Wednesday', hours: 0, cost: 0 },
      'Thursday': { day: 'Thursday', hours: 0, cost: 0 },
      'Friday': { day: 'Friday', hours: 0, cost: 0 },
      'Saturday': { day: 'Saturday', hours: 0, cost: 0 },
    };

    for (const r of records) {
      // Calculate individual cost (uses precomputedOTCost if available)
      const cost = r.precomputedOTCost ?? calculateOTCost(r, r.overtimeHours, r.date);
      const foodingCost = r.foodingApplicable * 50;

      // Daily Trend
      if (!dailyMap[r.date]) {
        dailyMap[r.date] = { date: r.date, hours: 0, cost: 0, fooding: 0, ts: r.parsedTimestamp || 0 };
      }
      dailyMap[r.date].hours += r.overtimeHours;
      dailyMap[r.date].cost += cost;
      dailyMap[r.date].fooding += foodingCost;

      // Monthly Trend (uses precomputed monthKey & monthSortTimestamp)
      const monthKey = r.monthKey || 'Unknown';
      const sortTimestamp = r.monthSortTimestamp || 0;
      const dayName = r.dayName || '';

      if (monthKey !== 'Unknown') {
        if (!monthlyMap[monthKey]) {
          monthlyMap[monthKey] = { month: monthKey, hours: 0, cost: 0, fooding: 0, sortTimestamp };
        }
        monthlyMap[monthKey].hours += r.overtimeHours;
        monthlyMap[monthKey].cost += cost;
        monthlyMap[monthKey].fooding += foodingCost;
      }

      if (dayName && dayOfWeekMap[dayName]) {
        dayOfWeekMap[dayName].hours += r.overtimeHours;
        dayOfWeekMap[dayName].cost += cost;
      }
    }

    const daily = Object.values(dailyMap).sort((a, b) => a.ts - b.ts);
    const monthly = Object.values(monthlyMap).sort((a, b) => a.sortTimestamp - b.sortTimestamp);
    const dayOfWeek = Object.values(dayOfWeekMap);

    return { daily, monthly, dayOfWeek };
  }, [records, employeeMap]);

  // Pre-calculate data for departments
  const departmentData = React.useMemo(() => {
    const deptMap: Record<string, { department: string; hours: number; cost: number; foodingCost: number; count: number }> = {};
    for (const r of records) {
      const cost = r.precomputedOTCost ?? calculateOTCost(r, r.overtimeHours, r.date);
      const foodingCost = r.foodingApplicable * 50;

      if (!deptMap[r.department]) {
        deptMap[r.department] = { department: r.department, hours: 0, cost: 0, foodingCost: 0, count: 0 };
      }
      deptMap[r.department].hours += r.overtimeHours;
      deptMap[r.department].cost += cost;
      deptMap[r.department].foodingCost += foodingCost;
      deptMap[r.department].count += 1;
    }
    return Object.values(deptMap).sort((a, b) => b.hours - a.hours);
  }, [records, employeeMap]);

  // Top list metrics
  const topLists = React.useMemo(() => {
    const empHours: Record<string, { name: string; code: string; hours: number; cost: number; department: string }> = {};
    const payrollHours: Record<string, { payroll: string; hours: number; cost: number; value: number }> = {};

    for (const r of records) {
      const cost = r.precomputedOTCost ?? calculateOTCost(r, r.overtimeHours, r.date);

      if (!empHours[r.employeeCode]) {
        empHours[r.employeeCode] = { name: r.employeeName, code: r.employeeCode, hours: 0, cost: 0, department: r.department };
      }
      empHours[r.employeeCode].hours += r.overtimeHours;
      empHours[r.employeeCode].cost += cost;

      if (!payrollHours[r.payroll]) {
        payrollHours[r.payroll] = { payroll: r.payroll, hours: 0, cost: 0, value: 0 };
      }
      payrollHours[r.payroll].hours += r.overtimeHours;
      payrollHours[r.payroll].cost += cost;
      payrollHours[r.payroll].value += r.overtimeHours;
    }

    const topEmployees = Object.values(empHours).sort((a, b) => b.cost - a.cost).slice(0, 10);
    const topDepts = departmentData.slice(0, 10);
    const payrollList = Object.values(payrollHours);

    return { topEmployees, topDepts, payrollList };
  }, [records, employeeMap, departmentData]);

  // User-wise entries
  const userData = React.useMemo(() => {
    const userMap: Record<string, { user: string; entries: number; hours: number; cost: number }> = {};
    for (const r of records) {
      const u = r.enteredBy || 'Unknown';
      const cost = r.precomputedOTCost ?? calculateOTCost(r, r.overtimeHours, r.date);

      if (!userMap[u]) {
        userMap[u] = { user: u, entries: 0, hours: 0, cost: 0 };
      }
      userMap[u].entries += 1;
      userMap[u].hours += r.overtimeHours;
      userMap[u].cost += cost;
    }
    return Object.values(userMap).sort((a, b) => b.entries - a.entries);
  }, [records, employeeMap]);

  const handleBarClick = (data: any, field: string) => {
    if (data && data.activePayload && data.activePayload[0]) {
      const payload = data.activePayload[0].payload;
      if (field === 'department' && payload.department) {
        onFilterChange('department', payload.department);
      } else if (field === 'employee' && payload.code) {
        onFilterChange('employeeCode', payload.code);
      } else if (field === 'enteredBy' && payload.user) {
        onFilterChange('enteredBy', payload.user);
      }
    }
  };

  return (
    <div id="dashboard_charts_section" className="bg-white/60 backdrop-blur-md rounded-2xl border border-slate-200/50 p-6 shadow-sm">
      {/* Chart controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500 mb-1">Visual Insights</div>
          <h3 className="text-lg font-bold tracking-tight text-slate-900">Overtime Analytics</h3>
          <p className="text-xs font-medium text-slate-400">Click on any chart bar to filter the records list below</p>
        </div>
        <div className="flex bg-slate-100/80 p-1 rounded-xl self-stretch sm:self-auto overflow-x-auto border border-slate-200/40">
          <button
            onClick={() => setActiveChartGroup('trends')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
              activeChartGroup === 'trends' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Trends
          </button>
          <button
            onClick={() => setActiveChartGroup('departments')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
              activeChartGroup === 'departments' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Departments
          </button>
          <button
            onClick={() => setActiveChartGroup('topLists')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
              activeChartGroup === 'topLists' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Top Workers
          </button>
          <button
            onClick={() => setActiveChartGroup('users')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
              activeChartGroup === 'users' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            Operators
          </button>
        </div>
      </div>

      {/* Main visual frame */}
      <div className="min-h-[320px] w-full">
        {activeChartGroup === 'trends' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-indigo-50/50 border-t-4 border-indigo-500 p-5 rounded-xl border border-slate-200/50">
              <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <span className="bg-indigo-100 p-1 rounded-md text-indigo-600"><Calendar className="w-3.5 h-3.5" /></span>
                  Monthly Overtime Trend (Hours & Amount)
                </span>
                <button
                  type="button"
                  onClick={() => exportToCSV(
                    trendData.monthly,
                    'monthly_overtime_trends.csv',
                    [
                      { key: 'month', label: 'Month' },
                      { key: 'hours', label: 'Overtime Hours' },
                      { key: 'cost', label: 'Overtime Salary Cost (Rs.)' },
                      { key: 'fooding', label: 'Fooding Cost (Rs.)' }
                    ]
                  )}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-700 bg-indigo-100/60 hover:bg-indigo-100 rounded-md transition-colors cursor-pointer"
                  title="Export to Excel"
                >
                  <Download className="w-3 h-3" /> Export Excel
                </button>
              </div>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData.monthly}>
                    <XAxis dataKey="month" stroke="#94a3b8" fontSize={11} />
                    <YAxis yAxisId="left" stroke="#4f46e5" fontSize={11} label={{ value: 'Hours', angle: -90, position: 'insideLeft', offset: 0, style: { fontSize: 10, fill: '#4f46e5', fontWeight: 600 } }} />
                    <YAxis yAxisId="right" orientation="right" stroke="#16a34a" fontSize={11} label={{ value: 'Amount (Rs)', angle: 90, position: 'insideRight', offset: 0, style: { fontSize: 10, fill: '#16a34a', fontWeight: 600 } }} />
                    <Tooltip 
                      formatter={(value: any, name: any) => {
                        if (name.includes('Amount')) {
                          return [formatCurrency(value), 'OT Amount'];
                        }
                        return [`${value} Hrs`, 'OT Hours'];
                      }}
                      contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px', fontWeight: 600 }} 
                    />
                    <Legend wrapperStyle={{ fontSize: 11, fontWeight: 600 }} />
                    <Line yAxisId="left" type="monotone" dataKey="hours" name="OT Hours" stroke="#4f46e5" strokeWidth={3} activeDot={{ r: 6 }} />
                    <Line yAxisId="right" type="monotone" dataKey="cost" name="OT Amount" stroke="#16a34a" strokeWidth={3} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-emerald-50/50 border-t-4 border-emerald-500 p-5 rounded-xl border border-slate-200/50">
              <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <span className="bg-emerald-100 p-1 rounded-md text-emerald-600"><TrendingUp className="w-3.5 h-3.5" /></span>
                  Daily Workload, OT Cost & Fooding
                </span>
                <button
                  type="button"
                  onClick={() => exportToCSV(
                    trendData.daily,
                    'daily_overtime_workload.csv',
                    [
                      { key: 'date', label: 'Date' },
                      { key: 'hours', label: 'Overtime Hours' },
                      { key: 'cost', label: 'Overtime Salary Cost (Rs.)' },
                      { key: 'fooding', label: 'Fooding Cost (Rs.)' }
                    ]
                  )}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100/60 hover:bg-emerald-100 rounded-md transition-colors cursor-pointer"
                  title="Export to Excel"
                >
                  <Download className="w-3 h-3" /> Export Excel
                </button>
              </div>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData.daily}>
                    <XAxis dataKey="date" stroke="#94a3b8" fontSize={10} tickFormatter={formatXAxisDate} />
                    <YAxis yAxisId="left" stroke="#059669" fontSize={11} label={{ value: 'Hours', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#059669' } }} />
                    <YAxis yAxisId="right" orientation="right" stroke="#4f46e5" fontSize={11} label={{ value: 'Cost (Rs)', angle: 90, position: 'insideRight', style: { fontSize: 9, fill: '#4f46e5' } }} />
                    <Tooltip 
                      formatter={(value: any, name: any) => {
                        if (name.includes('Amount') || name.includes('Allowance')) {
                          return [formatCurrency(value), name];
                        }
                        return [`${value} Hrs`, name];
                      }}
                      contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px', fontWeight: 600 }} 
                    />
                    <Legend wrapperStyle={{ fontSize: 11, fontWeight: 600 }} />
                    <Area yAxisId="left" type="monotone" dataKey="hours" name="OT Hours" stroke="#059669" fill="#d1fae5" fillOpacity={0.6} />
                    <Area yAxisId="right" type="monotone" dataKey="cost" name="OT Amount (Rs)" stroke="#4f46e5" fill="#e0e7ff" fillOpacity={0.2} />
                    <Area yAxisId="right" type="monotone" dataKey="fooding" name="Food Allowance (Rs)" stroke="#d97706" fill="#fef3c7" fillOpacity={0.1} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {activeChartGroup === 'departments' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-slate-50/50 border-t-4 border-slate-500 p-5 rounded-xl border border-slate-200/50">
              <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Department-wise OT Hours & Cost (Interactive)
                </span>
                <button
                  type="button"
                  onClick={() => exportToCSV(
                    departmentData,
                    'department_overtime_summary.csv',
                    [
                      { key: 'department', label: 'Department' },
                      { key: 'hours', label: 'Total Overtime Hours' },
                      { key: 'cost', label: 'Overtime Salary Cost (Rs.)' },
                      { key: 'foodingCost', label: 'Fooding Cost (Rs.)' },
                      { key: 'count', label: 'Record Count' }
                    ]
                  )}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-700 bg-slate-200/60 hover:bg-slate-200 rounded-md transition-colors cursor-pointer border border-slate-300/30"
                  title="Export to Excel"
                >
                  <Download className="w-3 h-3" /> Export Excel
                </button>
              </div>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={departmentData} onClick={(data) => handleBarClick(data, 'department')}>
                    <XAxis dataKey="department" stroke="#94a3b8" fontSize={10} interval={0} tickFormatter={(val) => val.slice(0, 10)} />
                    <YAxis stroke="#94a3b8" fontSize={11} />
                    <Tooltip 
                      formatter={(value: any, name: any, props: any) => {
                        const payload = props.payload;
                        return [
                          `Hours: ${payload.hours} Hrs | Amount: ${formatCurrency(payload.cost)}`,
                          'Department Overtime'
                        ];
                      }}
                      contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px', fontWeight: 700 }} 
                    />
                    <Bar dataKey="hours" name="OT Hours" fill="#4f46e5" cursor="pointer">
                      {departmentData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-amber-50/50 border-t-4 border-amber-500 p-5 rounded-xl border border-slate-200/50">
              <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Department-wise Overtime & Food Cost
                </span>
                <button
                  type="button"
                  onClick={() => exportToCSV(
                    departmentData,
                    'department_cost_breakdown.csv',
                    [
                      { key: 'department', label: 'Department' },
                      { key: 'hours', label: 'OT Hours' },
                      { key: 'cost', label: 'OT Salary Cost (Rs.)' },
                      { key: 'foodingCost', label: 'Fooding Cost (Rs.)' }
                    ]
                  )}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-100/60 hover:bg-amber-100 rounded-md transition-colors cursor-pointer"
                  title="Export to Excel"
                >
                  <Download className="w-3 h-3" /> Export Excel
                </button>
              </div>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={departmentData}>
                    <XAxis dataKey="department" stroke="#94a3b8" fontSize={10} interval={0} tickFormatter={(val) => val.slice(0, 10)} />
                    <YAxis stroke="#94a3b8" fontSize={11} />
                    <Tooltip formatter={(value: any) => [formatCurrency(value), 'Cost']} contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px', fontWeight: 700 }} />
                    <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                    <Bar dataKey="cost" name="OT Salary Cost (Rs)" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="foodingCost" name="Fooding Cost (Rs)" fill="#d97706" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {activeChartGroup === 'topLists' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-slate-50/50 border-t-4 border-slate-500 p-5 rounded-xl border border-slate-200/50">
              <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Top 10 Overtime Employees (Interactive)
                </span>
                <button
                  type="button"
                  onClick={() => exportToCSV(
                    topLists.topEmployees,
                    'top_overtime_employees.csv',
                    [
                      { key: 'name', label: 'Employee Name' },
                      { key: 'code', label: 'Employee Code' },
                      { key: 'department', label: 'Department' },
                      { key: 'hours', label: 'Overtime Hours' },
                      { key: 'cost', label: 'Overtime Cost (Rs.)' }
                    ]
                  )}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-700 bg-slate-200/60 hover:bg-slate-200 rounded-md transition-colors cursor-pointer border border-slate-300/30"
                  title="Export to Excel"
                >
                  <Download className="w-3 h-3" /> Export Excel
                </button>
              </div>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topLists.topEmployees} layout="vertical" onClick={(data) => handleBarClick(data, 'employee')}>
                    <XAxis type="number" stroke="#94a3b8" fontSize={10} tickFormatter={(val) => formatCurrency(val)} />
                    <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={10} width={100} />
                    <Tooltip 
                      formatter={(value: any, name: any, props: any) => {
                        const payload = props.payload;
                        return [
                          `Amount: ${formatCurrency(payload.cost)} | Hours: ${payload.hours} Hrs`,
                          'Employee Overtime Cost'
                        ];
                      }}
                      contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px', fontWeight: 700 }} 
                    />
                    <Bar dataKey="cost" name="OT Amount (Rs)" fill="#4f46e5" cursor="pointer" barSize={12} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-indigo-50/50 border-t-4 border-indigo-500 p-5 rounded-xl border border-slate-200/50 flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-center mb-4">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Payroll Segment Distribution
                  </span>
                  <button
                    type="button"
                    onClick={() => exportToCSV(
                      topLists.payrollList,
                      'payroll_segment_overtime.csv',
                      [
                        { key: 'payroll', label: 'Payroll Segment' },
                        { key: 'hours', label: 'Overtime Hours' },
                        { key: 'cost', label: 'Overtime Cost (Rs.)' }
                      ]
                    )}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-700 bg-indigo-100/60 hover:bg-indigo-100 rounded-md transition-colors cursor-pointer"
                    title="Export to Excel"
                  >
                    <Download className="w-3 h-3" /> Export Excel
                  </button>
                </div>
                <div className="h-[200px] flex justify-center items-center">
                  {topLists.payrollList.length === 0 ? (
                    <span className="text-xs text-slate-400 italic">No Data</span>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={topLists.payrollList}
                          dataKey="hours"
                          nameKey="payroll"
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={75}
                          paddingAngle={3}
                          label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {topLists.payrollList.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip 
                          formatter={(value: any, name: any, props: any) => {
                            const payload = props.payload;
                            return [
                              `Hours: ${payload.hours} Hrs | Cost: ${formatCurrency(payload.cost)}`,
                              'Payroll Overtime'
                            ];
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px] font-bold text-slate-500 pt-3 border-t border-slate-200/60 font-mono">
                {topLists.payrollList.map((entry, index) => (
                  <div key={entry.payroll} className="flex items-center gap-1.5 font-sans">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }}></span>
                    <span className="truncate">{entry.payroll}: {entry.hours} Hrs ({formatCurrency(entry.cost)})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeChartGroup === 'users' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-emerald-50/50 border-t-4 border-emerald-500 p-5 rounded-xl border border-slate-200/50">
              <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  User Entry Contribution (Count & Value)
                </span>
                <button
                  type="button"
                  onClick={() => exportToCSV(
                    userData,
                    'operator_entry_contributions.csv',
                    [
                      { key: 'user', label: 'Operator (Entered By)' },
                      { key: 'entries', label: 'Form Records Entered' },
                      { key: 'hours', label: 'Total Overtime Hours' },
                      { key: 'cost', label: 'Total Overtime Cost (Rs.)' }
                    ]
                  )}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100/60 hover:bg-emerald-100 rounded-md transition-colors cursor-pointer"
                  title="Export to Excel"
                >
                  <Download className="w-3 h-3" /> Export Excel
                </button>
              </div>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={userData} onClick={(data) => handleBarClick(data, 'enteredBy')}>
                    <XAxis dataKey="user" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} />
                    <Tooltip 
                      formatter={(value: any, name: any, props: any) => {
                        const payload = props.payload;
                        return [
                          `Entries: ${payload.entries} | Hours: ${payload.hours} Hrs | Cost: ${formatCurrency(payload.cost)}`,
                          'Operator Profile'
                        ];
                      }}
                      contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px', fontWeight: 700 }} 
                    />
                    <Bar dataKey="entries" name="Records Handled" fill="#059669" cursor="pointer" barSize={32} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-amber-50/50 border-t-4 border-amber-500 p-5 rounded-xl border border-slate-200/50 flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-center mb-4">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Day of the Week Overtime Work Load
                  </span>
                  <button
                    type="button"
                    onClick={() => exportToCSV(
                      trendData.dayOfWeek,
                      'weekly_overtime_distribution.csv',
                      [
                        { key: 'day', label: 'Day of Week' },
                        { key: 'hours', label: 'Overtime Hours' },
                        { key: 'cost', label: 'Overtime Cost (Rs.)' }
                      ]
                    )}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-100/60 hover:bg-amber-100 rounded-md transition-colors cursor-pointer"
                    title="Export to Excel"
                  >
                    <Download className="w-3 h-3" /> Export Excel
                  </button>
                </div>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trendData.dayOfWeek}>
                      <XAxis dataKey="day" stroke="#94a3b8" fontSize={10} />
                      <YAxis stroke="#94a3b8" fontSize={11} />
                      <Tooltip 
                        formatter={(value: any, name: any, props: any) => {
                          const payload = props.payload;
                          return [
                            `Hours: ${payload.hours} Hrs | Amount: ${formatCurrency(payload.cost)}`,
                            'Day Workload'
                          ];
                        }}
                        contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px', fontWeight: 700 }} 
                      />
                      <Bar dataKey="hours" name="OT Hours" fill="#d97706" barSize={24} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const DashboardCharts = React.memo(DashboardChartsComponent);
