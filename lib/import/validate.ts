/**
 * Core validation engine for bulk import rows.
 * Features:
 * - Lossless normalization and field mapping
 * - Zod schema verification
 * - In-file duplicate and cross-email conflict detection
 * - Same-person duplicate detection (e.g. Rows 13 & 21 with identical phone)
 * - Class teacher multi-claim collision detection
 * - DB duplicate verification
 * - One-click actionable suggestions
 */

import { prisma } from "@/backend/db/prisma";
import {
  ColumnMappingItem,
  RawRow,
  RowValidationResult,
  SuggestionAction,
  ImportRole,
} from "./types";
import {
  assessPassword,
  normalizeEmail,
  normalizeFullName,
  normalizeGender,
  normalizePhone,
  normalizeResidenceType,
  normalizeSubjects,
  parseClassTeacher,
  resolveClassSmart,
  splitFullName,
  tryExtractIndianMobile,
  isValidEmail,
  isValidIndianPhone,
} from "./normalizers";
import { formatDateToKolkataIso } from "./coerce";
import { TeacherRowSchema } from "./schemas/teacher";
import { StudentRowSchema } from "./schemas/student";

export interface ValidationContext {
  role: ImportRole;
  columnMappings: ColumnMappingItem[];
  rawRows: RawRow[];
  checkDb?: boolean;
  availableClasses?: Array<{ id: string; name: string; section: string }>;
  autoFix?: boolean;
}

export interface RevalidationContext {
  role: ImportRole;
  rows: Record<string, any>[];
  checkDb?: boolean;
  availableClasses?: Array<{ id: string; name: string; section: string }>;
  autoFix?: boolean;
}

function normalizeDobValue(rawDob: string): { isoDate?: string; isValid: boolean; error?: string } {
  const str = (rawDob || "").trim();
  if (!str) return { isValid: true };

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const d = new Date(`${str}T00:00:00Z`);
    if (!isNaN(d.getTime()) && d.getUTCFullYear() >= 1990 && d <= new Date()) {
      return { isValid: true, isoDate: str };
    }
    return { isValid: false, error: "Invalid Date of Birth (must be a valid past date YYYY-MM-DD)." };
  }

  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const d = new Date(Date.UTC(year, month, day));
    if (
      d.getUTCFullYear() === year &&
      d.getUTCMonth() === month &&
      d.getUTCDate() === day &&
      year >= 1990 &&
      d <= new Date()
    ) {
      return { isValid: true, isoDate: d.toISOString().split("T")[0] };
    }
    return { isValid: false, error: "Invalid Date of Birth (expected DD/MM/YYYY or YYYY-MM-DD)." };
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 1990 && parsed <= new Date()) {
    return { isValid: true, isoDate: parsed.toISOString().split("T")[0] };
  }

  return { isValid: false, error: "Invalid Date of Birth format (use YYYY-MM-DD or DD/MM/YYYY)." };
}

function isSampleTemplateRow(role: ImportRole, data: Record<string, any>): boolean {
  if (role === "STUDENT" || role === "PARENT") {
    const sName = `${data.studentFirstName || data.firstName || ""} ${data.studentLastName || data.lastName || ""}`.toLowerCase();
    const pEmail = String(data.parentEmail || "").toLowerCase();
    const roll = String(data.studentRollNo || data.rollNo || "").trim();
    const adm = String(data.admissionNo || "").trim();
    return (
      (sName.includes("jimmy doe") || pEmail.includes("parent@example.com")) &&
      (roll === "101" || adm.toUpperCase() === "ADM101")
    );
  }
  if (role === "TEACHER") {
    const tName = `${data.firstName || ""} ${data.lastName || ""}`.toLowerCase();
    const email = String(data.email || data.userId || "").toLowerCase();
    return (
      (tName.includes("john doe") ||
        email.includes("john.teacher@example.com") ||
        email.includes("teacher@example.com")) &&
      String(data.phone || "").includes("9876543210")
    );
  }
  return false;
}

/**
 * Validates all raw rows against the configured column mappings and role rules.
 */
