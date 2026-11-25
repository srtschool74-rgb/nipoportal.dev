/**
 * Pure transport types, constants, and math calculations with ZERO server dependencies.
 * Safe to import from both Client Components and Server Components.
 */

import { roundOneDecimal } from "./academics";

export const RESIDENCE_TYPE_DAYSCHOLAR = "DAYSCHOLAR";
export const RESIDENCE_TYPE_HOSTEL = "HOSTEL";

export interface BusFleetSummary {
  totalBuses: number;
  runningBuses: number;
  issuesBuses: number;
  totalCapacity: number;
  totalAssignedDayScholars: number;
  totalAvailableSeats: number;
  fleetOccupancyPercentage: number;
  totalDayScholars: number;
  dayScholarsOnBuses: number;
  dayScholarsUnassigned: number;
}

export interface TransportSummaryMetrics {
  totalBuses: number;
  runningBuses: number;
  issuesBuses: number;
  totalCapacity?: number;
  totalAssignedDayScholars?: number;
  totalAvailableSeats?: number;
  fleetOccupancyPercentage?: number;
  totalDayScholars: number;
  dayScholarsOnBuses: number;
  dayScholarsUnassigned: number;
}



/**
 * Computes Bus capacity, assigned Day Scholars, available seats, and occupancy.
 * Strictly includes only active Day Scholars (never HOSTEL or inactive students).
 */
export function computeBusSeatMetrics(
  capacity: number,
  assignedDayScholars: number
): {
  capacity: number;
  assigned: number;
  availableSeats: number;
  occupancyPercentage: number;
} {
  const safeCap = Math.max(0, Number(capacity) || 0);
  const safeAssigned = Math.max(0, Number(assignedDayScholars) || 0);
  const availableSeats = Math.max(0, safeCap - safeAssigned);
  const occupancyPercentage =
    safeCap > 0 ? Math.min(100, roundOneDecimal((safeAssigned / safeCap) * 100)) : 0;

  return {
    capacity: safeCap,
    assigned: safeAssigned,
    availableSeats,
    occupancyPercentage,
  };
}

/**
 * Synchronous validation helper for student objects.
 * Strictly guarantees that hostel students are NEVER treated as day scholars.
 */
export function isDayScholarStudent(student?: {
  residenceType?: string | null;
  isActive?: boolean | null;
} | null): boolean {
  if (!student) return false;
  if (student.isActive === false) return false;
  if (!student.residenceType || student.residenceType.trim() === "") return true; // defaults to DAYSCHOLAR
  const val = String(student.residenceType).trim().toUpperCase();
  if (val.includes("HOSTEL")) return false;
  return val.includes("DAY") || val === RESIDENCE_TYPE_DAYSCHOLAR;
}
