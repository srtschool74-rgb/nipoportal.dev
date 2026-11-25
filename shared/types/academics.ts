import {
  DEFAULT_GRADE_BOUNDARIES,
  GradeBoundary,
  calculateReportCardGrade as computeGradeFromBoundaries,
} from "@/lib/report-card/grading";

export { DEFAULT_GRADE_BOUNDARIES };
export type { GradeBoundary };

export function roundOneDecimal(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

export function formatOneDecimal(value: number): string {
  return roundOneDecimal(value).toFixed(1);
}

export function normalizeExamResultLabel(result?: string | null): "PASS" | "FAIL" {
  const clean = (result || "").trim().toUpperCase();
  if (clean === "PASS" || clean === "PASSED") return "PASS";
  return "FAIL";
}

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
