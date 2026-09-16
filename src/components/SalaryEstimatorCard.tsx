import React, { useEffect, useMemo, useState } from 'react';
import { IndianRupee, TrendingUp, Users, Info, RefreshCw } from 'lucide-react';
import { Employee, OvertimeRecord } from '../types';
import { formatCurrency } from '../utils/calculations';
import { fetchAttendanceSummary, AttendanceSummary } from '../lib/petpoojaApi';

interface SalaryEstimatorCardProps {
  employees: Employee[];
  records: OvertimeRecord[];
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function SalaryEstimatorCard({ employees, records }: SalaryEstimatorCardProps) {
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  const monthKey = currentMonthKey();

  const loadSummary = async () => {
    setLoading(true);
    setError(null);
    setNotConfigured(false);
    try {
      const data = await fetchAttendanceSummary(monthKey);
      setSummary(data);
    } catch (err: any) {
      if (String(err.message || '').toLowerCase().includes('not configured')) {
        setNotConfigured(true);
      } else {
        setError(err.message || 'Failed to load attendance summary');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey]);

  const fixedMonthlyTotalLocal = useMemo(() => {
    return employees
      .filter(e => e.wageType !== 'Daily')
      .reduce((sum, e) => sum + (e.totalSalary || 0), 0);
  }, [employees]);

  const { otCostMTD, foodingCostMTD } = useMemo(() => {
    let ot = 0;
    let food = 0;
    for (const r of records) {
      if (r.date && r.date.startsWith(monthKey)) {
        ot += r.precomputedOTCost ?? 0;
        food += (r.foodingApplicable || 0) * 50;
      }
    }
    return { otCostMTD: Math.round(ot), foodingCostMTD: Math.round(food) };
  }, [records, monthKey]);

  const fixedMonthlyTotal = summary?.totals.fixedMonthlyTotal ?? Math.round(fixedMonthlyTotalLocal);
  const actualDailyWageMTD = summary?.totals.actualDailyWageMTD ?? 0;
  const projectedDailyWageForMonth = summary?.totals.projectedDailyWageForMonth ?? 0;
  const dailyWorkerCount = summary?.totals.dailyWorkerCount ?? employees.filter(e => e.wageType === 'Daily').length;

  const estimatedTotalThisMonth = fixedMonthlyTotal + projectedDailyWageForMonth + otCostMTD + foodingCostMTD;
  const actualSoFar = fixedMonthlyTotal + actualDailyWageMTD + otCostMTD + foodingCostMTD;

  const recentDays = summary?.dailyBreakdown.slice(-7) || [];
  const maxDailyCost = Math.max(1, ...recentDays.map(d => d.dailyWageCost));

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-xs p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-500 mb-1">Live Payroll Run-Rate</div>
          <h2 className="text-base font-semibold tracking-tight text-slate-900">Estimated Salary This Month</h2>
          <p className="text-xs text-slate-400 font-medium">Fixed payroll + daily-wage attendance + overtime, updated as biometric attendance comes in</p>
        </div>
        <button
          type="button"
          onClick={loadSummary}
          disabled={loading}
          className="text-slate-400 hover:text-indigo-600 transition-colors cursor-pointer disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {notConfigured && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800 font-medium leading-relaxed">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          Connect the Petpooja biometric API (set <code className="bg-white/70 border border-amber-200 rounded px-1">PETPOOJA_BASE_URL</code>,{' '}
          <code className="bg-white/70 border border-amber-200 rounded px-1">PETPOOJA_CLIENT_ID</code>,{' '}
          <code className="bg-white/70 border border-amber-200 rounded px-1">PETPOOJA_CLIENT_SECRET</code> as Secrets) to include real-time
          daily-wage attendance in this estimate. Shown below: fixed payroll + overtime + fooding only.
        </div>
      )}
      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-[11px] text-rose-700 font-semibold">{error}</div>
      )}

      <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 block mb-1">Projected Total This Month</span>
          <span className="text-2xl font-bold text-emerald-700">{formatCurrency(estimatedTotalThisMonth)}</span>
        </div>
        <div className="text-right">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block mb-1">Actual So Far (MTD)</span>
          <span className="text-lg font-bold text-slate-700">{formatCurrency(actualSoFar)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 block leading-tight">Fixed Payroll</span>
          <span className="text-sm font-semibold text-slate-900 block mt-1">{formatCurrency(fixedMonthlyTotal)}</span>
        </div>
        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 block leading-tight flex items-center gap-1">
            <Users className="w-3 h-3" /> Daily Wage ({dailyWorkerCount} workers)
          </span>
          <span className="text-sm font-semibold text-indigo-600 block mt-1">
            {formatCurrency(actualDailyWageMTD)} <span className="text-[10px] text-slate-400 font-medium">so far &rarr; {formatCurrency(projectedDailyWageForMonth)} proj.</span>
          </span>
        </div>
        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 block leading-tight">Overtime (MTD)</span>
          <span className="text-sm font-semibold text-amber-600 block mt-1">{formatCurrency(otCostMTD)}</span>
        </div>
        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 block leading-tight">Food Allowance (MTD)</span>
          <span className="text-sm font-semibold text-slate-900 block mt-1">{formatCurrency(foodingCostMTD)}</span>
        </div>
      </div>

      {recentDays.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
            <TrendingUp className="w-3.5 h-3.5" /> Daily Wage Cost &mdash; Last {recentDays.length} Days
          </div>
          <div className="flex items-end gap-2 h-20">
            {recentDays.map(d => (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-indigo-400/80 rounded-t-md min-h-[2px]"
                  style={{ height: `${(d.dailyWageCost / maxDailyCost) * 100}%` }}
                  title={`${d.date}: ${formatCurrency(d.dailyWageCost)} (${d.presentCount} present)`}
                />
                <span className="text-[8px] text-slate-400 font-medium">{d.date.slice(-2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-start gap-1.5 text-[10px] text-slate-400 font-medium leading-relaxed">
        <IndianRupee className="w-3 h-3 mt-0.5 shrink-0" />
        Daily wage is projected by scaling actual cost-so-far to the full month; overtime and fooding are actuals only (not projected forward) since they vary day to day.
      </div>
    </div>
  );
}
