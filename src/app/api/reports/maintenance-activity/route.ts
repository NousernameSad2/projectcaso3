import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { EquipmentStatus, type Prisma } from '@prisma/client'; // Import EquipmentStatus and Prisma
import { differenceInHours, parseISO, isValid, isDate } from 'date-fns';

// Expected structure from maintenanceLog JSON array
interface LogEntry {
  timestamp: string | Date; // Maintenance start timestamp
  notes?: string;
  user?: string;
  type?: string; // e.g., 'MAINTENANCE', 'DEFECT_REPORTED'
  // An 'endDate' or 'resolvedTimestamp' directly in the log entry would take precedence if present
  endDate?: string | Date;
  resolvedTimestamp?: string;
  statusWithinLog?: string; // e.g. 'RESOLVED' within the log entry itself
}

// Expected structure from editHistory JSON array
interface EditHistoryItem {
    timestamp: string; // ISO date string
    user?: string;
    changes: Array<{
        field: string;
        oldValue: Prisma.JsonValue;
        newValue: Prisma.JsonValue;
    }>;
}

interface MaintenanceActivity {
  equipmentId: string;
  equipmentName: string;
  equipmentIdentifier: string | null; 
  maintenanceStartDate: string;
  maintenanceNotes: string | null;
  initiatedBy: string | null;
  maintenanceEndDate: string | null;
  durationHours: number | null;
  status: 'Ongoing' | 'Completed';
}

