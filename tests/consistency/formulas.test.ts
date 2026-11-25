import { describe, expect, it } from "vitest";
import {
  computeAttendanceMetrics,
  getSchoolAcademicYearRange,
  getSchoolMonthRange,
  summarizeAttendanceRecords,
} from "@/backend/services/stats/attendance";
import {
  assignTiedRanks,
  calculatePercentage,
  computeClassExamAnalytics,
  computeStudentExamResult,
  formatOneDecimal,
  getUnifiedReportCardGrade,
  normalizeExamResultLabel,
} from "@/backend/services/stats/academics";
import { computeBusSeatMetrics } from "@/backend/services/stats/transport";
import { toDateString } from "@/backend/lib/services/attendanceCalculation";

describe("Unified Attendance Formulas & Asia/Kolkata Boundaries", () => {
  it("returns 0.0 and hasWorkingSessions=false when working days and records are 0 (never divides by zero or fakes 100%)", () => {
    const res = computeAttendanceMetrics({
      presentCount: 0,
      absentCount: 0,
      lateCount: 0,
      leaveCount: 0,
      officialWorkingDays: 0,
    });
    expect(res.totalWorkingSessions).toBe(0);
    expect(res.percentage).toBe("0.0");
    expect(res.percentageValue).toBeNull();
    expect(res.hasWorkingSessions).toBe(false);
  });

  it("credits PRESENT + LATE against official working sessions * 2 rounded to 1 decimal place", () => {
    // 10 official working days = 20 sessions. 15 present + 2 late + 3 absent = 17/20 = 85.0%
    const res = summarizeAttendanceRecords(
      [
        ...Array.from({ length: 15 }, () => ({ status: "PRESENT" })),
        ...Array.from({ length: 2 }, () => ({ status: "LATE" })),
        ...Array.from({ length: 3 }, () => ({ status: "ABSENT" })),
      ],
      10
    );
    expect(res.totalWorkingSessions).toBe(20);
    expect(res.attendedSessions).toBe(17);
    expect(res.percentage).toBe("85.0");
    expect(res.percentageValue).toBe(85.0);
  });

  it("caps attendance percentage at 100.0 even when extra sessions exceed calendar estimate", () => {
    const res = computeAttendanceMetrics({
      presentCount: 22,
      absentCount: 0,
      lateCount: 0,
      leaveCount: 0,
      officialWorkingDays: 10,
    });
    expect(res.percentage).toBe("100.0");
    expect(res.totalWorkingSessions).toBe(22);
  });

  it("handles 1 decimal place cleanly on non-terminating percentages", () => {
    // 7 working days = 14 sessions, 10 attended -> 71.428... -> 71.4
    const res = computeAttendanceMetrics({
      presentCount: 10,
      absentCount: 4,
      lateCount: 0,
      leaveCount: 0,
      officialWorkingDays: 7,
    });
    expect(res.percentage).toBe("71.4");
  });

  it("resolves academic year boundaries strictly in Asia/Kolkata (2026-05-31T18:45Z is June 1 IST)", () => {
    // 2026-05-31 18:45:00 UTC === 2026-06-01 00:15:00 IST -> Academic year starts 2026-06-01!
    const istJune1 = new Date("2026-05-31T18:45:00.000Z");
    expect(toDateString(istJune1)).toBe("2026-06-01");

    const range = getSchoolAcademicYearRange(istJune1);
    expect(range.start.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(range.end.toISOString().slice(0, 10)).toBe("2027-05-31");

    const monthRange = getSchoolMonthRange(istJune1);
    expect(monthRange.start.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(monthRange.end.toISOString().slice(0, 10)).toBe("2026-06-30");
  });
});

describe("Unified Academics, Report Card Grades, Ranks & Edge Cases", () => {
  it("applies canonical grading boundaries A+, A, B+, B, C, D, F consistently", () => {
    expect(getUnifiedReportCardGrade(95, false)).toBe("A+");
    expect(getUnifiedReportCardGrade(84, false)).toBe("A");
    expect(getUnifiedReportCardGrade(74, false)).toBe("B+");
    expect(getUnifiedReportCardGrade(62, false)).toBe("B");
    expect(getUnifiedReportCardGrade(51, false)).toBe("C");
    expect(getUnifiedReportCardGrade(35, false)).toBe("D");
    expect(getUnifiedReportCardGrade(34.9, false)).toBe("F");
    // Subject failure forces overall F regardless of high aggregate percentage
    expect(getUnifiedReportCardGrade(88, true)).toBe("F");
  });

  it("includes all 5 subjects of a student (never drops a subject) and fails overall if any 1 subject fails", () => {
    const fiveSubjects = [
      { subjectId: "s1", subjectName: "Tamil", score: 92, maxScore: 100, passMarks: 35 },
      { subjectId: "s2", subjectName: "English", score: 88, maxScore: 100, passMarks: 35 },
      { subjectId: "s3", subjectName: "Mathematics", score: 28, maxScore: 100, passMarks: 35 },
      { subjectId: "s4", subjectName: "Science", score: 90, maxScore: 100, passMarks: 35 },
      { subjectId: "s5", subjectName: "Social", score: 85, maxScore: 100, passMarks: 35 },
    ];
    const res = computeStudentExamResult(fiveSubjects);
    expect(res.subjectResults).toHaveLength(5);
    expect(res.totalMarks).toBe(383);
    expect(res.maxTotal).toBe(500);
    expect(res.percentage).toBe(76.6);
    expect(res.hasFailSubject).toBe(true);
    expect(res.result).toBe("FAIL");
    expect(res.overallGrade).toBe("F");
  });

  it("treats ABSENT as 0 marks toward maxScore and fails the subject & overall result", () => {
    const res = computeStudentExamResult([
      { subjectId: "s1", subjectName: "Maths", score: 0, maxScore: 100, passMarks: 35, absent: true },
      { subjectId: "s2", subjectName: "Science", score: 80, maxScore: 100, passMarks: 35 },
    ]);
    expect(res.totalMarks).toBe(80);
    expect(res.maxTotal).toBe(200);
    expect(res.percentage).toBe(40);
    expect(res.result).toBe("FAIL");
    expect(res.overallGrade).toBe("F");
    expect(res.subjectResults[0].status).toBe("ABSENT");
  });

  it("computes standard competition ranks handling ties correctly (1, 1, 3, 4)", () => {
    const ranked = assignTiedRanks([
      { studentId: "a", totalMarks: 450 },
      { studentId: "b", totalMarks: 480 },
      { studentId: "c", totalMarks: 480 },
      { studentId: "d", totalMarks: 410 },
    ]);
    expect(ranked.map((r) => [r.studentId, r.rank])).toEqual([
      ["b", 1],
      ["c", 1],
      ["a", 3],
      ["d", 4],
    ]);
  });

  it("handles zero division and empty mark sets safely", () => {
    expect(calculatePercentage(50, 0)).toBe(0);
    expect(formatOneDecimal(Number.NaN)).toBe("0.0");
    expect(normalizeExamResultLabel("PASSED")).toBe("PASS");
    expect(normalizeExamResultLabel("FAILED")).toBe("FAIL");

    const emptyAnalytics = computeClassExamAnalytics([]);
    expect(emptyAnalytics.totalStudentsAppeared).toBe(0);
    expect(emptyAnalytics.passRatePercentage).toBe(0);
    expect(emptyAnalytics.lowestTotalScore).toBe(0);
  });
});

describe("Transport Seat Metrics (Day Scholars Only)", () => {
  it("computes capacity, assigned, available seats, and 1-decimal occupancy accurately", () => {
    const seats = computeBusSeatMetrics(40, 27);
    expect(seats.capacity).toBe(40);
    expect(seats.assigned).toBe(27);
    expect(seats.availableSeats).toBe(13);
    expect(seats.occupancyPercentage).toBe(67.5);
  });

  it("guards against zero bus capacity or negative inputs", () => {
    const emptyBus = computeBusSeatMetrics(0, 0);
    expect(emptyBus.availableSeats).toBe(0);
    expect(emptyBus.occupancyPercentage).toBe(0);

    const overCap = computeBusSeatMetrics(30, 35);
    expect(overCap.availableSeats).toBe(0);
    expect(overCap.occupancyPercentage).toBe(100);
  });
});

