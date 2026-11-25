"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Wrench,
  Users,
  Briefcase,
  GraduationCap,
  BookOpen,
} from "lucide-react";
import type { DataCheckIssue, ReconciliationSummaryReport } from "@/backend/services/stats/types";
import {
  fixDataCheckIssueAction,
  runDataCheckAction,
} from "@/backend/api/actions/dashboard/admin/data-check/actions";
import { notifyStatsUpdated } from "@/frontend/hooks/useStatsLiveRefresh";

interface DataCheckClientProps {
  initialReport: ReconciliationSummaryReport;
}

export default function DataCheckClient({ initialReport }: DataCheckClientProps) {
  const [report, setReport] = useState<ReconciliationSummaryReport>(initialReport);
  const [filter, setFilter] = useState<"ALL" | "HIGH" | "MEDIUM" | "LOW" | "AUTO_FIXABLE">("ALL");
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isRefreshing, startRefresh] = useTransition();

  const handleRerun = () => {
    setFeedback(null);
    startRefresh(async () => {
      const res = await runDataCheckAction();
      if (res.success && res.report) {
        setReport(res.report);
        notifyStatsUpdated();
        setFeedback({ type: "success", text: "Live database reconciliation completed." });
      } else {
        setFeedback({ type: "error", text: res.error || "Failed to run data check." });
      }
    });
  };

  const handleFix = async (issue: DataCheckIssue) => {
    setFixingId(issue.id);
    setFeedback(null);
    try {
      const res = await fixDataCheckIssueAction(issue.category, issue.recordId);
      if (res.success && res.report) {
        setReport(res.report);
        notifyStatsUpdated();
        setFeedback({ type: "success", text: res.message || "Fixed cleanly." });
      } else {
        setFeedback({ type: "error", text: res.error || "Fix failed." });
      }
    } finally {
      setFixingId(null);
    }
  };

  const filteredIssues = report.issues.filter((issue) => {
    if (filter === "HIGH") return issue.severity === "HIGH";
    if (filter === "MEDIUM") return issue.severity === "MEDIUM";
    if (filter === "LOW") return issue.severity === "LOW";
    if (filter === "AUTO_FIXABLE") return issue.canAutoFix;
    return true;
  });

  const { counts, summary } = report;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", maxWidth: "1200px" }}>
      {/* Header */}
      <div
        style={{
          background: "var(--card-bg)",
          borderRadius: "16px",
          padding: "1.5rem",
          border: "1px solid var(--border-color)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.9rem" }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "12px",
              background: summary.totalIssues === 0 ? "rgba(16, 185, 129, 0.12)" : "rgba(245, 158, 11, 0.14)",
              color: summary.totalIssues === 0 ? "var(--success)" : "var(--warning)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <ShieldCheck size={26} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: "1.45rem", fontWeight: 700 }}>
              Portal Data Integrity &amp; Consistency Check
            </h1>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem", color: "var(--text-secondary)" }}>
              Single source of truth verification across Admin, Teacher, and Parent counts, links, buses, and notifications.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap" }}>
          <Link
            href="/dashboard/admin/classes/reconciliation"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "0.55rem 1rem",
              borderRadius: "10px",
              border: "1px solid var(--border-color)",
              textDecoration: "none",
              color: "inherit",
              fontSize: "0.85rem",
              fontWeight: 600,
            }}
          >
            Class Teacher Sync
          </Link>
          <button
            type="button"
            onClick={handleRerun}
            disabled={isRefreshing}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.45rem",
              padding: "0.55rem 1.1rem",
              borderRadius: "10px",
              border: "none",
              background: "var(--primary)",
              color: "#ffffff",
              fontSize: "0.85rem",
              fontWeight: 600,
              cursor: isRefreshing ? "not-allowed" : "pointer",
              opacity: isRefreshing ? 0.65 : 1,
            }}
          >
            <RefreshCw size={15} style={isRefreshing ? { animation: "spin 1s linear infinite" } : undefined} />
            <span>{isRefreshing ? "Scanning Database..." : "Run Fresh Check"}</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role="alert"
          style={{
            padding: "0.85rem 1.1rem",
            borderRadius: "10px",
            background: feedback.type === "success" ? "rgba(16, 185, 129, 0.12)" : "rgba(239, 68, 68, 0.12)",
            border: `1px solid ${feedback.type === "success" ? "rgba(16, 185, 129, 0.35)" : "rgba(239, 68, 68, 0.35)"}`,
            color: feedback.type === "success" ? "var(--success)" : "var(--danger)",
            fontSize: "0.875rem",
            fontWeight: 600,
          }}
        >
          {feedback.text}
        </div>
      )}

      {/* Canonical Counts Snapshot (guaranteed equal to Dashboard & List Pages) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: "0.85rem" }}>
        <Link href="/dashboard/admin/students" style={{ textDecoration: "none", color: "inherit", background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: "12px", padding: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: "var(--text-secondary)", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase" }}>
            <Users size={14} /> Active Students
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 700, marginTop: "0.35rem" }}>{counts.students.activeStudents}</div>
          <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>Day Scholars: {counts.students.dayScholars} · Hostel: {counts.students.hostelers}</div>
        </Link>

        <Link href="/dashboard/admin/teachers" style={{ textDecoration: "none", color: "inherit", background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: "12px", padding: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: "var(--text-secondary)", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase" }}>
            <Briefcase size={14} /> Active Teachers
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 700, marginTop: "0.35rem" }}>{counts.teachers.activeTeachers}</div>
          <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>All faculty: {counts.teachers.allTeachersIncludingInactive}</div>
        </Link>

        <Link href="/dashboard/admin/parents" style={{ textDecoration: "none", color: "inherit", background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: "12px", padding: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: "var(--text-secondary)", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase" }}>
            <Users size={14} /> Total Parents
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 700, marginTop: "0.35rem" }}>{counts.parents.totalParents}</div>
          <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>Active w/ child: {counts.parents.activeParents}</div>
        </Link>

        <Link href="/dashboard/admin/classes" style={{ textDecoration: "none", color: "inherit", background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: "12px", padding: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: "var(--text-secondary)", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase" }}>
            <GraduationCap size={14} /> Class-Sections
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 700, marginTop: "0.35rem" }}>{counts.classes.totalSections}</div>
          <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>{counts.classes.distinctClasses} class levels</div>
        </Link>

        <Link href="/dashboard/admin/subjects" style={{ textDecoration: "none", color: "inherit", background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: "12px", padding: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: "var(--text-secondary)", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase" }}>
            <BookOpen size={14} /> Distinct Subjects
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 700, marginTop: "0.35rem" }}>{counts.subjects.distinctSubjects}</div>
          <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>{counts.subjects.totalAllocations} allocations</div>
        </Link>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {(["ALL", "HIGH", "MEDIUM", "LOW", "AUTO_FIXABLE"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              style={{
                padding: "0.45rem 0.9rem",
                borderRadius: "8px",
                border: "1px solid var(--border-color)",
                background: filter === tab ? "var(--primary)" : "var(--card-bg)",
                color: filter === tab ? "#ffffff" : "inherit",
                fontSize: "0.8rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {tab === "ALL" && `All (${summary.totalIssues})`}
              {tab === "HIGH" && `High (${summary.highSeverity})`}
              {tab === "MEDIUM" && `Medium (${report.issues.filter((i) => i.severity === "MEDIUM").length})`}
              {tab === "LOW" && `Low (${report.issues.filter((i) => i.severity === "LOW").length})`}
              {tab === "AUTO_FIXABLE" && `Auto-Fixable (${summary.autoFixable})`}
            </button>
          ))}
        </div>
        <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
          Checked: {new Date(report.checkedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST
        </span>
      </div>

      {/* Issues List */}
      <div style={{ background: "var(--card-bg)", borderRadius: "16px", border: "1px solid var(--border-color)", overflow: "hidden" }}>
        {filteredIssues.length === 0 ? (
          <div style={{ padding: "3rem 1.5rem", textAlign: "center" }}>
            <CheckCircle2 size={44} style={{ color: "var(--success)", margin: "0 auto 0.75rem" }} />
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>All Checks Clean</h3>
            <p style={{ margin: "0.35rem 0 0", color: "var(--text-secondary)", fontSize: "0.875rem" }}>
              No data integrity issues found in this category. Dashboard cards and directory pages are in sync.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {filteredIssues.map((issue) => (
              <div
                key={issue.id}
                style={{
                  padding: "1rem 1.25rem",
                  borderBottom: "1px solid var(--border-color)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "1rem",
                }}
              >
                <div style={{ flex: "1 1 320px", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.25rem" }}>
                    <span
                      style={{
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        padding: "0.15rem 0.5rem",
                        borderRadius: "999px",
                        background:
                          issue.severity === "HIGH"
                            ? "rgba(239, 68, 68, 0.15)"
                            : issue.severity === "MEDIUM"
                            ? "rgba(245, 158, 11, 0.15)"
                            : "rgba(59, 130, 246, 0.12)",
                        color:
                          issue.severity === "HIGH"
                            ? "var(--danger)"
                            : issue.severity === "MEDIUM"
                            ? "var(--warning)"
                            : "var(--primary)",
                      }}
                    >
                      {issue.severity}
                    </span>
                    <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontFamily: "monospace" }}>
                      {issue.category}
                    </span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                    <AlertTriangle size={14} style={{ display: "inline", marginRight: "0.35rem", color: issue.severity === "HIGH" ? "var(--danger)" : "var(--warning)" }} />
                    {issue.title}
                  </div>
                  <p style={{ margin: "0.25rem 0 0", fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                    {issue.description}
                  </p>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <Link
                    href={issue.openHref}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                      padding: "0.45rem 0.85rem",
                      borderRadius: "8px",
                      border: "1px solid var(--border-color)",
                      textDecoration: "none",
                      color: "inherit",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                    }}
                  >
                    <ExternalLink size={14} /> Open
                  </Link>
                  {issue.canAutoFix && (
                    <button
                      type="button"
                      disabled={fixingId === issue.id}
                      onClick={() => handleFix(issue)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.35rem",
                        padding: "0.45rem 0.9rem",
                        borderRadius: "8px",
                        border: "none",
                        background: "var(--success)",
                        color: "#ffffff",
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        cursor: fixingId === issue.id ? "not-allowed" : "pointer",
                        opacity: fixingId === issue.id ? 0.65 : 1,
                      }}
                    >
                      <Wrench size={14} /> {fixingId === issue.id ? "Fixing..." : "Fix"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
