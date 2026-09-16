export interface Employee {
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
}

export interface OvertimeRecord {
  rowIndex: number; // 1-based index in the Google Sheet, useful for editing/deleting
  timestamp: string;
  employeeCode: string;
  employeeName: string;
  designation: string;
  department: string;
  payroll: string;
  date: string;
  overtimeHours: number;
  foodingApplicable: number; // 0 or 1
  enteredBy: string;
  remarks: string; // Used for OPF Number
  reasonForOvertime: string;
  approvalForOT?: string;
  basic?: number;
  hra?: number;
  splAllowance?: number;
  conveyance?: number;
  lta?: number;
  otherAllowance?: number;
  bonus?: number;
  totalSalary?: number;
  parsedTimestamp?: number;
  precomputedOTCost?: number;
  monthKey?: string;
  longMonthKey?: string;
  monthSortTimestamp?: number;
  dayName?: string;
}

export interface UserCredentials {
  id: string;
  passwordHash: string; // The plain text password from the sheet
  type: 'User' | 'Admin';
}

export interface AppUser {
  id: string;
  type: 'User' | 'Admin';
}

export interface DashboardFilters {
  startDate: string;
  endDate: string;
  department: string;
  employeeCode: string;
  payroll: string;
  designation: string;
  enteredBy: string;
  overtimeHoursOperator: 'all' | 'gt' | 'lt' | 'eq';
  overtimeHoursValue: string;
  remarks: string;
  reasonForOvertime: string;
}