export async function validateImportRows(
  context: ValidationContext
): Promise<RowValidationResult[]> {
  const { role, columnMappings, rawRows, checkDb = true, availableClasses, autoFix = true } = context;

  const headerToField = new Map<string, string>();
  for (const m of columnMappings) {
    if (m.targetField) {
      headerToField.set(m.excelHeader, m.targetField);
    }
  }

  const mappedInputs = rawRows.map((r) => {
    const rawData: Record<string, string> = { ...r.cells };
    const mapped: Record<string, any> = {};
    for (const [header, val] of Object.entries(rawData)) {
      const field = headerToField.get(header);
      if (field) {
        mapped[field] = val;
      }
    }
    return {
      excelRowNumber: r.excelRowNumber,
      mapped,
      originalData: rawData,
    };
  });

  return runValidationPipeline({
    role,
    inputs: mappedInputs,
    checkDb,
    availableClasses,
    autoFix,
  });
}

/**
 * Revalidates already-mapped/edited rows (used after Edit Modal, Auto-Fix, or Revalidate All).
 * Guarantees identical rules to validateImportRows.
 */
export async function revalidateImportRows(
  context: RevalidationContext
): Promise<RowValidationResult[]> {
  const { role, rows, checkDb = true, availableClasses, autoFix = false } = context;

  const mappedInputs = rows.map((r, idx) => {
    const mapped: Record<string, any> = { ...r };
    if (role === "STUDENT" || role === "PARENT") {
      // Sync edited split name fields back to unified name if user edited them in modal
      if (mapped.studentFirstName !== undefined || mapped.studentLastName !== undefined) {
        const sJoined = `${mapped.studentFirstName || ""} ${mapped.studentLastName === "." ? "" : mapped.studentLastName || ""}`.trim();
        if (sJoined) mapped.name = sJoined;
      }
      if (mapped.parentFirstName !== undefined || mapped.parentLastName !== undefined) {
        const pJoined = `${mapped.parentFirstName || ""} ${mapped.parentLastName === "." ? "" : mapped.parentLastName || ""}`.trim();
        if (pJoined) mapped.parentName = pJoined;
      }
      if (!mapped.rollNo && mapped.studentRollNo) {
        mapped.rollNo = mapped.studentRollNo;
      }
      if (mapped.studentDob !== undefined && mapped.dob === undefined) {
        mapped.dob = mapped.studentDob;
      }
    } else if (role === "TEACHER") {
      if (mapped.firstName !== undefined || mapped.lastName !== undefined) {
        const tJoined = `${mapped.firstName || ""} ${mapped.lastName === "." ? "" : mapped.lastName || ""}`.trim();
        if (tJoined) mapped.name = tJoined;
      }
      if (!mapped.userId && mapped.email) {
        mapped.userId = mapped.email;
      }
    }
    return {
      excelRowNumber: mapped.excelRowNumber || idx + 2,
      mapped,
      originalData: (mapped.originalData as Record<string, string>) || {},
    };
  });

  return runValidationPipeline({
    role,
    inputs: mappedInputs,
    checkDb,
    availableClasses,
    autoFix,
  });
}

