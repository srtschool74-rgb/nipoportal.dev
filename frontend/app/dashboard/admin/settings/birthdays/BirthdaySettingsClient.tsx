"use client";

import { useState } from "react";
import {
  Eye,
  Save,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Users,
  Shield,
  Loader2,
  ExternalLink,
  Send,
  History,
} from "lucide-react";
import { CakeIcon as Cake } from "@/frontend/components/birthdays/BirthdayIcons";
import Link from "next/link";
import styles from "./BirthdaySettings.module.css";
import {
  updateBirthdaySettingsAction,
  sendTestBirthdayWishAction,
  triggerSendTodayWishesAction,
} from "@/backend/api/actions/dashboard/admin/birthdays/actions";
import BirthdayWishCard from "@/frontend/components/birthdays/BirthdayWishCard";

function LanguageIcon({ style }: { style?: React.CSSProperties }) {
  return (
    <svg style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h12M9 3v2m1.04 9.5A14.953 14.953 0 013 13m1.8-6h11.4M14 9l6 11m0 0l-3-6m3 6h-6" />
    </svg>
  );
}

interface BirthdaySettingsClientProps {
  initialSettings: any;
  dashboardMeta: {
    schoolNow: { year: number; month: number; day: number; dateString: string };
    hasCronSecret: boolean;
    recentRuns: any[];
  };
}

