import React, { useEffect, useState } from 'react';
import { RadioTower, RefreshCw, AlertTriangle, Fingerprint, Info } from 'lucide-react';
import { Employee, OvertimeRecord } from '../types';
import { fetchPetpoojaStatus, fetchPunchSuggestions, PunchSuggestion } from '../lib/petpoojaApi';

function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface BiometricSyncPanelProps {
  employees: Employee[];
  existingRecords: OvertimeRecord[];
  onImport: (items: { employeeCode: string; otHours: number; date: string }[]) => void;
}

export function BiometricSyncPanel({ employees, existingRecords, onImport }: BiometricSyncPanelProps) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [standardShiftHours, setStandardShiftHours] = useState(8);
  const [date, setDate] = useState(yesterdayISO());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PunchSuggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchPetpoojaStatus()
      .then(status => {
        setConfigured(status.configured);
        setStandardShiftHours(status.standardShiftHours);
      })
      .catch(() => setConfigured(false));
  }, []);

  const employeeByCode = new Map(employees.map(e => [e.employeeCode, e]));

  const isDuplicate = (employeeCode: string) =>
    existingRecords.some(r => r.employeeCode === employeeCode && r.date === date);

  const handleFetch = async () => {
    setLoading(true);
    setError(null);
    setResults([]);
    setSelected(new Set());
    try {
      const res = await fetchPunchSuggestions(date);
      setResults(res.employees);
      const defaultSelected = new Set(
        res.employees
          .filter(e => e.otHours > 0 && employeeByCode.has(e.employeeCode) && !isDuplicate(e.employeeCode))
          .map(e => e.employeeCode)
      );
      setSelected(defaultSelected);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch punch data');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelected = (code: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleImport = () => {
    const items = results
      .filter(r => selected.has(r.employeeCode))
      .map(r => ({ employeeCode: r.employeeCode, otHours: r.otHours, date }));
    onImport(items);
    setResults(prev => prev.filter(r => !selected.has(r.employeeCode)));
    setSelected(new Set());
  };

  if (configured === false) {
    return (
      <div className="bg-slate-50 border border-slate-100 rounded-xl p-5 text-xs">
        <div className="flex items-center gap-2 text-slate-500 font-semibold uppercase tracking-wider text-[10px] mb-2">
          <Fingerprint className="w-4 h-4" /> Biometric Punch Import
        </div>
        <p className="text-slate-500 font-medium leading-relaxed flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Not connected yet. Add <code className="bg-white border border-slate-200 rounded px-1 py-0.5">PETPOOJA_BASE_URL</code>,{' '}
          <code className="bg-white border border-slate-200 rounded px-1 py-0.5">PETPOOJA_CLIENT_ID</code> and{' '}
          <code className="bg-white border border-slate-200 rounded px-1 py-0.5">PETPOOJA_CLIENT_SECRET</code> as Secrets (from the
          punch device vendor's integration email) to pull attendance automatically instead of typing hours in by hand.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-xs overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 cursor-pointer"
      >
        <div className="flex items-center gap-2.5">
          <div className="bg-indigo-50 p-1.5 rounded-lg text-indigo-600"><RadioTower className="w-4 h-4" /></div>
          <div className="text-left">
            <h3 className="text-sm font-semibold text-slate-900">Import from Biometric Device</h3>
            <p className="text-[10px] text-slate-400 font-medium">Pull punch in/out data and auto-fill overtime hours instead of typing them manually</p>
          </div>
        </div>
        <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">{expanded ? 'Hide' : 'Show'}</span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Punch Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => { setDate(e.target.value); setResults([]); setSelected(new Set()); }}
                max={yesterdayISO()}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-hidden"
              />
            </div>
            <button
              type="button"
              onClick={handleFetch}
              disabled={loading}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Fetch Punch Data
            </button>
            <span className="text-[10px] text-slate-400 font-medium">
              Standard shift: {standardShiftHours}h/day &mdash; hours worked beyond this are suggested as overtime
            </span>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-[11px] text-rose-700 font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          {results.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-lg border border-slate-100">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-400 uppercase text-[9px] tracking-wider">
                      <th className="py-2 px-3 text-left w-8"></th>
                      <th className="py-2 px-3 text-left">Employee</th>
                      <th className="py-2 px-3 text-right">Worked Hrs</th>
                      <th className="py-2 px-3 text-right">Suggested OT</th>
                      <th className="py-2 px-3 text-left">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {results.map(r => {
                      const emp = employeeByCode.get(r.employeeCode);
                      const dup = isDuplicate(r.employeeCode);
                      const unmatched = !emp;
                      const disabled = dup || unmatched;
                      return (
                        <tr key={r.employeeCode} className={disabled ? 'opacity-50' : ''}>
                          <td className="py-2 px-3">
                            <input
                              type="checkbox"
                              checked={selected.has(r.employeeCode)}
                              disabled={disabled || r.otHours <= 0}
                              onChange={() => toggleSelected(r.employeeCode)}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
                            />
                          </td>
                          <td className="py-2 px-3 font-semibold text-slate-700">
                            {emp?.employeeName || r.employeeName} <span className="text-slate-400 font-medium">({r.employeeCode})</span>
                          </td>
                          <td className="py-2 px-3 text-right font-semibold text-slate-700">{r.workedHours}h</td>
                          <td className="py-2 px-3 text-right font-semibold text-emerald-600">{r.otHours > 0 ? `${r.otHours}h` : '—'}</td>
                          <td className="py-2 px-3 text-[10px] text-slate-400 font-medium">
                            {unmatched && 'No matching employee code in Master Data'}
                            {dup && 'Already logged for this date'}
                            {r.hasOpenPunch && ' Missing final Out punch'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={handleImport}
                disabled={selected.size === 0}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-xl cursor-pointer transition-all"
              >
                Add {selected.size || ''} Selected to Queue
              </button>
              <p className="text-[10px] text-slate-400 font-medium">
                Imported rows still need an OPF Number, Reason and Approval file before saving &mdash; nothing is written to the database yet.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
