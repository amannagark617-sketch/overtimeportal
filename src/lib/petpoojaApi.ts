export interface PetpoojaStatus {
  configured: boolean;
  standardShiftHours: number;
}

export interface PunchSuggestion {
  employeeCode: string;
  employeeName: string;
  workedHours: number;
  otHours: number;
  punchCount: number;
  hasOpenPunch: boolean;
}

export interface PunchSuggestionsResponse {
  date: string;
  standardShiftHours: number;
  employees: PunchSuggestion[];
}

export interface AttendanceDaySummary {
  date: string;
  presentCount: number;
  dailyWageCost: number;
}

export interface AttendanceSummary {
  month: string;
  daysInMonth: number;
  daysElapsed: number;
  dailyBreakdown: AttendanceDaySummary[];
  totals: {
    fixedMonthlyTotal: number;
    dailyWorkerCount: number;
    actualDailyWageMTD: number;
    projectedDailyWageForMonth: number;
  };
}

async function handleJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (HTTP ${response.status})`);
  }
  return data as T;
}

export async function fetchPetpoojaStatus(): Promise<PetpoojaStatus> {
  const response = await fetch('/api/petpooja/status');
  return handleJson<PetpoojaStatus>(response);
}

export async function fetchPunchSuggestions(date: string): Promise<PunchSuggestionsResponse> {
  const response = await fetch(`/api/petpooja/punches?date=${encodeURIComponent(date)}`);
  return handleJson<PunchSuggestionsResponse>(response);
}

export async function fetchAttendanceSummary(month: string): Promise<AttendanceSummary> {
  const response = await fetch(`/api/petpooja/attendance-summary?month=${encodeURIComponent(month)}`);
  return handleJson<AttendanceSummary>(response);
}

export interface PetpoojaOvertimeRecord {
  employeeCode: string;
  employeeName: string;
  date: string;
  overtimeHours: number;
  workedHours: number;
}

export interface PetpoojaOvertimeRecordsResponse {
  start: string;
  end: string;
  standardShiftHours: number;
  records: PetpoojaOvertimeRecord[];
}

export async function fetchPetpoojaOvertimeRecords(start: string, end: string): Promise<PetpoojaOvertimeRecordsResponse> {
  const response = await fetch(`/api/petpooja/overtime-records?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
  return handleJson<PetpoojaOvertimeRecordsResponse>(response);
}
