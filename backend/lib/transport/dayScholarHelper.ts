import { Prisma } from "@prisma/client";
import {
  RESIDENCE_TYPE_DAYSCHOLAR,
  RESIDENCE_TYPE_HOSTEL,
  isDayScholarStudent,
} from "@/shared/types/transport";

export { RESIDENCE_TYPE_DAYSCHOLAR, RESIDENCE_TYPE_HOSTEL, isDayScholarStudent };

/**
 * Single source of truth for Prisma queries:
 * An active Day Scholar student.
 * Never matches any student with residenceType containing "HOSTEL" or isActive false.
 */
export function getDayScholarWhere(): Prisma.StudentWhereInput {
  return {
    isActive: true,
    OR: [
      { residenceType: { in: ["DAYSCHOLAR", "DAY_SCHOLAR", "Day Scholar", "day scholar", "DAYSCHOLAR "] } },
      { residenceType: null },
      { residenceType: "" },
    ],
    NOT: [
      { residenceType: { in: ["HOSTEL", "HOSTELER", "Hostel", "hostel", "Hosteler", "hosteler", "HOSTEL "] } },
    ],
  };
}

/**
 * Returns Prisma where condition for BusStudent assignments
 * ensuring the assigned student is strictly a valid, active Day Scholar.
 */
export function getDayScholarBusStudentWhere(academicYear?: string): Prisma.BusStudentWhereInput {
  return {
    ...(academicYear ? { academicYear } : {}),
    student: getDayScholarWhere(),
  };
}