async function runValidationPipeline({
  role,
  inputs,
  checkDb = true,
  availableClasses,
  autoFix = true,
}: {
  role: ImportRole;
  inputs: Array<{
    excelRowNumber: number;
    mapped: Record<string, any>;
    originalData: Record<string, string>;
  }>;
  checkDb?: boolean;
  availableClasses?: Array<{ id: string; name: string; section: string }>;
  autoFix?: boolean;
}): Promise<RowValidationResult[]> {
  let activeClasses = availableClasses || [];
  if (activeClasses.length === 0 && checkDb) {
    try {
      activeClasses = await prisma.class.findMany({
        where: { isActive: true },
        select: { id: true, name: true, section: true },
        orderBy: [{ name: "asc" }, { section: "asc" }],
      });
    } catch (err) {
      console.warn("Could not fetch active classes for import validation:", err);
    }
  }

  // 1. Initial row construction and individual field normalization
  const parsedRows: Array<{
    excelRowNumber: number;
    data: Record<string, any>;
    originalData: Record<string, string>;
    fieldErrors: Record<string, string>;
    warnings: Record<string, string>;
    isSampleRow: boolean;
    extractedPhoneSuggestion?: string | null;
    missingEmailSuggestion?: string | null;
    unclearResidenceRaw?: string | null;
  }> = [];

  for (const input of inputs) {
    const mapped: Record<string, any> = { ...input.mapped };
    mapped.excelRowNumber = input.excelRowNumber;
    const rawData = input.originalData;
    const fieldErrors: Record<string, string> = {};
    const warnings: Record<string, string> = {};
    let extractedPhoneSuggestion: string | null = null;
    let missingEmailSuggestion: string | null = null;
    let unclearResidenceRaw: string | null = null;

    if (role === "TEACHER") {
      // Normalization for Teacher
      const rawName = mapped.name || `${mapped.firstName || ""} ${mapped.lastName || ""}`.trim();
      const cleanName = normalizeFullName(rawName);
      const { firstName, lastName } = splitFullName(cleanName);

      mapped.name = cleanName;
      mapped.fullName = cleanName;
      mapped.firstName = firstName;
      mapped.lastName = lastName;

      mapped.gender = normalizeGender(mapped.gender || "");
      const rawPhone = String(mapped.phone || "").trim();
      let cleanedPhone = normalizePhone(rawPhone);
      if (rawPhone && !isValidIndianPhone(cleanedPhone)) {
        const extracted = tryExtractIndianMobile(rawPhone);
        if (extracted) {
          if (autoFix) {
            cleanedPhone = extracted;
            warnings.phone = `Auto-fixed oversized phone '${rawPhone}' → '${extracted}'.`;
          } else {
            extractedPhoneSuggestion = extracted;
          }
        }
      }
      mapped.phone = cleanedPhone;
      mapped.userId = normalizeEmail(mapped.userId || "");
      mapped.email = mapped.userId; // compatibility with legacy UI
      mapped.googleEmail = normalizeEmail(mapped.googleEmail || "");
      mapped.qualification = (mapped.qualification || "").trim();
      mapped.joiningDate = mapped.joiningDate || formatDateToKolkataIso(new Date());

      const rawSubject = mapped.subject || "";
      mapped.subjects = normalizeSubjects(rawSubject);
      mapped.subject = mapped.subjects.join(", ");

      const classResolution = resolveClassSmart(mapped.classTeacher || "", activeClasses);
      mapped.isClassTeacher = classResolution.isClassTeacher;
      mapped.classTeacherClassId = classResolution.matchedClass?.id || "";
      mapped.classTeacherClassName = classResolution.canonicalName;
      mapped.classTeacher = classResolution.canonicalName;
      mapped.classNotFound = classResolution.isNotFound;
      if (classResolution.isNotFound) {
        mapped.classNotFoundName = classResolution.rawEntry;
        warnings.classTeacher = `Class "${classResolution.rawEntry}" is not created in the portal yet.`;
      }
      if (classResolution.isNonClassRole) {
        mapped.nonClassRole = classResolution.nonClassRole;
      }

      const pwdQuality = assessPassword(mapped.password || "", mapped.phone);
      if (pwdQuality.warning) {
        warnings.password = pwdQuality.warning;
      }

      // Validate with TeacherRowSchema
      const result = TeacherRowSchema.safeParse(mapped);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const fieldName = String(issue.path[0] || "general");
          fieldErrors[fieldName] = issue.message;
        }
      }
    } else {
      // Normalization for Student / Parent
      const rawStudentName = mapped.name || `${mapped.studentFirstName || ""} ${mapped.studentLastName || ""}`.trim();
      const cleanStudentName = normalizeFullName(rawStudentName);
      const studentSplit = splitFullName(cleanStudentName);

      mapped.name = cleanStudentName;
      mapped.fullName = cleanStudentName;
      mapped.studentFirstName = studentSplit.firstName;
      mapped.studentLastName = studentSplit.lastName || (mapped.studentLastName === "." ? "." : "");
      mapped.firstName = studentSplit.firstName;
      mapped.lastName = mapped.studentLastName;

      mapped.rollNo = String(mapped.rollNo || mapped.studentRollNo || mapped.admissionNo || "").trim();
      mapped.studentRollNo = mapped.rollNo;
      mapped.admissionNo = String(mapped.admissionNo || "").trim() || (mapped.rollNo ? `ADM${mapped.rollNo}` : "");
      mapped.batch = String(mapped.batch || "").trim();
      mapped.gender = normalizeGender(mapped.gender || "");

      // Optional Date of Birth validation (non-blocking if omitted in bulk sheet)
      const rawDob = String(mapped.dob || mapped.studentDob || "").trim();
      if (rawDob) {
        const dobRes = normalizeDobValue(rawDob);
        if (!dobRes.isValid && dobRes.error) {
          fieldErrors.studentDob = dobRes.error;
        } else if (dobRes.isoDate) {
          mapped.dob = dobRes.isoDate;
          mapped.studentDob = dobRes.isoDate;
        }
      } else {
        mapped.dob = "";
        mapped.studentDob = "";
      }

      // Class matching & canonical formatting (supports auto-creation of missing classes on import)
      const rawClass = String(mapped.class || "").trim();
      mapped.class = rawClass;
      if (rawClass) {
        const classResolution = resolveClassSmart(rawClass, activeClasses);
        if (classResolution.matchedClass) {
          mapped.classId = classResolution.matchedClass.id;
          mapped.classNameResolved = `${classResolution.matchedClass.name} - Section ${classResolution.matchedClass.section}`;
          mapped.willAutoCreateClass = false;
        } else {
          const parsedCls = parseClassTeacher(rawClass);
          const niceName = parsedCls.className && parsedCls.section
            ? `${parsedCls.className} - Section ${parsedCls.section}`
            : (classResolution.canonicalName || rawClass);
          mapped.classId = "";
          mapped.classNameResolved = niceName;
          mapped.willAutoCreateClass = true;
          warnings.class = `Class "${niceName}" will be created automatically on import.`;
        }
      } else if (mapped.classId) {
        const matched = activeClasses.find(c => c.id === mapped.classId);
        if (matched) {
          mapped.class = `${matched.name} - Section ${matched.section}`;
          mapped.classNameResolved = mapped.class;
          mapped.willAutoCreateClass = false;
        }
      }

      // Residence Type (HOSTEL or DAYSCHOLAR)
      const rawRes = String(mapped.residenceType || "").trim();
      const resInfo = normalizeResidenceType(rawRes);
      if (resInfo.unclear) {
        if (autoFix) {
          mapped.residenceType = "DAYSCHOLAR";
          warnings.residenceType = `Auto-fixed unclear residence '${rawRes}' → 'DAYSCHOLAR'.`;
        } else {
          mapped.residenceType = rawRes;
          unclearResidenceRaw = rawRes;
          fieldErrors.residenceType = `Unclear option '${rawRes}'. Select Dayscholar or Hostel.`;
        }
      } else {
        mapped.residenceType = resInfo.value;
      }

      // Parent Name
      const rawParentName = mapped.parentName || `${mapped.parentFirstName || ""} ${mapped.parentLastName || ""}`.trim();
      const cleanParentName = normalizeFullName(rawParentName);
      const parentSplit = splitFullName(cleanParentName);
      mapped.parentName = cleanParentName;
      mapped.parentFirstName = parentSplit.firstName;
      mapped.parentLastName = parentSplit.lastName || (mapped.parentLastName === "." ? "." : "");

      // Parent Address
      mapped.parentAddress = String(mapped.parentAddress || "").trim();

      // Parent Phone (Auto-extract 10 digits on overlong numbers when autoFix is enabled)
      const rawPhone = String(mapped.parentPhone || "").trim();
      let cleanedPhone = normalizePhone(rawPhone);
      if (rawPhone && !isValidIndianPhone(cleanedPhone)) {
        const extracted = tryExtractIndianMobile(rawPhone);
        if (extracted) {
          if (autoFix) {
            cleanedPhone = extracted;
            warnings.parentPhone = `Auto-fixed oversized phone '${rawPhone}' → '${extracted}'.`;
          } else {
            extractedPhoneSuggestion = extracted;
          }
        }
      }
      mapped.parentPhone = cleanedPhone;

      // User ID & Sign In with Google Mail ID mapping
      const rawUserIdInput = normalizeEmail(String(mapped.userId || mapped.parentEmail || ""));
      const rawGoogleInput = normalizeEmail(String(mapped.googleEmail || ""));
      const hasValidGoogle = Boolean(rawGoogleInput && isValidEmail(rawGoogleInput));
      const hasValidUserEmail = Boolean(rawUserIdInput && isValidEmail(rawUserIdInput));

      if (rawUserIdInput && !rawUserIdInput.includes("@") && hasValidGoogle) {
        // Sheet gave a short User ID (e.g. "anushka", "Kaviraji") AND a valid Google Mail ID:
        // Use valid email as primary parentEmail, preserve User ID in alternateEmail for credentials login!
        mapped.userId = rawUserIdInput;
        mapped.alternateEmail = rawUserIdInput;
        mapped.parentEmail = rawGoogleInput;
        mapped.googleEmail = rawGoogleInput;
      } else if (!rawUserIdInput && hasValidGoogle) {
        mapped.userId = rawGoogleInput;
        mapped.parentEmail = rawGoogleInput;
        mapped.googleEmail = rawGoogleInput;
      } else if (!rawUserIdInput && !rawGoogleInput && mapped.rollNo) {
        const generatedEmail = `parent.${mapped.rollNo.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}@school.portal`;
        if (autoFix) {
          mapped.parentEmail = generatedEmail;
          mapped.userId = generatedEmail;
          warnings.parentEmail = `Auto-generated portal login ID '${generatedEmail}'.`;
        } else {
          missingEmailSuggestion = generatedEmail;
        }
      } else {
        mapped.parentEmail = rawUserIdInput;
        mapped.userId = rawUserIdInput;
        mapped.googleEmail = rawGoogleInput || (hasValidUserEmail ? "" : "");
      }

      // Parent Password (non-blocking weak password advisory; keeps user's chosen Excel password)
      const rawPassword = String(mapped.parentPassword || mapped.password || "").trim();
      if (!rawPassword) {
        mapped.parentPassword = "Parent@123";
        warnings.password = "Blank password defaulted to 'Parent@123'.";
      } else {
        mapped.parentPassword = rawPassword;
        const pwdQuality = assessPassword(rawPassword, mapped.parentPhone);
        if (pwdQuality.warning) {
          warnings.password = pwdQuality.warning;
        }
      }

      // Validate with StudentRowSchema
      const result = StudentRowSchema.safeParse(mapped);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const fieldName = String(issue.path[0] || "general");
          fieldErrors[fieldName] = issue.message;
        }
      }
    }

    const isSampleRow = isSampleTemplateRow(role, mapped);

    parsedRows.push({
      excelRowNumber: input.excelRowNumber,
      data: mapped,
      originalData: rawData,
      fieldErrors,
      warnings,
      isSampleRow,
      extractedPhoneSuggestion,
      missingEmailSuggestion,
      unclearResidenceRaw,
    });
  }

  // 2. In-file duplicate detection
  const phoneToRows = new Map<string, number[]>();
  const userIdToRows = new Map<string, number[]>();
  const rollToRows = new Map<string, number[]>();
  const googleEmailToRows = new Map<string, number[]>();
  const classToRows = new Map<string, number[]>();

  for (let i = 0; i < parsedRows.length; i++) {
    const row = parsedRows[i];
    if (row.isSampleRow) continue;
    const d = row.data;

    const phone = d.phone || d.parentPhone;
    if (phone) {
      const list = phoneToRows.get(phone) || [];
      list.push(i);
      phoneToRows.set(phone, list);
    }

    const uid = d.userId || d.parentEmail || d.rollNo;
    if (uid) {
      const list = userIdToRows.get(String(uid).toLowerCase()) || [];
      list.push(i);
      userIdToRows.set(String(uid).toLowerCase(), list);
    }

    const roll = (d.rollNo || d.studentRollNo || "").trim().toLowerCase();
    if (roll) {
      const list = rollToRows.get(roll) || [];
      list.push(i);
      rollToRows.set(roll, list);
    }

    const gEmail = d.googleEmail;
    if (gEmail) {
      const list = googleEmailToRows.get(String(gEmail).toLowerCase()) || [];
      list.push(i);
      googleEmailToRows.set(String(gEmail).toLowerCase(), list);
    }

    const cls = d.classTeacher || d.class;
    if (cls && d.isClassTeacher) {
      const list = classToRows.get(String(cls).toLowerCase()) || [];
      list.push(i);
      classToRows.set(String(cls).toLowerCase(), list);
    }
  }

  // 3. Database check for existing records if requested
  const existingDbEmails = new Set<string>();
  const existingDbUserRoles = new Map<string, string>();
  const existingDbPhones = new Set<string>();
  const existingDbRolls = new Set<string>();
  const existingDbAdmissions = new Set<string>();

  if (checkDb) {
    try {
      const allUserIds = parsedRows
        .map(r => r.data.parentEmail || r.data.userId)
        .filter(Boolean);
      const allPhones = parsedRows
        .map(r => r.data.phone || r.data.parentPhone)
        .filter(Boolean);
      const allRolls = parsedRows
        .map(r => r.data.rollNo || r.data.studentRollNo)
        .filter(Boolean);
      const allAdmissions = parsedRows
        .map(r => r.data.admissionNo)
        .filter(Boolean);

      const dbUsers = allUserIds.length > 0
        ? await prisma.user.findMany({
            where: { email: { in: allUserIds } },
            select: { email: true, role: true },
          })
        : [];

      for (const u of dbUsers) {
        if (u.email) {
          const low = u.email.toLowerCase();
          existingDbEmails.add(low);
          existingDbUserRoles.set(low, u.role);
        }
      }

      if (role === "TEACHER") {
        const [dbTeachers, dbParents] = await Promise.all([
          allPhones.length > 0
            ? prisma.teacher.findMany({
                where: { phone: { in: allPhones } },
                select: { phone: true },
              })
            : [],
          allPhones.length > 0
            ? prisma.parent.findMany({
                where: { phone: { in: allPhones } },
                select: { phone: true },
              })
            : [],
        ]);

        for (const t of dbTeachers) {
          if (t.phone) existingDbPhones.add(normalizePhone(t.phone));
        }
        for (const p of dbParents) {
          if (p.phone) existingDbPhones.add(normalizePhone(p.phone));
        }
      } else {
        const dbStudents = (allRolls.length > 0 || allAdmissions.length > 0)
          ? await prisma.student.findMany({
              where: {
                OR: [
                  ...(allRolls.length > 0 ? [{ rollNumber: { in: allRolls } }] : []),
                  ...(allAdmissions.length > 0 ? [{ admissionNo: { in: allAdmissions } }] : []),
                ],
              },
              select: { rollNumber: true, admissionNo: true },
            })
          : [];

        for (const s of dbStudents) {
          if (s.rollNumber) existingDbRolls.add(s.rollNumber.toLowerCase());
          if (s.admissionNo) existingDbAdmissions.add(s.admissionNo.toLowerCase());
        }
      }
    } catch (err) {
      console.warn("DB check during import validation bypassed:", err);
    }
  }

  // 4. Construct final RowValidationResult list with actionable suggestions
  const results: RowValidationResult[] = [];

  for (let i = 0; i < parsedRows.length; i++) {
    const row = parsedRows[i];
    const d = row.data;
    const excelRow = row.excelRowNumber;

    if (row.isSampleRow) {
      results.push({
        rowId: `row-${excelRow}-${i}`,
        excelRowNumber: excelRow,
        status: "SAMPLE_ROW",
        isReadyToImport: false,
        isSampleRow: true,
        fieldErrors: {},
        missingFields: [],
        invalidFields: [],
        warnings: {},
        duplicateWarnings: ["Sample template row (will be skipped during import)."],
        conflictWarnings: [],
        suggestions: [],
        data: d,
        originalData: row.originalData,
      });
      continue;
    }

    const duplicateWarnings: string[] = [];
    const conflictWarnings: string[] = [];
    const suggestions: SuggestionAction[] = [];
    let samePersonMatch: RowValidationResult["samePersonMatch"] = undefined;
    let classConflict: RowValidationResult["classConflict"] = undefined;

    if (role === "TEACHER") {
      // Check Phone Duplicates / Same-person match
      const phone = d.phone;
      if (phone && (phoneToRows.get(phone)?.length || 0) > 1) {
        const matchingIdxs = phoneToRows.get(phone)!.filter(idx => idx !== i);
        const matchedRow = parsedRows[matchingIdxs[0]];

        samePersonMatch = {
          matchedRowNumber: matchedRow.excelRowNumber,
          matchedPersonName: matchedRow.data.name || "Unknown",
          reason: `Identical phone number (${phone}) with Row ${matchedRow.excelRowNumber}.`,
          differingFields: [],
        };

        duplicateWarnings.push(
          `Duplicate phone number (${phone}) shared with Excel Row ${matchedRow.excelRowNumber} (${matchedRow.data.name}).`
        );

        suggestions.push({
          id: `skip-dup-${excelRow}`,
          label: `Skip duplicate Row ${excelRow}`,
          field: "row",
          actionType: "SKIP_ROW",
        });
      }

      // Check User ID in-file duplicates
      const uid = (d.userId || "").toLowerCase();
      if (uid && (userIdToRows.get(uid)?.length || 0) > 1) {
        const otherIdxs = userIdToRows.get(uid)!.filter(idx => idx !== i);
        const otherRow = parsedRows[otherIdxs[0]];
        duplicateWarnings.push(
          `User ID "${uid}" is duplicated in Excel Row ${otherRow.excelRowNumber}.`
        );
      }

      // Check Cross-Email Conflict for Teachers
      if (d.userId && d.googleEmail && d.userId.toLowerCase() !== d.googleEmail.toLowerCase()) {
        const userIdPrefix = d.userId.split("@")[0].toLowerCase();
        const currentNameClean = (d.name || "").toLowerCase().replace(/[^a-z]/g, "");

        if (!currentNameClean.includes(userIdPrefix) && !userIdPrefix.includes(currentNameClean)) {
          conflictWarnings.push(
            `User ID (${d.userId}) does not match teacher name (${d.name}). Google Mail ID is (${d.googleEmail}).`
          );

          suggestions.push({
            id: `use-google-email-${excelRow}`,
            label: `Use Google mail as User ID (${d.googleEmail})`,
            field: "userId",
            newValue: d.googleEmail,
            actionType: "SET_FIELD",
          });
        }
      }

      // Check Class Teacher collisions
      const cls = (d.classTeacher || "").toLowerCase();
      if (cls && d.isClassTeacher && (classToRows.get(cls)?.length || 0) > 1) {
        const claimedIdxs = classToRows.get(cls)!;
        const claimedRowNums = claimedIdxs.map(idx => parsedRows[idx].excelRowNumber);

        classConflict = {
          className: d.classTeacher,
          claimedByRows: claimedRowNums,
        };

        conflictWarnings.push(
          `Class "${d.classTeacher}" is claimed as Class Teacher by rows: ${claimedRowNums.join(", ")}.`
        );

        suggestions.push({
          id: `clear-class-teacher-${excelRow}`,
          label: `Import as Subject Teacher (remove class teacher claim)`,
          field: "classTeacher",
          newValue: "",
          actionType: "CLEAR_FIELD",
        });
      }

      if (d.userId && existingDbEmails.has(d.userId.toLowerCase())) {
        conflictWarnings.push(`User ID / Email "${d.userId}" already exists in the portal database.`);
      }
      if (phone && existingDbPhones.has(phone)) {
        conflictWarnings.push(`Phone number "${phone}" is already registered to an existing portal user.`);
      }

      if (row.extractedPhoneSuggestion) {
        suggestions.push({
          id: `fix-phone-${excelRow}`,
          label: `Auto-Fix Phone (${row.extractedPhoneSuggestion})`,
          field: "phone",
          newValue: row.extractedPhoneSuggestion,
          actionType: "SET_FIELD",
        });
      }
    } else {
      // STUDENT / PARENT Duplicate & Conflict Checks (supports Siblings sharing Parent Email/Phone!)
      const rollLower = (d.rollNo || "").toLowerCase();
      if (rollLower && (rollToRows.get(rollLower)?.length || 0) > 1) {
        const otherIdxs = rollToRows.get(rollLower)!.filter(idx => idx !== i);
        const otherRow = parsedRows[otherIdxs[0]];
        duplicateWarnings.push(
          `Duplicate Roll Number "${d.rollNo}" also exists in Excel Row ${otherRow.excelRowNumber} (${otherRow.data.name}).`
        );
        suggestions.push({
          id: `skip-dup-${excelRow}`,
          label: `Skip duplicate Row ${excelRow}`,
          field: "row",
          actionType: "SKIP_ROW",
        });
      }

      // Inform if another student row shares the same parent (Sibling linking)
      const pEmailLower = (d.parentEmail || "").toLowerCase();
      if (pEmailLower && (userIdToRows.get(pEmailLower)?.length || 0) > 1) {
        const siblingIdxs = userIdToRows.get(pEmailLower)!.filter(idx => idx !== i);
        if (siblingIdxs.length > 0) {
          const sibRow = parsedRows[siblingIdxs[0]];
          row.warnings.sibling = `Sibling detected: links to same Parent account as Row ${sibRow.excelRowNumber}.`;
        }
      }

      // Check existing DB student by roll / admission number
      if (rollLower && existingDbRolls.has(rollLower)) {
        conflictWarnings.push(`Student Roll Number "${d.rollNo}" already exists in the portal database.`);
        suggestions.push({
          id: `skip-existing-${excelRow}`,
          label: `Skip already-enrolled Row ${excelRow}`,
          field: "row",
          actionType: "SKIP_ROW",
        });
      }
      const admLower = (d.admissionNo || "").toLowerCase();
      if (admLower && existingDbAdmissions.has(admLower)) {
        conflictWarnings.push(`Admission Number "${d.admissionNo}" already exists in the portal database.`);
      }

      // Existing parent email check (allow linking sibling or teacher/admin dual role!)
      if (pEmailLower && existingDbUserRoles.has(pEmailLower)) {
        const existingRole = existingDbUserRoles.get(pEmailLower);
        if (
          existingRole === "PARENT" ||
          existingRole === "TEACHER" ||
          existingRole === "STAFF" ||
          existingRole === "NON_TEACHING_STAFF" ||
          existingRole === "ADMIN"
        ) {
          d.isExistingParent = true;
          row.warnings.existingParent = `Links to existing ${existingRole} account (${d.parentEmail}).`;
        } else {
          conflictWarnings.push(`Email "${d.parentEmail}" is registered as a ${existingRole} account.`);
        }
      }

      // Actionable 1-Click Auto-Fix Suggestions for Student / Parent rows
      if (row.unclearResidenceRaw) {
        suggestions.push({
          id: `fix-res-day-${excelRow}`,
          label: `Set Residence: Dayscholar`,
          field: "residenceType",
          newValue: "DAYSCHOLAR",
          actionType: "SET_FIELD",
        });
        suggestions.push({
          id: `fix-res-hostel-${excelRow}`,
          label: `Set Residence: Hostel`,
          field: "residenceType",
          newValue: "HOSTEL",
          actionType: "SET_FIELD",
        });
      }

      if (row.fieldErrors.parentPhone) {
        if (row.extractedPhoneSuggestion) {
          suggestions.push({
            id: `fix-phone-${excelRow}`,
            label: `Auto-Fix Phone (${row.extractedPhoneSuggestion})`,
            field: "parentPhone",
            newValue: row.extractedPhoneSuggestion,
            actionType: "SET_FIELD",
          });
        }
        suggestions.push({
          id: `clear-phone-${excelRow}`,
          label: `Clear Invalid Phone (Import without phone)`,
          field: "parentPhone",
          newValue: "",
          actionType: "CLEAR_FIELD",
        });
      }

      if (row.missingEmailSuggestion) {
        suggestions.push({
          id: `fix-email-${excelRow}`,
          label: `Auto-Generate Login ID (${row.missingEmailSuggestion})`,
          field: "parentEmail",
          newValue: row.missingEmailSuggestion,
          actionType: "SET_FIELD",
        });
      }
    }

    // Password suggestion if weak
    if (row.warnings.password && !row.warnings.password.includes("defaulted")) {
      const randomStrongPass = `SRT@${Math.floor(1000 + Math.random() * 9000)}`;
      suggestions.push({
        id: `gen-pass-${excelRow}`,
        label: `Generate strong password (${randomStrongPass})`,
        field: role === "TEACHER" ? "password" : "parentPassword",
        newValue: randomStrongPass,
        actionType: "GENERATE_PASSWORD",
      });
    }

    // Determine final row status
    let status: RowValidationResult["status"] = "VALID";
    const hasFieldErrors = Object.keys(row.fieldErrors).length > 0;
    const missingFields = Object.keys(row.fieldErrors).filter(
      k => row.fieldErrors[k].toLowerCase().includes("required") || row.fieldErrors[k].toLowerCase().includes("missing")
    );
    const invalidFields = Object.keys(row.fieldErrors).filter(k => !missingFields.includes(k));
    const hasDuplicates = duplicateWarnings.length > 0;
    const hasDbConflicts = conflictWarnings.some(c => c.includes("database") || c.includes("registered"));

    if (hasDbConflicts) {
      status = "CONFLICT_DB";
    } else if (hasDuplicates) {
      status = "DUPLICATE_IN_FILE";
    } else if (hasFieldErrors) {
      status = "NEEDS_CORRECTION";
    }

    const isReady = status === "VALID" && !hasFieldErrors;

    results.push({
      rowId: `row-${excelRow}-${i}`,
      excelRowNumber: excelRow,
      status,
      isReadyToImport: isReady,
      isSampleRow: false,
      fieldErrors: row.fieldErrors,
      missingFields,
      invalidFields,
      warnings: row.warnings,
      duplicateWarnings,
      conflictWarnings,
      samePersonMatch,
      classConflict,
      suggestions,
      data: d,
      originalData: row.originalData,
    });
  }

  return results;
}
