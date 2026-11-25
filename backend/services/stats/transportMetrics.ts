import { roundOneDecimal } from "./academics";

/**
 * Computes Bus capacity, assigned Day Scholars, available seats, and occupancy.
 * Strictly includes only active Day Scholars (never HOSTEL or inactive students).
 * Safe to import from both Client Components and Server Components.
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
