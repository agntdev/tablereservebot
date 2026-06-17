import type { Storage } from "./storage/index.js";
import type { TableAllocation, TableType } from "./storage/types.js";

export type AllocationResult =
  | { success: true; tables: TableAllocation[]; total_seats: number }
  | { success: false; reason: string; available_seats: number; needed_seats: number };

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function timesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  const aS = timeToMinutes(aStart);
  const aE = timeToMinutes(aEnd);
  const bS = timeToMinutes(bStart);
  const bE = timeToMinutes(bEnd);

  const aCrossesMidnight = aE <= aS;
  const bCrossesMidnight = bE <= bS;

  if (aCrossesMidnight && bCrossesMidnight) {
    return true;
  }
  if (aCrossesMidnight) {
    return bE > aS || bS < aE;
  }
  if (bCrossesMidnight) {
    return aE > bS || aS < bE;
  }
  return aS < bE && aE > bS;
}

export async function allocateFirstFit(
  storage: Storage,
  date: string,
  startTime: string,
  endTime: string,
  partySize: number,
): Promise<AllocationResult> {
  const tableTypes = await storage.listTableTypes();
  if (tableTypes.length === 0) {
    return {
      success: false,
      reason: "No table types configured.",
      available_seats: 0,
      needed_seats: partySize,
    };
  }

  const bookings = await storage.listBookingsByDate(date);
  const activeStatuses = new Set(["confirmed", "rescheduled"]);
  const overlapping = bookings.filter(
    (b) =>
      activeStatuses.has(b.status) &&
      timesOverlap(b.start_time, b.end_time, startTime, endTime),
  );

  const allocatedByType = new Map<string, number>();
  for (const b of overlapping) {
    for (const alloc of b.allocated_tables) {
      allocatedByType.set(
        alloc.table_type_id,
        (allocatedByType.get(alloc.table_type_id) ?? 0) + alloc.count,
      );
    }
  }

  const available = tableTypes.map((tt) => ({
    type: tt,
    allocated: allocatedByType.get(tt.id) ?? 0,
    available: Math.max(
      0,
      tt.quantity - (allocatedByType.get(tt.id) ?? 0),
    ),
  }));

  const totalAvailableSeats = available.reduce(
    (sum, a) => sum + a.available * a.type.seat_count,
    0,
  );
  if (totalAvailableSeats < partySize) {
    return {
      success: false,
      reason: "Not enough available seats for this time slot.",
      available_seats: totalAvailableSeats,
      needed_seats: partySize,
    };
  }

  const allocation: TableAllocation[] = [];
  let remaining = partySize;

  for (const av of available) {
    if (remaining <= 0) break;
    if (av.available === 0) continue;

    const tablesToAllocate = Math.min(
      Math.ceil(remaining / av.type.seat_count),
      av.available,
    );

    allocation.push({
      table_type_id: av.type.id,
      count: tablesToAllocate,
    });
    remaining -= tablesToAllocate * av.type.seat_count;
  }

  if (remaining > 0) {
    const totalAllocated = allocation.reduce((sum, a) => {
      const tt = tableTypes.find((t) => t.id === a.table_type_id);
      return sum + (tt ? tt.seat_count * a.count : 0);
    }, 0);
    return {
      success: false,
      reason: "Cannot seat full party with available table configuration.",
      available_seats: totalAllocated,
      needed_seats: partySize,
    };
  }

  const totalSeats = allocation.reduce((sum, a) => {
    const tt = tableTypes.find((t) => t.id === a.table_type_id);
    return sum + (tt ? tt.seat_count * a.count : 0);
  }, 0);

  return { success: true, tables: allocation, total_seats: totalSeats };
}