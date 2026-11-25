/**
 * Shared Stats & Summary Types
 * Safe to import from both Client Components and Server Components.
 */

export type StatsRole =
  | "ADMIN"
  | "TEACHER"
  | "PARENT"
  | "STAFF"
  | "NON_TEACHING_STAFF"
  | "DRIVER"
  | "CONDUCTOR"
  | "SUPPORT_STAFF";

export interface StatsScope {
  role: StatsRole | string;
  userId?: string;
  teacherId?: string;
  parentId?: string;
}

export interface CoreCountsFilters {
  classId?: string;
  batch?: string;
  academicYear?: string;
  status?: "ALL" | "ACTIVE" | "INACTIVE";
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface StudentStatsSummary {
  /** Active non-graduated/non-transferred students */
  activeStudents: number;
  /** All students including inactive and graduated */
  allStudentsIncludingInactive: number;
  /** Inactive or graduated students */
  inactiveOrGraduatedStudents: number;
  /** Active Day Scholars */
  dayScholars: number;
  /** Active Hostelers */
  hostelers: number;
}

export interface TeacherStatsSummary {
  /** Active Teacher profiles with ACTIVE backing User */
  activeTeachers: number;
  /** All Teacher profiles including inactive */
  allTeachersIncludingInactive: number;
}

export interface ParentStatsSummary {
  /** Canonical Parent profile accounts (excludes orphan non-parent users) */
  totalParents: number;
  /** Enabled parents (Parent.isActive && User.ACTIVE) linked to >= 1 active student */
  activeParents: number;
  /** Enabled parents regardless of student link */
  enabledParents: number;
  /** Parents with zero active linked students */
  parentsWithoutActiveStudents: number;
  /** Active students count for consistency across Parents & Students views */
  totalStudentsCount: number;
}

export interface ClassStatsSummary {
  /** Active Class-Section rows (e.g. 29) */
  totalSections: number;
  /** Distinct active class levels grouped by Class.name (e.g. 12) */
  distinctClasses: number;
  /** Sections assigned a canonical Class Teacher */
  sectionsWithClassTeacher: number;
}

export interface SubjectStatsSummary {
  /** Distinct active subject names (e.g. 14) */
  distinctSubjects: number;
  /** Total active class-subject allocations (e.g. 114) */
  totalAllocations: number;
}

export interface AdminDashboardSummary {
  students: StudentStatsSummary;
  teachers: TeacherStatsSummary;
  parents: ParentStatsSummary;
  classes: ClassStatsSummary;
  subjects: SubjectStatsSummary;
}

export interface AttendanceStatsResult {
  officialWorkingDays: number;
  officialWorkingSessions: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  leaveCount: number;
  recordedSessions: number;
  attendedSessions: number;
  totalWorkingSessions: number;
  /** Null when zero working sessions exist; otherwise 1-decimal string e.g. "92.5" */
  percentage: string;
  /** Numeric percentage (0..100 rounded to 1 decimal), or null if no working sessions */
  percentageValue: number | null;
  hasWorkingSessions: boolean;
}

export interface NotificationUnreadStats {
  unreadCount: number;
  notificationCount: number;
  messageCount: number;
  busAlertCount: number;
  hasBusAlert: boolean;
}

export interface DataCheckIssue {
  id: string;
  category:
    | "ROLE_MISMATCH"
    | "ORPHAN_PARENT_USER"
    | "PARENT_WITHOUT_STUDENT"
    | "STUDENT_WITHOUT_PARENT"
    | "STUDENT_WITHOUT_CLASS"
    | "CLASS_WITHOUT_TEACHER"
    | "LEGACY_CLASS_TEACHER_SYNC"
    | "INVALID_BUS_ASSIGNMENT"
    | "NOTIFICATION_READ_DRIFT";
  severity: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  description: string;
  recordId: string;
  canAutoFix: boolean;
  openHref: string;
}

export interface ReconciliationSummaryReport {
  checkedAt: string;
  counts: AdminDashboardSummary;
  issues: DataCheckIssue[];
  summary: {
    totalIssues: number;
    highSeverity: number;
    autoFixable: number;
  };
}
