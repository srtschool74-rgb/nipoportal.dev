import { prisma } from "@/backend/db/prisma";
import { getDayScholarWhere } from "@/backend/lib/transport/dayScholarHelper";
import { roundOneDecimal } from "./academics";
import { withShortStatsCache } from "./cache";
import { BusFleetSummary } from "./types";

/**
 * Computes Bus capacity, assigned Day Scholars, available seats, and occupancy.
 * Strictly includes only active Day Scholars (never HOSTEL or inactive students).
 */
export function computeBusSeatMetrics(capacity: number, assignedDayScholars: number): {
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
 * Single Source of Truth: Fleet-wide Transport & Day-Scholar summary from DB aggregates.
 */
export async function getTransportFleetSummary(academicYear?: string): Promise<BusFleetSummary> {
  const key = `transport:${academicYear || "current"}`;

  return withShortStatsCache(key, async () => {
    const dayScholarWhere = getDayScholarWhere();
    const assignmentScope = {
      ...(academicYear ? { academicYear } : {}),
      bus: { isActive: true },
    };

    const [
      totalBuses,
      runningBuses,
      issuesBuses,
      capacityAgg,
      totalAssignedDayScholars,
      totalDayScholars,
      dayScholarsOnBuses,
      dayScholarsUnassigned,
    ] = await prisma.$transaction([
      prisma.bus.count({ where: { isActive: true } }),
      prisma.bus.count({ where: { isActive: true, status: "RUNNING" } }),
      prisma.bus.count({
        where: {
          isActive: true,
          status: { in: ["DELAYED", "MAINTENANCE", "NOT_RUNNING"] },
        },
      }),
      prisma.bus.aggregate({
        where: { isActive: true },
        _sum: { capacity: true },
      }),
      prisma.busStudent.count({
        where: {
          ...(academicYear ? { academicYear } : {}),
          bus: { isActive: true },
          student: dayScholarWhere,
        },
      }),
      prisma.student.count({ where: dayScholarWhere }),
      prisma.student.count({
        where: {
          ...dayScholarWhere,
          busAssignments: { some: assignmentScope },
        },
      }),
      prisma.student.count({
        where: {
          ...dayScholarWhere,
          busAssignments: { none: assignmentScope },
        },
      }),
    ]);

    const totalCapacity = Math.max(0, capacityAgg._sum.capacity || 0);
    const seatMetrics = computeBusSeatMetrics(totalCapacity, totalAssignedDayScholars);

    return {
      totalBuses,
      runningBuses,
      issuesBuses,
      totalCapacity: seatMetrics.capacity,
      totalAssignedDayScholars: seatMetrics.assigned,
      totalAvailableSeats: seatMetrics.availableSeats,
      fleetOccupancyPercentage: seatMetrics.occupancyPercentage,
      totalDayScholars,
      dayScholarsOnBuses,
      dayScholarsUnassigned,
    };
  });
}
