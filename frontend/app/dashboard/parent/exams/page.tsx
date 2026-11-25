import dynamic from "next/dynamic";
import { prisma } from "@/backend/db/prisma";
import styles from "../../dashboard.module.css";
import { BookOpen, Calendar as CalendarIcon } from "lucide-react";
import { getSystemSetting } from "@/backend/api/actions/dashboard/admin/settings/actions";
import { getParentAndSelectedChild } from "../parentChildHelper";
import { computeClassExamAnalytics, computeStudentExamResult } from "@/backend/services/stats";
import ParentChildBanner from "../ParentChildBanner";

const ExamClassPerformancePieChart = dynamic(
  () => import("../ExamClassPerformancePieChart"),
  {
    loading: () => (
      <div style={{ height: "260px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>
        Loading performance chart...
      </div>
    ),
  }
);

export default async function ParentExamsPage({
  searchParams
}: {
  searchParams: Promise<{ childId?: string }>
}) {
  const resolvedSearchParams = await searchParams;
  const { session, parent, children, selectedChild } = await getParentAndSelectedChild(resolvedSearchParams?.childId);
  if (!session) return null;

  const canView = await getSystemSetting("RESULT_VISIBILITY", "false");
  if (canView === "false") {
    return (
      <div className={styles.dashboard}>
        <h1 className={styles.title}>Exams &amp; Marks</h1>
        <p style={{ color: "var(--danger)" }}>Exam results are currently hidden by the administrator.</p>
      </div>
    );
  }

  if (!parent || children.length === 0 || !selectedChild) {
    return (
      <div className={styles.dashboard}>
        <h1 className={styles.title}>Exams &amp; Marks</h1>
        <p>No children linked to your account.</p>
      </div>
    );
  }

  // Helper to fetch latest exam with verified & published marks
  const fetchLastExamWithMarks = async (classId: string) => {
    const withMarks = await prisma.exam.findFirst({
      where: { classId, isPublished: true, marks: { some: {} } },
      orderBy: { date: 'desc' },
      include: {
        marks: {
          select: { score: true, maxScore: true, remarks: true, studentId: true, subjectId: true, subject: { select: { id: true, name: true, passMarks: true } } }
        }
      }
    });
    if (withMarks) return withMarks;

    return prisma.exam.findFirst({
      where: { classId, isPublished: true },
      orderBy: { date: 'desc' },
      include: {
        marks: {
          select: { score: true, maxScore: true, remarks: true, studentId: true, subjectId: true, subject: { select: { id: true, name: true, passMarks: true } } }
        }
      }
    });
  };

  // 1. Fetch exams for this child and the last exam concurrently (only published results)
  const [exams, lastExamWithMarks] = await Promise.all([
    selectedChild.classId ? prisma.exam.findMany({
      where: { classId: selectedChild.classId, isPublished: true },
      include: {
        marks: {
          where: { studentId: selectedChild.id },
          include: { subject: true }
        }
      },
      orderBy: { date: 'desc' }
    }) : Promise.resolve([]),
    selectedChild.classId ? fetchLastExamWithMarks(selectedChild.classId) : Promise.resolve(null)
  ]);

  const childClass = selectedChild.class;

  // 2. Compute last test mark calculation & class overall percentage
  let hasExamData = false;
  let classOverallPercentage = 0;
  let totalStudentsAppeared = 0;
  let passedStudents = 0;
  let failedStudents = 0;
  let passRatePercentage = 0;
  let childPercentage: number | null = null;
  let childScore = 0;
  let childMaxScore = 0;
  let examName = "";
  let examDate = "";
  const subjectBreakdown: { name: string; avgPercentage: number }[] = [];

  if (lastExamWithMarks) {
    examName = lastExamWithMarks.name;
    try {
      examDate = new Date(lastExamWithMarks.date).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric"
      });
    } catch {
      examDate = new Date(lastExamWithMarks.date).toLocaleDateString();
    }

    if (lastExamWithMarks.marks.length > 0) {
      hasExamData = true;
      const analytics = computeClassExamAnalytics(
        lastExamWithMarks.marks.map((m) => ({
          studentId: m.studentId,
          subjectId: m.subjectId,
          score: m.score,
          maxScore: m.maxScore,
          remarks: m.remarks,
          isAbsent: (m.remarks || "").trim().toUpperCase() === "ABSENT",
          subject: m.subject ? { id: m.subject.id, name: m.subject.name, passMarks: m.subject.passMarks } : null,
        }))
      );
      classOverallPercentage = analytics.classOverallPercentage;
      totalStudentsAppeared = analytics.totalStudentsAppeared;
      passedStudents = analytics.passedStudents;
      failedStudents = analytics.failedStudents;
      passRatePercentage = analytics.passRatePercentage;

      const childMarks = lastExamWithMarks.marks.filter((m) => m.studentId === selectedChild.id);
      if (childMarks.length > 0) {
        const childRes = computeStudentExamResult(
          childMarks.map((m) => ({
            subjectId: m.subjectId,
            subjectName: m.subject?.name || "Subject",
            score: m.score,
            maxScore: m.maxScore,
            passMarks: m.subject?.passMarks ?? 35,
            absent: (m.remarks || "").trim().toUpperCase() === "ABSENT",
            remarks: m.remarks,
          }))
        );
        childScore = childRes.totalMarks;
        childMaxScore = childRes.maxTotal;
        childPercentage = childRes.percentage;
      }

      analytics.subjectBreakdown.forEach((sub) => {
        subjectBreakdown.push({ name: sub.name, avgPercentage: sub.avgPercentage });
      });
    }
  }

  return (
    <div className={styles.dashboard}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <h1 className={styles.title} style={{ margin: 0 }}>Exams &amp; Marks</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '0.25rem 0 0 0', fontSize: '0.9rem' }}>
            Viewing exams and marks for <strong>{selectedChild.firstName} {selectedChild.lastName}</strong>
          </p>
        </div>
      </div>

      {/* Child Profile Banner */}
      <ParentChildBanner 
        selectedChild={selectedChild} 
        studentList={children} 
        activePage="other" 
      />

      {/* Exam Overall Percentage (Last Test Mark Calculation with Pie Chart) */}
      <div style={{ margin: '1rem 0' }}>
        <ExamClassPerformancePieChart
          hasExamData={hasExamData}
          examName={examName}
          examDate={examDate}
          classNameStr={childClass ? `${childClass.name} - ${childClass.section}` : "Class"}
          classOverallPercentage={classOverallPercentage}
          totalStudentsAppeared={totalStudentsAppeared}
          passedStudents={passedStudents}
          failedStudents={failedStudents}
          passRatePercentage={passRatePercentage}
          childPercentage={childPercentage}
          childScore={childScore}
          childMaxScore={childMaxScore}
          childName={selectedChild.firstName}
          childId={selectedChild.id}
          subjectBreakdown={subjectBreakdown}
        />
      </div>

      {/* Historical Exams List */}
      <div className={styles.chartsContainer} style={{ marginTop: '1.5rem' }}>
        {exams.map((exam) => (
          <div key={exam.id} className={styles.chartCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ width: 40, height: 40, borderRadius: '8px', backgroundColor: 'rgba(99, 102, 241, 0.1)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <BookOpen size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, color: 'var(--foreground)' }}>{exam.name}</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', opacity: 0.7, marginTop: '0.25rem' }}>
                    <CalendarIcon size={14} />
                    {new Date(exam.date).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <span style={{ fontSize: '0.75rem', padding: '4px 8px', borderRadius: '12px', backgroundColor: exam.marks.length > 0 ? 'var(--success-bg)' : 'var(--warning-bg)', color: exam.marks.length > 0 ? "var(--success)" : "var(--warning)" }}>
                {exam.marks.length > 0 ? 'Marks Available' : 'Upcoming/Pending'}
              </span>
            </div>

            {exam.marks.length > 0 ? (
              <div style={{ overflowX: 'auto', width: '100%', maxWidth: '100%', minWidth: 0, WebkitOverflowScrolling: 'touch' }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", minWidth: "350px" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <th style={{ padding: "0.5rem 0", fontWeight: 600, fontSize: '0.875rem' }}>Subject</th>
                      <th style={{ padding: "0.5rem 0", fontWeight: 600, fontSize: '0.875rem' }}>Score</th>
                      <th style={{ padding: "0.5rem 0", fontWeight: 600, fontSize: '0.875rem' }}>Percentage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exam.marks.map((mark) => (
                      <tr key={mark.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "0.75rem 0", fontSize: '0.875rem' }}>{mark.subject.name}</td>
                        <td style={{ padding: "0.75rem 0", fontSize: '0.875rem', fontWeight: 500 }}>
                          {mark.score} / {mark.maxScore}
                        </td>
                        <td style={{ padding: "0.75rem 0", fontSize: '0.875rem' }}>
                          {((mark.score / mark.maxScore) * 100).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ fontSize: '0.875rem', opacity: 0.7, margin: 0, textAlign: 'center', padding: '1rem 0' }}>
                No marks have been published for this exam yet.
              </p>
            )}
          </div>
        ))}

        {exams.length === 0 && (
          <div className={styles.chartCard} style={{ gridColumn: '1 / -1' }}>
            <p style={{ textAlign: 'center', opacity: 0.7, padding: '2rem' }}>No exams found for this class.</p>
          </div>
        )}
      </div>
    </div>
  );
}
