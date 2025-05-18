import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { BorrowStatus } from '@prisma/client';
import { startOfDay, addMonths, eachDayOfInterval } from 'date-fns';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";

// GET: Fetch booking date ranges for a specific piece of equipment
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    // Optional: Add authentication if booking info shouldn't be public
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ message: 'Authentication required' }, { status: 401 });
    }
    const params = await context.params;
    const equipmentId = params.id;

    if (!equipmentId) {
        return NextResponse.json({ message: 'Equipment ID is required' }, { status: 400 });
    }

    try {
        // 1. Get Equipment Stock Count
        const equipment = await prisma.equipment.findUnique({
            where: { id: equipmentId },
            select: { stockCount: true }
        });

        if (!equipment) {
            return NextResponse.json({ message: `Equipment with ID ${equipmentId} not found` }, { status: 404 });
        }

        const stockCount = equipment.stockCount;
        if (stockCount <= 0) {
            // If stock is 0, all future dates could be considered unavailable within a range
            // For simplicity, let's return an empty array, the frontend might handle 0 stock separately
            return NextResponse.json([]); 
        }

        // 2. Define date range for checking availability (e.g., today to 3 months ahead)
        const today = startOfDay(new Date());
        const endDateLimit = addMonths(today, 3); // Check 3 months into the future

        // 3. Find relevant borrows within the broad date range
        const relevantStatuses: BorrowStatus[] = [
            // BorrowStatus.PENDING, // Pending reservations don't consume stock
            BorrowStatus.APPROVED,
            BorrowStatus.ACTIVE, // Active means checked out
        ];

        const relevantBorrows = await prisma.borrow.findMany({
            where: {
                equipmentId: equipmentId,
                borrowStatus: { in: relevantStatuses },
                // Filter borrows that *could* overlap with our check range
                OR: [
                    // Use approved times if available, otherwise requested times
                    { approvedStartTime: { lte: endDateLimit } },
                    { approvedStartTime: null, requestedStartTime: { lte: endDateLimit } }, 
                    { approvedEndTime: { gte: today } },
                    { approvedEndTime: null, requestedEndTime: { gte: today } },
                ]
            },
            select: {
                // Select both sets of times to determine the actual interval
                requestedStartTime: true,
                requestedEndTime: true,
                approvedStartTime: true,
                approvedEndTime: true,
            },
        });

        // Convert dates to Date objects, prioritizing approved times
        const borrowIntervals = relevantBorrows.map(b => {
            const start = b.approvedStartTime ?? b.requestedStartTime;
            const end = b.approvedEndTime ?? b.requestedEndTime;
            return {
                start: startOfDay(new Date(start)),
                end: startOfDay(new Date(end))
            }
        }).filter(interval => !isNaN(interval.start.getTime()) && !isNaN(interval.end.getTime()));

        // 4. Calculate unavailable dates
        const unavailableDates: string[] = []; // Store as ISO strings (YYYY-MM-DD)
        const daysToCheck = eachDayOfInterval({ start: today, end: endDateLimit });

        for (const day of daysToCheck) {
            let overlappingCount = 0;
            for (const interval of borrowIntervals) {
                 // Check if 'day' falls within the borrow interval (inclusive start, exclusive end assumed by isWithinInterval)
                 // We want inclusive end, so check day >= start and day <= end
                 if (day >= interval.start && day <= interval.end) {
                     overlappingCount++;
                 }
            }

            if (overlappingCount >= stockCount) {
                unavailableDates.push(day.toISOString().split('T')[0]); // Add YYYY-MM-DD
            }
        }

        // 5. Return the list of unavailable date strings
        return NextResponse.json(unavailableDates);

    } catch (error) {
        console.error(`API Error - GET /api/equipment/${equipmentId}/bookings:`, error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
} 