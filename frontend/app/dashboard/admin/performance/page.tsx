import { getServerSession } from "next-auth/next";
import { getAuthOptions } from "@/backend/auth/authOptions";
import { prisma } from "@/backend/db/prisma";
import { computeClassExamAnalytics, getUnifiedReportCardGrade, roundOneDecimal } from "@/backend/services/stats";
import styles from "../../dashboard.module.css";
import PerformanceClient from "./PerformanceClient";

export const dynamic = "force-dynamic";

export default async function AdminPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ classId?: string; examId?: string }>;
}) {
  const session = await getServerSession(getAuthOptions());
  if (!session || session.user.role !== 'ADMIN') return null;

  const resolvedSearchParams = await searchParams;
  const { classId, examId } = resolvedSearchParams;

  const classes = await prisma.class.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' }
  });

  const exams = await prisma.exam.findMany({
    orderBy: { date: 'desc' }
  });

  const whereClause: import("@prisma/client").Prisma.MarkWhereInput = {};
  if (classId) {
    whereClause.student = { classId };
  }
  if (examId) {
    whereClause.examId = examId;
  }

  // Fetch all marks for pass/fail aggregation
  const marks = await prisma.mark.findMany({
    where: whereClause,
    include: {
      student: { include: { class: true } },
      subject: true,
      exam: true
    }
  });

  // Compute unified pass/fail, grades, and student rankings via stats layer
  const analytics = computeClassExamAnalytics(
    marks.map((m) => ({
      studentId: m.studentId,
      subjectId: m.subjectId,
      score: m.score,
      maxScore: m.maxScore,
      remarks: m.remarks,
      isAbsent: (m.remarks || "").trim().toUpperCase() === "ABSENT",
      subject: m.subject ? { id: m.subject.id, name: m.subject.name, passMarks: m.subject.passMarks } : null,
    }))
  );

  // Per-class pass/fail rates
  const classBuckets = new Map<string, { name: string; marks: typeof marks }>();
  marks.forEach((m) => {
    const cid = m.student.classId;
    if (!cid) return;
    const entry = classBuckets.get(cid) || {
      name: `${m.student.class?.name || ""} - ${m.student.class?.section || ""}`,
      marks: [],
    };
    entry.marks.push(m);
    classBuckets.set(cid, entry);
  });

  // Grade distribution across valid subject marks & aggregate student performance
  const gradeBuckets: Record<string, number> = { "A+": 0, A: 0, "B+": 0, B: 0, C: 0, D: 0, F: 0 };
  let totalScore = 0;
  let highest = 0;
  let lowest = 999999;
  let validMarksCount = 0;
  const studentStats: Record<string, { sum: number; max: number; name: string; rollNo: string }> = {};

  marks.forEach((m) => {
    const isAbsent = (m.remarks || "").trim().toUpperCase() === "ABSENT";
    if (isAbsent) {
      gradeBuckets.F++;
      return;
    }

    validMarksCount++;
    const percent = m.maxScore > 0 ? (m.score / m.maxScore) * 100 : 0;
    const isPass = m.score >= (m.subject?.passMarks ?? 35);
    const grade = getUnifiedReportCardGrade(percent, !isPass);
    if (grade in gradeBuckets) gradeBuckets[grade]++;

    totalScore += m.score;
    if (m.score > highest) highest = m.score;
    if (m.score < lowest) lowest = m.score;

    if (!studentStats[m.studentId]) {
      studentStats[m.studentId] = {
        sum: 0,
        max: 0,
        name: `${m.student.firstName} ${m.student.lastName}`,
        rollNo: m.student.rollNumber,
      };
    }
    studentStats[m.studentId].sum += m.score;
    studentStats[m.studentId].max += m.maxScore;
  });

  if (lowest === 999999) lowest = 0;

  const passedSubjectCount =
    gradeBuckets["A+"] + gradeBuckets.A + gradeBuckets["B+"] + gradeBuckets.B + gradeBuckets.C + gradeBuckets.D;

  const stats = {
    average: validMarksCount > 0 ? roundOneDecimal(totalScore / validMarksCount).toFixed(1) : "0.0",
    highest,
    lowest,
    passPercent: analytics.totalStudentsAppeared > 0
      ? analytics.passRatePercentage.toFixed(1)
      : validMarksCount > 0
      ? roundOneDecimal((passedSubjectCount / validMarksCount) * 100).toFixed(1)
      : "0.0",
    failPercent: analytics.totalStudentsAppeared > 0
      ? roundOneDecimal(100 - analytics.passRatePercentage).toFixed(1)
      : validMarksCount > 0
      ? roundOneDecimal((gradeBuckets.F / validMarksCount) * 100).toFixed(1)
      : "0.0",
  };

  const pieData = [
    { name: 'A+ (90%+)', value: gradeBuckets["A+"], color: "#10b981" },
    { name: 'A (80-89%)', value: gradeBuckets.A, color: "var(--success)" },
    { name: 'B+ (70-79%)', value: gradeBuckets["B+"], color: "#06b6d4" },
    { name: 'B (60-69%)', value: gradeBuckets.B, color: "var(--primary)" },
    { name: 'C (50-59%)', value: gradeBuckets.C, color: '#8b5cf6' },
    { name: 'D (35-49%)', value: gradeBuckets.D, color: "var(--warning)" },
    { name: 'F (Fail)', value: gradeBuckets.F, color: "var(--danger)" },
  ];

  // Convert class stats for overview bar chart
  const overviewChartData = Array.from(classBuckets.values()).map((bucket) => {
    const classRes = computeClassExamAnalytics(
      bucket.marks.map((m) => ({
        studentId: m.studentId,
        subjectId: m.subjectId,
        score: m.score,
        maxScore: m.maxScore,
        remarks: m.remarks,
        isAbsent: (m.remarks || "").trim().toUpperCase() === "ABSENT",
        subject: m.subject ? { id: m.subject.id, name: m.subject.name, passMarks: m.subject.passMarks } : null,
      }))
    );
    return {
      name: bucket.name,
      PassPercent: classRes.passRatePercentage,
    };
  });

  // Get top 10 students
  const topPerformers = Object.values(studentStats)
    .map(s => ({
      name: s.name,
      rollNo: s.rollNo,
      percentage: s.max > 0 ? roundOneDecimal((s.sum / s.max) * 100) : 0
    }))
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, 10);

  return (
    <div className={styles.dashboard}>
      <h1 className={styles.title} style={{ margin: 0, marginBottom: '1.5rem' }}>School Performance</h1>

      <PerformanceClient 
        pieData={pieData} 
        overviewChartData={overviewChartData}
        stats={stats}
        topPerformers={topPerformers} 
        classes={classes}
        exams={exams}
        initialClassId={classId || ""}
        initialExamId={examId || ""}
      />
    </div>
  );
}
