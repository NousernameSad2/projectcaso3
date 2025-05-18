import { NextResponse } from 'next/server';
import { PrismaClient, EquipmentStatus } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

const prisma = new PrismaClient();

// Define the expected structure of an item in maintenanceLog
interface MaintenanceLogEntry {
    timestamp: string; // ISO date string
    notes?: string;
    user?: string;
    type?: string; // e.g., 'MAINTENANCE', 'DEFECT_REPORTED', 'OUT_OF_COMMISSION_START'
    // Potentially other fields if they signify an end or resolution within the log itself
    resolvedTimestamp?: string; 
    status?: string; // Could indicate 'RESOLVED' or 'ENDED'
}

// Define the expected structure of an item in editHistory
interface EditHistoryEntry {
    timestamp: string; // ISO date string
    user?: string;
    changes: Array<{
        field: string;
        oldValue: any; // Kept as any to match Prisma JsonValue flexibility initially
        newValue: any; // Kept as any for the same reason
    }>;
    // Simpler alternative if editHistory stores full snapshots:
    // snapshot?: Partial<Equipment>; // If it stores snapshots of the equipment state
}


export async function GET(request: Request) {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || (session.user.role !== 'STAFF' && session.user.role !== 'FACULTY')) {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
        const equipmentList = await prisma.equipment.findMany({
            where: {
                // Potentially filter out archived equipment unless explicitly requested
                // status: { not: EquipmentStatus.ARCHIVED } 
            },
            select: {
                id: true,
                name: true,
                equipmentId: true,
                status: true,
                maintenanceLog: true,
                editHistory: true,
            }
        });

        const availabilityMetrics = equipmentList.map(equipment => {
            let totalUnavailabilitySeconds = 0;
            const unavailableStatuses: EquipmentStatus[] = [
                EquipmentStatus.UNDER_MAINTENANCE,
                EquipmentStatus.DEFECTIVE,
                EquipmentStatus.OUT_OF_COMMISSION,
            ];

            // Assuming maintenanceLog entries mark the START of an unavailability period
            // And their 'type' or presence signifies the equipment became unavailable.
            const typedMaintenanceLog = (equipment.maintenanceLog || []) as unknown as MaintenanceLogEntry[];
            const typedEditHistory = (equipment.editHistory || []) as unknown as EditHistoryEntry[];

            // Sort logs and history by timestamp to process chronologically
            typedMaintenanceLog.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            typedEditHistory.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

            for (const logEntry of typedMaintenanceLog) {
                // This logic assumes a log entry in maintenanceLog signifies the START of unavailability.
                // We need a clear rule, e.g. entry.type === 'MAINTENANCE_START' or specific statuses.
                // For now, let's assume any entry in maintenanceLog that corresponds to an unavailable state starts a period.
                // This needs to be robust based on how maintenanceLog is actually populated.
                // The example from equipment/[id]/route.ts only adds to maintenanceLog when status becomes UNDER_MAINTENANCE.
                
                // Let's assume a log entry means it became unavailable at logEntry.timestamp
                const unavailabilityStartTime = new Date(logEntry.timestamp);
                let unavailabilityEndTime: Date | null = null;

                // 1. Check for an explicit resolution within the maintenance log system itself (if applicable)
                if (logEntry.resolvedTimestamp || logEntry.status === 'RESOLVED') {
                    unavailabilityEndTime = new Date(logEntry.resolvedTimestamp || logEntry.timestamp); // Fallback, though unlikely
                } else {
                    // 2. If not resolved in log, search editHistory for the next operational status change
                    const resolvingEdit = typedEditHistory.find(edit => {
                        if (new Date(edit.timestamp).getTime() <= unavailabilityStartTime.getTime()) {
                            return false; // Edit is before or at the same time as maintenance start
                        }
                        // Assuming 'changes' array exists and has the specified structure
                        if (edit.changes && Array.isArray(edit.changes)) {
                             const statusChange = edit.changes.find(ch => {
                                if (ch.field === 'status') {
                                    const oldStatus = ch.oldValue as EquipmentStatus;
                                    const newStatus = ch.newValue as EquipmentStatus;
                                    // Check if oldStatus was one of the defined unavailable statuses
                                    const wasUnavailable = unavailableStatuses.some(s => s === oldStatus);
                                    // Check if newStatus is NOT one of the defined unavailable statuses (i.e., became operational)
                                    const isNowOperational = !unavailableStatuses.some(s => s === newStatus);
                                    return wasUnavailable && isNowOperational;
                                }
                                return false;
                            });
                            return !!statusChange;
                        }
                        // Fallback for simpler editHistory structures (e.g. full snapshots)
                        // else if (edit.snapshot && edit.snapshot.status && !unavailableStatuses.includes(edit.snapshot.status)) {
                        //    // This needs a way to know the *previous* status from the snapshot before this one.
                        //    // This simple check is not enough without knowing the prior state.
                        // }
                        return false;
                    });

                    if (resolvingEdit) {
                        unavailabilityEndTime = new Date(resolvingEdit.timestamp);
                    }
                }
                
                // 3. If still no end time, and current status is unavailable, it's ongoing (ends "now")
                if (!unavailabilityEndTime && unavailableStatuses.some(s => s === equipment.status)) {
                    unavailabilityEndTime = new Date(); // Ongoing, calculate duration until now
                }

                // 4. If an end time was found, calculate duration
                if (unavailabilityEndTime && unavailabilityEndTime.getTime() > unavailabilityStartTime.getTime()) {
                    totalUnavailabilitySeconds += (unavailabilityEndTime.getTime() - unavailabilityStartTime.getTime()) / 1000;
                }
            }

            return {
                id: equipment.id,
                name: equipment.name,
                equipmentId: equipment.equipmentId,
                currentStatus: equipment.status,
                totalUnavailabilitySeconds,
                // Convert to hours or days for better readability if needed
                totalUnavailabilityHours: parseFloat((totalUnavailabilitySeconds / 3600).toFixed(2)),
            };
        });

        // Sort by total unavailability descending
        availabilityMetrics.sort((a, b) => b.totalUnavailabilitySeconds - a.totalUnavailabilitySeconds);

        return NextResponse.json(availabilityMetrics, { status: 200 });

    } catch (error) {
        console.error('Error fetching availability metrics:', error);
        // It's good to check if error is an instance of Error to access message property
        const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
        return NextResponse.json({ message: 'Failed to calculate availability metrics.', error: errorMessage }, { status: 500 });
    }
} 