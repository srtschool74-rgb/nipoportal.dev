/**
 * Schema and strict alias definitions for Student bulk upload.
 */

import { z } from "zod";
import { isValidEmail, isValidIndianPhone } from "../normalizers";
import { TargetFieldDef } from "./teacher";

export const STUDENT_TARGET_FIELDS: TargetFieldDef[] = [
  {
    key: "rollNo",
    label: "Roll Number / Student ID",
    required: true,
    description: "Unique student roll number (e.g. 7376252AD114)",
    aliases: [
      "roll no",
      "roll number",
      "student roll no",
      "student roll number",
      "student id",
      "reg no",
      "register no",
      "registration no",
    ],
  },
  {
    key: "admissionNo",
    label: "Admission Number",
    required: false,
    description: "Optional admission number (auto-generated as ADM<rollNo> if omitted)",
    aliases: ["admission no", "adm no", "admission number", "adm number", "admission"],
  },
  {
    key: "studentFirstName",
    label: "Student First Name",
    required: false,
    description: "Student first name (if separate from last name)",
    aliases: ["student first name", "student first"],
  },
  {
    key: "studentLastName",
    label: "Student Last Name",
    required: false,
    description: "Student last name (if separate from first name)",
    aliases: ["student last name", "student last", "student surname"],
  },
  {
    key: "name",
    label: "Student Name",
    required: true,
    description: "Student full name (e.g. ANUSHKA A)",
    aliases: [
      "student full name",
      "student name",
      "child name",
      "pupil name",
      "full name",
      "name",
    ],
  },
  {
    key: "batch",
    label: "Academic Batch",
    required: false,
    description: "Batch year range (e.g. 2026-2027)",
    aliases: [
      "batch",
      "academic batch",
      "batch year",
      "academic year",
      "batch e g 2023 2024",
    ],
  },
  {
    key: "class",
    label: "Class & Section",
    required: true,
    description: "Enrolled class (e.g. class 1 - section A, Class 2 - A)",
    aliases: [
      "class & section",
      "class and section",
      "class section",
      "class & sec",
      "class sec",
      "classname",
      "class name",
      "class",
      "standard",
      "std",
      "grade",
      "enrolled class",
    ],
  },
  {
    key: "gender",
    label: "Gender",
    required: false,
    description: "Gender (Male, Female, Other)",
    aliases: ["gender", "sex", "student gender"],
  },
  {
    key: "dob",
    label: "Date of Birth",
    required: false,
    description: "DOB (YYYY-MM-DD or DD/MM/YYYY)",
    aliases: ["date of birth", "dob", "student dob", "birth date", "birthday"],
  },
  {
    key: "residenceType",
    label: "Day Scholar / Hosteler",
    required: false,
    description: "DAYSCHOLAR or HOSTEL",
    aliases: [
      "hostel or dayscholar",
      "dayscholar or hostel",
      "hostel/dayscholar",
      "hostel dayscholar",
      "residence type",
      "residence",
      "day scholar",
      "dayscholar",
      "hosteler",
      "hosteller",
      "accommodation",
      "hostel",
    ],
  },
  {
    key: "parentFirstName",
    label: "Parent First Name",
    required: false,
    description: "Parent first name (if split)",
    aliases: ["parent first name", "parent first"],
  },
  {
    key: "parentLastName",
    label: "Parent Last Name",
    required: false,
    description: "Parent last name (if split)",
    aliases: ["parent last name", "parent last"],
  },
  {
    key: "parentDob",
    label: "Parent Date of Birth",
    required: false,
    description: "Optional parent DOB",
    aliases: ["parent dob", "parent date of birth"],
  },
  {
    key: "parentName",
    label: "Parent / Guardian Name",
    required: true,
    description: "Father, Mother, or Guardian full name",
    aliases: [
      "parent full name",
      "parent name",
      "parent/guardian name",
      "parents name",
      "father full name",
      "father name",
      "father's name",
      "mother full name",
      "mother name",
      "guardian name",
    ],
  },
  {
    key: "parentPhone",
    label: "Parent Phone Number",
    required: false,
    description: "10-digit mobile number for SMS & Portal login",
    aliases: [
      "parent phone",
      "parent phone number",
      "parent mobile",
      "phone number",
      "phone",
      "mobile number",
      "mobile",
      "contact no",
      "contact number",
      "emergency phone",
      "whatsapp",
    ],
  },
  {
    key: "parentAddress",
    label: "Address",
    required: false,
    description: "Residential address",
    aliases: [
      "address",
      "parent address",
      "residential address",
      "home address",
      "communication address",
      "location",
      "place",
    ],
  },
  {
    key: "parentEmail",
    label: "Parent User ID / Login Email",
    required: true,
    description: "Parent portal User ID or email address",
    aliases: [
      "user id",
      "userid",
      "login id",
      "username",
      "portal id",
      "parent email",
      "parent mail",
      "parent email id",
      "parent mail id",
      "login email",
      "email id",
      "email",
    ],
  },
  {
    key: "parentPassword",
    label: "Parent Password",
    required: false,
    description: "Parent portal initial password (defaults to Parent@123 if blank)",
    aliases: ["parent password", "password", "login password", "initial password", "pass", "pwd"],
  },
  {
    key: "googleEmail",
    label: "Sign In with Google Mail ID",
    required: false,
    description: "Parent email / Google Mail ID",
    aliases: [
      "sign in with google mail id",
      "google mail id",
      "google mail",
      "google email id",
      "google email",
      "gmail id",
      "gmail",
      "google account",
    ],
  },
];

export const StudentRowSchema = z.object({
  rollNo: z.string().min(1, "Roll number is required."),
  name: z.string().min(1, "Student name is required."),
  firstName: z.string().min(1, "Student first name is required."),
  lastName: z.string().optional().default(""),
  batch: z.string().optional().default(""),
  class: z.string().min(1, "Class is required."),
  gender: z.enum(["Female", "Male", "Other", "MALE", "FEMALE", "OTHER"]).default("Other"),
  dob: z.string().optional(),
  residenceType: z.enum(["DAYSCHOLAR", "HOSTEL"]).default("DAYSCHOLAR"),
  parentName: z.string().min(1, "Parent name is required."),
  parentFirstName: z.string().min(1, "Parent first name is required."),
  parentLastName: z.string().optional().default(""),
  parentPhone: z
    .string()
    .optional()
    .default("")
    .refine(p => !p || p.trim() === "" || isValidIndianPhone(p), {
      message: "Parent phone must be a valid 10-digit Indian mobile number.",
    }),
  parentAddress: z.string().optional().default(""),
  parentEmail: z
    .string()
    .min(1, "Parent User ID or email is required.")
    .refine(
      val => {
        if (val.includes("@")) return isValidEmail(val);
        return /^[a-zA-Z0-9._-]{3,}$/.test(val);
      },
      {
        message: "Parent email / User ID must be a valid email or alphanumeric ID (min 3 chars).",
      }
    ),
  parentPassword: z.string().optional().default("Parent@123"),
  googleEmail: z
    .string()
    .optional()
    .default("")
    .refine(val => !val || val.trim() === "" || isValidEmail(val), {
      message: "Google Mail ID must be a valid email address.",
    }),
});

export type ValidatedStudentRow = z.infer<typeof StudentRowSchema>;

