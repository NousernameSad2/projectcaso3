import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Equipment } from '@prisma/client';
import { differenceInMilliseconds } from 'date-fns';

// Define the structure expected within the maintenanceLog JSON array
interface MaintenanceLogEntry {
  startDate?: string | Date;
  endDate?: string | Date;
  // other fields might exist but are not needed for MTTR
}

// Define the structure of the API response
interface EquipmentMaintenanceStats {
  equipmentId: string;
  equipmentName: string;
  mttrHours: number | null; // Null if no valid maintenance periods found
  totalMaintenanceHours: number; // Total hours calculated from logs
}

export async function GET() {
  try {
    const equipmentList = await prisma.equipment.findMany({
      select: {
        id: true,
        name: true,
        maintenanceLog: true, // Fetch the JSON log
      },
    });

    const results: EquipmentMaintenanceStats[] = [];

    for (const equipment of equipmentList) {
      let totalRepairMillis = 0;
      let validRepairCount = 0;
      let totalMaintenanceMillis = 0; // Accumulator for total maintenance time

      // Ensure maintenanceLog is an array and not null
      if (Array.isArray(equipment.maintenanceLog)) {
        for (const log of equipment.maintenanceLog) {
          // Type guard to check if log is an object
          if (log && typeof log === 'object') {
            const entry = log as MaintenanceLogEntry; // Cast to our expected interface

            // Check for valid start and end dates for MTTR and total time
            if (entry.startDate && entry.endDate) {
              try {
                const startDate = new Date(entry.startDate);
                const endDate = new Date(entry.endDate);

                if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime()) && endDate >= startDate) {
                    const durationMillis = differenceInMilliseconds(endDate, startDate);
                    // Add to both MTTR calculation and total maintenance time
                    totalRepairMillis += durationMillis;
                    totalMaintenanceMillis += durationMillis;
                    validRepairCount++;
                }
              } catch (dateError) {
                console.warn(`Could not parse dates in maintenance log for equipment ${equipment.id}:`, entry, dateError);
              }
            }
             // OPTIONAL: Could also add time for entries with only a start date 
             // assuming they are ongoing, but this adds complexity.
          }
        }
      }

      let mttrHours: number | null = null;
      if (validRepairCount > 0) {
        const avgMillis = totalRepairMillis / validRepairCount;
        mttrHours = parseFloat((avgMillis / (1000 * 60 * 60)).toFixed(1)); // MTTR hours
      }
      
      const totalMaintenanceHours = parseFloat((totalMaintenanceMillis / (1000 * 60 * 60)).toFixed(1)); // Total hours

      results.push({
        equipmentId: equipment.id,
        equipmentName: equipment.name,
        mttrHours: mttrHours,
        totalMaintenanceHours: totalMaintenanceHours,
      });
    }

    return NextResponse.json(results);

  } catch (error) {
    console.error('[API_REPORTS_MTTR_GET]', error);
    // Differentiate between known errors (like JSON parsing) and unexpected ones if needed
    return new NextResponse('Internal Server Error', { status: 500 });
  }
} 