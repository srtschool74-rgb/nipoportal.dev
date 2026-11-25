import { prisma } from "@/backend/db/prisma";
import { getDayScholarWhere } from "@/backend/lib/transport/dayScholarHelper";
import { computeBusSeatMetrics } from "./transportMetrics";
import { withShortStatsCache } from "./cache";
import { BusFleetSummary } from "./types";

export { computeBusSeatMetrics };

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
