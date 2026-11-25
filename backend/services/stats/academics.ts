import "server-only";
import {
  DEFAULT_GRADE_BOUNDARIES,
  GradeBoundary,
  calculateReportCardGrade as computeGradeFromBoundaries,
} from "@/lib/report-card/grading";

/**
 * Single source of truth for rounding all academic percentages to 1 decimal place.
 */
export function roundOneDecimal(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

export function formatOneDecimal(value: number): string {
  return roundOneDecimal(value).toFixed(1);
}

/**
 * Safe percentage calculation guarding against 0 denominator.
 */
export function calculatePercentage(obtained: number, maxTotal: number): number {
  if (!Number.isFinite(obtained) || !Number.isFinite(maxTotal) || maxTotal <= 0) {
    return 0;
  }
  const pct = (Math.max(0, obtained) / maxTotal) * 100;
  return roundOneDecimal(Math.min(100, Math.max(0, pct)));
}

export function normalizeExamResultLabel(result?: string | null): "PASS" | "FAIL" {
  const clean = (result || "").trim().toUpperCase();
  if (clean === "PASS" || clean === "PASSED") return "PASS";
  return "FAIL";
}

export { DEFAULT_GRADE_BOUNDARIES };
export type { GradeBoundary };

/**
 * Canonical Grade Calculation across UI, PDF, Excel Exports, Analytics & Dispatch.
 * Scale: >=90 A+, >=80 A, >=70 B+, >=60 B, >=50 C, >=35 D, <35 F (or any failed subject => F).
 */
export function getUnifiedReportCardGrade(
  percentage: number | null | undefined,
  hasFailSubject: boolean = false,
  boundaries: GradeBoundary[] = DEFAULT_GRADE_BOUNDARIES
): string {
  return computeGradeFromBoundaries(percentage, hasFailSubject, boundaries);
}

export interface SubjectMarkInput {
  subjectId: string;
  subjectName: string;
  score: number | null | undefined;
  maxScore: number;
  passMarks?: number;
  absent?: boolean;
  remarks?: string | null;
}

export interface ComputedStudentExamResult {
  totalMarks: number;
  maxTotal: number;
  percentage: number;
  overallGrade: string;
  result: "PASS" | "FAIL";
  hasFailSubject: boolean;
  hasMissing: boolean;
  subjectResults: Array<{
    subjectId: string;
    subjectName: string;
    marks: number | null;
    maxMarks: number;
    passMark: number;
    percentage: number;
    grade: string;
    status: "PASS" | "FAIL" | "ABSENT" | "NEEDS_REVIEW";
    absent: boolean;
    isFail: boolean;
  }>;
}

/**
 * Computes totals, percentage, grade, and pass/fail across ALL subjects of an exam.
 * Guarantees no subject is dropped, absent counts as 0 / maxMarks & fails overall,
 * and floating totals stay accurate to 1 decimal place.
 */
export function computeStudentExamResult(
  subjects: SubjectMarkInput[],
  defaultPassMarks: number = 35
): ComputedStudentExamResult {
  if (subjects.length === 0) {
    return {
      totalMarks: 0,
      maxTotal: 0,
      percentage: 0,
      overallGrade: "-",
      result: "FAIL",
      hasFailSubject: false,
      hasMissing: true,
      subjectResults: [],
    };
  }

  let totalMarks = 0;
  let maxTotal = 0;
  let hasFailSubject = false;
  let hasMissing = false;

  const subjectResults = subjects.map((sub) => {
    const maxMarks = Math.max(1, Number(sub.maxScore) || 100);
    const passMark = Math.max(0, sub.passMarks ?? defaultPassMarks);
    const isAbsent = sub.absent === true || sub.remarks?.trim().toUpperCase() === "ABSENT";

    const numericScore: number | null = isAbsent
      ? 0
      : typeof sub.score === "number" && Number.isFinite(sub.score)
      ? Math.min(maxMarks, Math.max(0, sub.score))
      : null;

    const isFail = isAbsent || (numericScore !== null && numericScore < passMark);

    if (numericScore === null) {
      hasMissing = true;
    } else if (isAbsent) {
      hasFailSubject = true;
    } else {
      totalMarks += numericScore;
      if (numericScore < passMark) {
        hasFailSubject = true;
      }
    }

    maxTotal += maxMarks;

    const subPct = numericScore !== null ? calculatePercentage(numericScore, maxMarks) : 0;
    const grade = isAbsent
      ? "F"
      : numericScore !== null
      ? getUnifiedReportCardGrade(subPct, isFail)
      : "-";

    const status: "PASS" | "FAIL" | "ABSENT" | "NEEDS_REVIEW" = isAbsent
      ? "ABSENT"
      : numericScore === null
      ? "NEEDS_REVIEW"
      : numericScore >= passMark
      ? "PASS"
      : "FAIL";

    return {
      subjectId: sub.subjectId,
      subjectName: sub.subjectName,
      marks: numericScore,
      maxMarks,
      passMark,
      percentage: subPct,
      grade,
      status,
      absent: isAbsent,
      isFail,
    };
  });

  const percentage = !hasMissing && maxTotal > 0 ? calculatePercentage(totalMarks, maxTotal) : 0;
  const overallGrade = hasMissing ? "-" : getUnifiedReportCardGrade(percentage, hasFailSubject);
  const result: "PASS" | "FAIL" = hasFailSubject || hasMissing ? "FAIL" : "PASS";

  return {
    totalMarks,
    maxTotal,
    percentage,
    overallGrade,
    result,
    hasFailSubject,
    hasMissing,
    subjectResults,
  };
}

/**
 * Standard competition ranking (1, 1, 3) handling exact ties on totalMarks / percentage.
 */
export function assignTiedRanks<T extends { totalMarks: number }>(rows: T[]): Array<T & { rank: number }> {
  const sorted = [...rows].sort((a, b) => b.totalMarks - a.totalMarks);
  let currentRank = 1;
  return sorted.map((item, idx) => {
    if (idx > 0 && item.totalMarks < sorted[idx - 1].totalMarks) {
      currentRank = idx + 1;
    }
    return { ...item, rank: currentRank };
  });
}

export interface ClassExamAnalytics {
  totalStudentsAppeared: number;
  passedStudents: number;
  failedStudents: number;
  passRatePercentage: number;
  classOverallPercentage: number;
  averageTotalScore: number;
  highestTotalScore: number;
  lowestTotalScore: number;
  gradeDistribution: Array<{ grade: string; count: number }>;
  subjectBreakdown: Array<{ subjectId: string; name: string; avgPercentage: number }>;
}

/**
 * Computes consistent exam analytics across marks (grouping by student + respecting subject passMarks).
 * Used by Admin Dashboard PassFailChart, Admin Performance, Admin Exams, Parent Dashboard & Parent Exams.
 */
export function computeClassExamAnalytics(
  marks: Array<{
    studentId: string;
    subjectId: string;
    score: number;
    maxScore: number;
    remarks?: string | null;
    isAbsent?: boolean;
    subject?: { id: string; name: string; passMarks?: number | null } | null;
  }>
): ClassExamAnalytics {
  if (!marks || marks.length === 0) {
    return {
      totalStudentsAppeared: 0,
      passedStudents: 0,
      failedStudents: 0,
      passRatePercentage: 0,
      classOverallPercentage: 0,
      averageTotalScore: 0,
      highestTotalScore: 0,
      lowestTotalScore: 0,
      gradeDistribution: [
        { grade: "A+", count: 0 },
        { grade: "A", count: 0 },
        { grade: "B+", count: 0 },
        { grade: "B", count: 0 },
        { grade: "C", count: 0 },
        { grade: "D", count: 0 },
        { grade: "F", count: 0 },
      ],
      subjectBreakdown: [],
    };
  }

  const byStudent = new Map<string, SubjectMarkInput[]>();
  const bySubject = new Map<string, { subjectId: string; name: string; score: number; maxScore: number }>();

  for (const m of marks) {
    const isAbsent = m.isAbsent === true || m.remarks?.trim().toUpperCase() === "ABSENT";
    const subName = m.subject?.name || "Subject";
    const passMarks = m.subject?.passMarks ?? 35;

    const arr = byStudent.get(m.studentId) || [];
    arr.push({
      subjectId: m.subjectId,
      subjectName: subName,
      score: isAbsent ? 0 : m.score,
      maxScore: m.maxScore || 100,
      passMarks,
      absent: isAbsent,
      remarks: m.remarks,
    });
    byStudent.set(m.studentId, arr);

    const sCur = bySubject.get(m.subjectId) || {
      subjectId: m.subjectId,
      name: subName,
      score: 0,
      maxScore: 0,
    };
    if (!isAbsent) {
      sCur.score += m.score;
    }
    sCur.maxScore += m.maxScore || 100;
    bySubject.set(m.subjectId, sCur);
  }

  let totalScoreAll = 0;
  let totalMaxAll = 0;
  let passedStudents = 0;
  let failedStudents = 0;
  let highestTotalScore = 0;
  let lowestTotalScore = Number.POSITIVE_INFINITY;

  const gradeCounts: Record<string, number> = {
    "A+": 0,
    A: 0,
    "B+": 0,
    B: 0,
    C: 0,
    D: 0,
    F: 0,
  };

  for (const stuSubjects of byStudent.values()) {
    const res = computeStudentExamResult(stuSubjects);
    totalScoreAll += res.totalMarks;
    totalMaxAll += res.maxTotal;
    if (res.result === "PASS") passedStudents++;
    else failedStudents++;

    if (res.totalMarks > highestTotalScore) highestTotalScore = res.totalMarks;
    if (res.totalMarks < lowestTotalScore) lowestTotalScore = res.totalMarks;

    if (res.overallGrade in gradeCounts) {
      gradeCounts[res.overallGrade]++;
    }
  }

  const totalStudentsAppeared = byStudent.size;
  if (lowestTotalScore === Number.POSITIVE_INFINITY) lowestTotalScore = 0;

  return {
    totalStudentsAppeared,
    passedStudents,
    failedStudents,
    passRatePercentage: calculatePercentage(passedStudents, totalStudentsAppeared),
    classOverallPercentage: calculatePercentage(totalScoreAll, totalMaxAll),
    averageTotalScore:
      totalStudentsAppeared > 0 ? roundOneDecimal(totalScoreAll / totalStudentsAppeared) : 0,
    highestTotalScore,
    lowestTotalScore,
    gradeDistribution: Object.entries(gradeCounts).map(([grade, count]) => ({ grade, count })),
    subjectBreakdown: Array.from(bySubject.values()).map((sub) => ({
      subjectId: sub.subjectId,
      name: sub.name,
      avgPercentage: calculatePercentage(sub.score, sub.maxScore),
    })),
  };
}