// Define which statuses are considered "unavailable" for maintenance purposes
const UNAVAILABLE_STATUSES: EquipmentStatus[] = [
    EquipmentStatus.UNDER_MAINTENANCE,
    EquipmentStatus.DEFECTIVE,
    EquipmentStatus.OUT_OF_COMMISSION,
];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const equipmentIdFilter = searchParams.get('equipmentId');
    const startDateFilterStr = searchParams.get('startDate');
    const endDateFilterStr = searchParams.get('endDate');

    const equipmentList = await prisma.equipment.findMany({
      where: {
        id: equipmentIdFilter ? equipmentIdFilter : undefined,
      },
      select: {
        id: true,
        name: true,
        equipmentId: true, 
        status: true, // Current status of the equipment
        maintenanceLog: true,
        editHistory: true, // Fetch editHistory
        updatedAt: true, // Fetch equipment.updatedAt
      },
      orderBy: {
        name: 'asc',
      }
    });

    const results: MaintenanceActivity[] = [];

    for (const equipment of equipmentList) {
      const typedMaintenanceLog = (equipment.maintenanceLog || []) as unknown as LogEntry[];
      const typedEditHistory = (equipment.editHistory || []) as unknown as EditHistoryItem[];

      // Sort edit history for chronological processing
      typedEditHistory.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      // Sort maintenance log chronologically AS WELL - THIS IS CRUCIAL
      typedMaintenanceLog.sort((a, b) => {
        const dateA = parseISO(a.timestamp as string);
        const dateB = parseISO(b.timestamp as string);
        if (!isValid(dateA) || !isValid(dateB)) return 0; // Should not happen with prior checks
        return dateA.getTime() - dateB.getTime();
      });

      for (let i = 0; i < typedMaintenanceLog.length; i++) {
        const log = typedMaintenanceLog[i];
        if (!log.timestamp) continue; 

        const maintenanceStartDate = parseISO(log.timestamp as string);
        if (!isValid(maintenanceStartDate)) {
            console.warn(`Invalid maintenance start date for equipment ${equipment.id}: ${log.timestamp}`);
            continue;
        }

        // Apply date range filters for maintenance start date
        if (startDateFilterStr && maintenanceStartDate < parseISO(startDateFilterStr)) {
          continue;
        }
        if (endDateFilterStr && maintenanceStartDate > parseISO(endDateFilterStr)) {
          continue;
        }

        let determinedMaintenanceEndDate: Date | null = null;
        let determinedStatus: 'Ongoing' | 'Completed' = 'Ongoing';

        // 1. Check for explicit resolution within the log entry itself
        const explicitEndDateStr = log.endDate || log.resolvedTimestamp;
        if (explicitEndDateStr) {
            const parsedExplicitEndDate = parseISO(explicitEndDateStr as string);
            if (isValid(parsedExplicitEndDate) && parsedExplicitEndDate >= maintenanceStartDate) {
                determinedMaintenanceEndDate = parsedExplicitEndDate;
                determinedStatus = 'Completed';
            }
        } else if (log.statusWithinLog === 'RESOLVED') {
             determinedStatus = 'Completed'; 
             // If resolved but no explicit end date, assume it ended at start or shortly after.
             // For duration calculation, if determinedMaintenanceEndDate is null, it might appear as 0 or ongoing.
             // Consider setting determinedMaintenanceEndDate = maintenanceStartDate if appropriate for 0-duration completed tasks.
        }

        // 2. If not explicitly resolved in log, search editHistory for a status change to operational
        //    within the correct window (before the next maintenance log entry, if any).
        if (determinedStatus === 'Ongoing') {
            const nextMaintenanceLogEntry = typedMaintenanceLog[i + 1];
            const windowEndTime = nextMaintenanceLogEntry ? parseISO(nextMaintenanceLogEntry.timestamp as string) : null;

            const resolvingEdit = typedEditHistory.find(edit => {
                const editTimestamp = new Date(edit.timestamp);
                if (editTimestamp.getTime() <= maintenanceStartDate.getTime()) {
                    return false; // Edit is before or at the same time as current maintenance start
                }
                // If there's a next maintenance log, the resolving edit must be BEFORE it starts
                if (windowEndTime && isValid(windowEndTime) && editTimestamp.getTime() >= windowEndTime.getTime()) {
                    return false;
                }

                if (edit.changes && Array.isArray(edit.changes)) {
                    const statusChange = edit.changes.find(ch => {
                        if (ch.field === 'status') {
                            const oldStatus = ch.oldValue as EquipmentStatus;
                            const newStatus = ch.newValue as EquipmentStatus;
                            return UNAVAILABLE_STATUSES.some(s => s === oldStatus) && 
                                   !UNAVAILABLE_STATUSES.some(s => s === newStatus);
                        }
                        return false;
                    });
                    return !!statusChange;
                }
                return false;
            });

            if (resolvingEdit) {
                determinedMaintenanceEndDate = new Date(resolvingEdit.timestamp);
                determinedStatus = 'Completed';
            } else {
                // 3. If no resolving edit found within the window, check if this period was superseded by the next log
                if (windowEndTime && isValid(windowEndTime)) {
                    // This maintenance period is considered completed (superseded) when the next one started.
                    determinedMaintenanceEndDate = windowEndTime; 
                    determinedStatus = 'Completed';
                } else if (!nextMaintenanceLogEntry) {
                    // This is the LATEST maintenance log entry for this equipment.
                    // Its status depends on the current equipment status.
                    if (!UNAVAILABLE_STATUSES.some(s => s === equipment.status)) {
                        // Current equipment status is OPERATIONAL, so this last maintenance is completed.
                        determinedStatus = 'Completed';
                        // Use equipment.updatedAt as a fallback end date if it's valid and after start.
                        if (equipment.updatedAt && isDate(equipment.updatedAt)) {
                           const potentialEndDate = new Date(equipment.updatedAt);
                           if (potentialEndDate > maintenanceStartDate) {
                               determinedMaintenanceEndDate = potentialEndDate;
                           }
                        } // If no valid equipment.updatedAt, endDate remains null, but status is Completed.
                    } else {
                        // Current equipment status is UNAVAILABLE, so this last maintenance is genuinely Ongoing.
                        determinedStatus = 'Ongoing'; // Already default, but explicit.
                        determinedMaintenanceEndDate = null; // Explicitly null for ongoing.
                    }
                }
                // If there's no nextMaintenanceLogEntry and equipment.status is unavailable, it remains 'Ongoing' (default)
            }
        }
        

        let durationHours: number | null = null;
        if (determinedMaintenanceEndDate && isValid(determinedMaintenanceEndDate) && determinedMaintenanceEndDate > maintenanceStartDate) {
            durationHours = differenceInHours(determinedMaintenanceEndDate, maintenanceStartDate);
        }

        results.push({
          equipmentId: equipment.id,
          equipmentName: equipment.name,
          equipmentIdentifier: equipment.equipmentId,
          maintenanceStartDate: maintenanceStartDate.toISOString(),
          maintenanceNotes: log.notes || null,
          initiatedBy: log.user || null,
          maintenanceEndDate: determinedMaintenanceEndDate ? determinedMaintenanceEndDate.toISOString() : null,
          durationHours: durationHours,
          status: determinedStatus,
        });
      }
    }

    results.sort((a, b) => parseISO(b.maintenanceStartDate).getTime() - parseISO(a.maintenanceStartDate).getTime());
    return NextResponse.json(results);

  } catch (error) {
    console.error('[API_REPORTS_MAINTENANCE_ACTIVITY_GET]', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return new NextResponse(message, { status: 500 });
  }
} 