export default function BirthdaySettingsClient({ initialSettings, dashboardMeta }: BirthdaySettingsClientProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Test wish state
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Manual Trigger state
  const [isTriggeringNow, setIsTriggeringNow] = useState(false);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);

  // Active template preview tab
  const [activeTemplateTab, setActiveTemplateTab] = useState<"CARD" | "STUDENT_PARENT" | "TEACHER" | "STAFF" | "ADMIN">("CARD");

  const handleToggle = (field: string) => {
    setSettings((prev: any) => ({ ...prev, [field]: !prev[field] }));
  };

  const handleTextChange = (field: string, val: string) => {
    setSettings((prev: any) => ({ ...prev, [field]: val }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    setSaveError(null);

    const res = await updateBirthdaySettingsAction(settings);
    setIsSaving(false);

    if (res.error) {
      setSaveError(res.error);
    } else {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  const handleSendTest = async () => {
    setIsSendingTest(true);
    setTestResult(null);

    const res = await sendTestBirthdayWishAction();
    setIsSendingTest(false);

    if (res.error) {
      setTestResult(`Error: ${res.error}`);
    } else {
      setTestResult("Test birthday notification dispatched! Check your notifications bell.");
      setTimeout(() => setTestResult(null), 4000);
    }
  };

  const handleTriggerNow = async () => {
    if (!confirm("Trigger today's automated birthday wishes now for all celebrants?")) return;
    setIsTriggeringNow(true);
    setTriggerResult(null);

    const res = await triggerSendTodayWishesAction();
    setIsTriggeringNow(false);

    if ("error" in res && res.error) {
      setTriggerResult(`Error: ${res.error}`);
    } else if ("eligibleCount" in res) {
      setTriggerResult(`Successfully processed today's wishes! Eligible: ${res.eligibleCount}, Sent: ${res.sentCount}, Skipped: ${res.skippedAlreadySent}`);
      setTimeout(() => setTriggerResult(null), 6000);
    }
  };

  return (
    <div className={styles.pageContainer}>
      {/* Header & Actions */}
      <div className={styles.headerSection}>
        <div className={styles.headerTitleWrapper}>
          <h1 className={styles.pageTitle}>
            <Cake style={{ width: 28, height: 28, color: "#f59e0b" }} />
            Automatic Birthday Wishes
          </h1>
          <p className={styles.pageSubtitle}>
            Configure automated daily greetings sent from &quot;SRT School&quot; to students&apos; parents, teachers, staff, admins, and students.
          </p>
        </div>

        <div className={styles.headerActions}>
          <Link
            href="/dashboard/admin/birthdays/missing"
            className={styles.btnSecondary}
          >
            <Users style={{ width: 16, height: 16, color: "#6366f1" }} />
            Missing DOB Records
            <ExternalLink style={{ width: 14, height: 14, opacity: 0.7 }} />
          </Link>

          <button
            type="button"
            onClick={handleTriggerNow}
            disabled={isTriggeringNow}
            className={styles.btnTrigger}
            title="Immediately evaluate and send birthday wishes for today"
          >
            {isTriggeringNow ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : <Send style={{ width: 16, height: 16 }} />}
            {isTriggeringNow ? "Evaluating..." : "Trigger Today's Wishes"}
          </button>

          <button
            onClick={handleSave}
            disabled={isSaving}
            className={styles.btnPrimary}
          >
            {isSaving ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : <Save style={{ width: 16, height: 16 }} />}
            {isSaving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>

      {/* Alert Banners */}
      {triggerResult && (
        <div className={triggerResult.startsWith("Error") ? styles.alertError : styles.alertInfo}>
          <Cake style={{ width: 16, height: 16, flexShrink: 0 }} />
          <span>{triggerResult}</span>
        </div>
      )}

      {saveSuccess && (
        <div className={styles.alertSuccess}>
          <CheckCircle2 style={{ width: 16, height: 16, flexShrink: 0 }} />
          <span>Settings saved successfully. All changes are live.</span>
        </div>
      )}

      {saveError && (
        <div className={styles.alertError}>
          <AlertTriangle style={{ width: 16, height: 16, flexShrink: 0 }} />
          <span>{saveError}</span>
        </div>
      )}

      {/* Master Hero Switch Card */}
      <div className={styles.masterHeroCard}>
        <div className={styles.masterHeroInfo}>
          <div className={styles.masterHeroTitleRow}>
            <h2 className={styles.masterHeroTitle}>Master Birthday Wishes Switch</h2>
            {settings.enabled ? (
              <span className={styles.statusPillActive}>
                <CheckCircle2 style={{ width: 12, height: 12 }} /> Active
              </span>
            ) : (
              <span className={styles.statusPillPaused}>
                Paused
              </span>
            )}
          </div>
          <p className={styles.masterHeroDesc}>
            When enabled, the automated system checks daily for birthdays and delivers warm wishes from SRT School.
          </p>
        </div>

        <button
          type="button"
          aria-label="Toggle Master Birthday Wishes Switch"
          onClick={() => handleToggle("enabled")}
          className={`${styles.toggleSwitch} ${settings.enabled ? styles.toggleSwitchOn : styles.toggleSwitchOff}`}
        >
          <span
            className={`${styles.toggleHandle} ${settings.enabled ? styles.toggleHandleOn : ""}`}
          />
        </button>
      </div>

      {/* Main Content Grid: 2 Columns */}
      <div className={styles.mainGrid}>
        {/* Left Column: Schedules, Audiences & System Status */}
        <div className={styles.columnLeft}>
          {/* Timing and Language Card */}
          <div className={styles.sectionCard}>
            <div className={styles.cardHeader}>
              <h3 className={styles.cardHeaderTitle}>
                <Clock style={{ width: 18, height: 18, color: "#3b82f6" }} />
                Timing &amp; Language
              </h3>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>
                Daily Send Time (Asia/Kolkata IST)
              </label>
              <input
                type="time"
                value={settings.sendTimeLocal || settings.sendTime || "07:00"}
                onChange={(e) => {
                  handleTextChange("sendTimeLocal", e.target.value);
                  handleTextChange("sendTime", e.target.value);
                }}
                className={styles.inputControl}
              />
              <p className={styles.fieldHelper}>Default: 07:00 AM IST (wishes arrive early morning)</p>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>
                <LanguageIcon style={{ width: 15, height: 15, color: "#3b82f6" }} />
                Language
              </label>
              <select
                value={settings.language || "EN"}
                onChange={(e) => handleTextChange("language", e.target.value)}
                className={styles.inputControl}
              >
                <option value="EN">English Only</option>
                <option value="TA">Tamil Only (தமிழ்)</option>
                <option value="BOTH">Bilingual (English + Tamil)</option>
              </select>
            </div>
          </div>

          {/* Target Audiences Card */}
          <div className={styles.sectionCard}>
            <div className={styles.cardHeader}>
              <h3 className={styles.cardHeaderTitle}>
                <Users style={{ width: 18, height: 18, color: "#3b82f6" }} />
                Target Audiences
              </h3>
            </div>

            <div className={styles.toggleRowList}>
              {[
                {
                  key: "notifyParents",
                  label: "Parents of Students",
                  desc: "Parent receives wish for their child's birthday",
                },
                {
                  key: "notifyClassTeacher",
                  label: "Class Teacher Digest",
                  desc: "Send a consolidated notification to the class teacher when students celebrate",
                },
                {
                  key: "notifyTeachers",
                  label: "Teachers",
                  desc: "Congratulate teachers on their birthday",
                },
                {
                  key: "notifyStaff",
                  label: "Non-Teaching Staff",
                  desc: "Send warm wishes to admin & office staff",
                },
                {
                  key: "notifyAdmins",
                  label: "Administrators",
                  desc: "Send birthday greetings to school administrators",
                },
                {
                  key: "notifyStudents",
                  label: "Student Accounts",
                  desc: "Display celebration banner on student login",
                },
                {
                  key: "whatsappShortcut",
                  label: "WhatsApp Wish Shortcut",
                  desc: "Allow class teachers to send 1-tap WhatsApp greetings to parents",
                },
                {
                  key: "subjectTeachersCanViewBirthdays",
                  label: "Switch A: Subject Teachers Can View Birthdays",
                  desc: "Allow subject teachers to see today's celebrants for classes they teach (names only, no raw DOB)",
                },
                {
                  key: "subjectTeachersCanEnterDob",
                  label: "Switch B: Subject Teachers Can Enter Missing DOB",
                  desc: "Permit subject teachers to enter missing student dates of birth for classes they teach",
                },
                {
                  key: "teacherCanEditExistingDob",
                  label: "Allow Teachers to Edit Existing DOBs",
                  desc: "Permit class teachers to update previously saved student dates",
                },
                {
                  key: "requireAdminApprovalForDobChange",
                  label: "Require Admin Approval for Date Changes",
                  desc: "Teacher date changes must be approved in Admin Approval Log",
                },
              ].map((item) => (
                <div key={item.key} className={styles.toggleRow}>
                  <div className={styles.toggleRowText}>
                    <span className={styles.toggleRowLabel}>{item.label}</span>
                    <span className={styles.toggleRowDesc}>{item.desc}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(settings[item.key])}
                    onChange={() => handleToggle(item.key)}
                    className={styles.miniCheckbox}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* System Status Card */}
          <div className={styles.sectionCard}>
            <div className={styles.cardHeader}>
              <h3 className={styles.cardHeaderTitle}>
                <Shield style={{ width: 18, height: 18, color: "#10b981" }} />
                System Status
              </h3>
            </div>

            <div className={styles.statusList}>
              <div className={styles.statusItem}>
                <span className={styles.statusItemLabel}>School Timezone</span>
                <span className={styles.statusItemVal}>Asia/Kolkata (IST)</span>
              </div>
              <div className={styles.statusItem}>
                <span className={styles.statusItemLabel}>Today&apos;s School Date</span>
                <span className={styles.statusItemVal} style={{ fontFamily: "monospace" }}>
                  {dashboardMeta.schoolNow.dateString}
                </span>
              </div>
              <div className={styles.statusItem}>
                <span className={styles.statusItemLabel}>CRON_SECRET Configured</span>
                {dashboardMeta.hasCronSecret ? (
                  <span style={{ color: "#10b981", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <CheckCircle2 style={{ width: 14, height: 14 }} /> Yes
                  </span>
                ) : (
                  <span style={{ color: "#f59e0b", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <AlertTriangle style={{ width: 14, height: 14 }} /> Not Set
                  </span>
                )}
              </div>
              <div className={styles.statusItem}>
                <span className={styles.statusItemLabel}>Idempotency Guarantee</span>
                <span style={{ color: "#10b981", fontWeight: 600 }}>1 Wish / Year / Recipient</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSendTest}
              disabled={isSendingTest}
              className={styles.btnTest}
            >
              {isSendingTest ? <Loader2 style={{ width: 15, height: 15 }} className="animate-spin" /> : <Send style={{ width: 15, height: 15 }} />}
              Send Test Wish to My Account
            </button>
            {testResult && (
              <p style={{
                fontSize: "0.75rem",
                marginTop: "0.5rem",
                textAlign: "center",
                color: testResult.startsWith("Error") ? "#ef4444" : "#10b981",
                fontWeight: 600
              }}>
                {testResult}
              </p>
            )}
          </div>
        </div>

        {/* Right Column: Templates, Card Designer & History */}
        <div className={styles.columnRight}>
          <div className={styles.sectionCard}>
            <div className={styles.cardHeader}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <h3 className={styles.cardHeaderTitle}>Greeting Message Templates</h3>
                <p className={styles.fieldHelper}>
                  Placeholders available: <code className={styles.chip}>&#123;name&#125;</code>, <code className={styles.chip}>&#123;studentName&#125;</code>, <code className={styles.chip}>&#123;className&#125;</code>
                </p>
              </div>
            </div>

            {/* Template Selector Tabs */}
            <div className={styles.templateTabBar}>
              {[
                { id: "CARD", label: "Official Birthday Card" },
                { id: "STUDENT_PARENT", label: "Student & Parent" },
                { id: "TEACHER", label: "Teacher" },
                { id: "STAFF", label: "Staff" },
                { id: "ADMIN", label: "Admin" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTemplateTab(tab.id as any)}
                  className={`${styles.templateTabBtn} ${activeTemplateTab === tab.id ? styles.templateTabBtnActive : ""}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Official Birthday Card Editor & Live Interactive Preview */}
            {activeTemplateTab === "CARD" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <div className={styles.gridThree}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>
                      Correspondent / Sender Name
                    </label>
                    <input
                      type="text"
                      value={settings.senderName ?? "PRANAV.J"}
                      onChange={(e) => handleTextChange("senderName", e.target.value)}
                      placeholder="e.g. PRANAV.J"
                      className={styles.inputControl}
                    />
                  </div>

                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>
                      Designation
                    </label>
                    <input
                      type="text"
                      value={settings.senderDesignation ?? "Correspondent"}
                      onChange={(e) => handleTextChange("senderDesignation", e.target.value)}
                      placeholder="e.g. Correspondent"
                      className={styles.inputControl}
                    />
                  </div>

                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>
                      Deity / God Name in Prayer
                    </label>
                    <input
                      type="text"
                      value={settings.deityName ?? "Amman"}
                      onChange={(e) => handleTextChange("deityName", e.target.value)}
                      placeholder="e.g. Amman"
                      className={styles.inputControl}
                    />
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>
                    Card Message Line 1 (Greeting)
                  </label>
                  <input
                    type="text"
                    value={settings.cardLine1 ?? "I have great pleasure in conveying my best wishes on the eve of your birthday"}
                    onChange={(e) => handleTextChange("cardLine1", e.target.value)}
                    className={styles.inputControl}
                  />
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>
                    Card Message Line 2 (Blessings) &bull; Use <code className={styles.chip}>&#123;deityName&#125;</code> for deity substitution
                  </label>
                  <input
                    type="text"
                    value={settings.cardLine2 ?? "My prayers are to {deityName} to bless you with peace, prosperity and happiness"}
                    onChange={(e) => handleTextChange("cardLine2", e.target.value)}
                    className={styles.inputControl}
                  />
                </div>

                {/* Live Interactive Designed Card Preview */}
                <div className={styles.cardPreviewWrapper}>
                  <div className={styles.cardPreviewHeader}>
                    <Eye style={{ width: 14, height: 14 }} />
                    Live Designed Card Preview (Sample Celebrant: Anushka A)
                  </div>

                  <div className={styles.cardPreviewFrame}>
                    <BirthdayWishCard
                      recipientName="Anushka A"
                      classNameLabel="Class 10-A"
                      deityName={settings.deityName || "Amman"}
                      cardLine1={settings.cardLine1}
                      cardLine2={settings.cardLine2}
                      senderName={settings.senderName || "PRANAV.J"}
                      senderDesignation={settings.senderDesignation || "Correspondent"}
                      schoolName="SRT SCHOOL"
                      schoolLogo="/logo/srt-logo.svg"
                      schoolTagline="UNIVERSAL SCHOOL"
                      ammanPhotoUrl="/assets/birthday/amman.jpg"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Student & Parent Template */}
            {activeTemplateTab === "STUDENT_PARENT" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.15rem" }}>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>
                    English Message (Sent to Parents)
                  </label>
                  <textarea
                    rows={3}
                    value={
                      settings.parentTemplateEn ||
                      "Dear Parent, SRT School wishes {studentName} a very happy birthday! May this year bring happiness, good health, and abundant success. - SRT Universal School"
                    }
                    onChange={(e) => handleTextChange("parentTemplateEn", e.target.value)}
                    className={styles.textareaControl}
                  />
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>
                    Tamil Message (தமிழ்)
                  </label>
                  <textarea
                    rows={3}
                    value={
                      settings.parentTemplateTa ||
                      "அன்புள்ள பெற்றோருக்கு, {studentName}-க்கு SRT பள்ளி பிறந்தநாள் நல்வாழ்த்துகளைத் தெரிவித்துக் கொள்கிறது! - SRT Universal School"
                    }
                    onChange={(e) => handleTextChange("parentTemplateTa", e.target.value)}
                    className={styles.textareaControl}
                  />
                </div>

                {/* Live Notification Preview Box */}
                <div className={styles.notificationPreviewBox}>
                  <div className={styles.cardPreviewHeader}>
                    <Eye style={{ width: 14, height: 14 }} />
                    Live Notification Preview (Parent View)
                  </div>
                  <div className={styles.notificationPreviewTitle}>
                    Happy Birthday, [Student Name]! 🎂
                  </div>
                  <p className={styles.notificationPreviewBody}>
                    {(settings.language === "TA"
                      ? settings.parentTemplateTa
                      : settings.language === "BOTH"
                        ? `${settings.parentTemplateEn || ""}\n\n${settings.parentTemplateTa || ""}`
                        : settings.parentTemplateEn) ||
                      "Dear Parent, SRT School wishes your child a very happy birthday! May this year bring happiness, good health, and abundant success. - SRT Universal School"
                    }
                  </p>
                </div>
              </div>
            )}

            {/* Teacher Template */}
            {activeTemplateTab === "TEACHER" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.15rem" }}>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>
                    English Message (Sent to Teachers)
                  </label>
                  <textarea
                    rows={3}
                    value={
                      settings.teacherTemplateEn ||
                      "Dear {name}, SRT School wishes you a very Happy Birthday! Thank you for your dedication and wonderful service to our students. Have a fantastic year ahead! - SRT Universal School"
                    }
                    onChange={(e) => handleTextChange("teacherTemplateEn", e.target.value)}
                    className={styles.textareaControl}
                  />
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>
                    Tamil Message (தமிழ்)
                  </label>
                  <textarea
                    rows={3}
                    value={
                      settings.teacherTemplateTa ||
                      "வணக்கம் {name}, SRT பள்ளி தங்களுக்கு மனமார்ந்த பிறந்தநாள் நல்வாழ்த்துகளைத் தெரிவித்துக் கொள்கிறது! - SRT Universal School"
                    }
                    onChange={(e) => handleTextChange("teacherTemplateTa", e.target.value)}
                    className={styles.textareaControl}
                  />
                </div>
              </div>
            )}

            {/* Staff Template */}
            {activeTemplateTab === "STAFF" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.15rem" }}>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>
                    English Message (Sent to Staff)
                  </label>
                  <textarea
                    rows={3}
                    value={
                      settings.staffTemplateEn ||
                      "Dear {name}, SRT School wishes you a very Happy Birthday! Thank you for your valuable support and contribution. - SRT Universal School"
                    }
                    onChange={(e) => handleTextChange("staffTemplateEn", e.target.value)}
                    className={styles.textareaControl}
                  />
                </div>
              </div>
            )}

            {/* Admin Template */}
            {activeTemplateTab === "ADMIN" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.15rem" }}>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>
                    English Message (Sent to Administrators)
                  </label>
                  <textarea
                    rows={3}
                    value={
                      settings.adminTemplateEn ||
                      "Dear {name}, SRT School wishes you a very Happy Birthday! Thank you for your leadership and guidance. - SRT Universal School"
                    }
                    onChange={(e) => handleTextChange("adminTemplateEn", e.target.value)}
                    className={styles.textareaControl}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Recent Cron Job Execution History Card */}
          <div className={styles.sectionCard}>
            <div className={styles.cardHeader}>
              <h3 className={styles.cardHeaderTitle}>
                <History style={{ width: 18, height: 18, color: "#3b82f6" }} />
                Recent Dispatch Runs
              </h3>
            </div>

            {dashboardMeta.recentRuns.length === 0 ? (
              <p style={{
                textAlign: "center",
                padding: "1.25rem 0",
                color: "var(--text-muted, #64748b)",
                fontSize: "0.8125rem",
                margin: 0
              }}>
                No past runs recorded yet. The scheduler will record every daily run here.
              </p>
            ) : (
              <div className={styles.historyTableWrapper}>
                <table className={styles.historyTable}>
                  <thead>
                    <tr>
                      <th>Run Date</th>
                      <th>Status</th>
                      <th style={{ textAlign: "right" }}>Eligible</th>
                      <th style={{ textAlign: "right" }}>Sent</th>
                      <th style={{ textAlign: "right" }}>Skipped</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardMeta.recentRuns.map((r: any) => (
                      <tr key={r.id}>
                        <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{r.forDate}</td>
                        <td>
                          <span className={r.failedCount === 0 ? styles.statusPillActive : styles.statusPillPaused}>
                            {r.failedCount === 0 ? "SUCCESS" : "PARTIAL"}
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {r.sentCount + (r.skippedAlreadySent || 0) + (r.skippedNoAccount || 0)}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: "#10b981" }}>
                          {r.sentCount}
                        </td>
                        <td style={{ textAlign: "right", color: "var(--text-muted, #64748b)" }}>
                          {(r.skippedAlreadySent || 0) + (r.skippedNoAccount || 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
