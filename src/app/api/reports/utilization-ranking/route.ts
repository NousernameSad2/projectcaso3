import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { parseISO, isValid, differenceInHours } from 'date-fns';
import { BorrowStatus, EquipmentStatus, type Prisma } from '@prisma/client';

const UtilizationRankingQuerySchema = z.object({
    startDate: z.string().optional().refine(val => !val || isValid(parseISO(val)), { message: "Invalid start date format" }),
    endDate: z.string().optional().refine(val => !val || isValid(parseISO(val)), { message: "Invalid end date format" }),
});

interface EquipmentContactHours {
    equipmentId: string;
    name: string;
    totalContactHours: number;
    borrowCount: number; // Added borrow count as an additional useful metric
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const queryParseResult = UtilizationRankingQuerySchema.safeParse(Object.fromEntries(searchParams));

    if (!queryParseResult.success) {
        return NextResponse.json({ error: 'Invalid query parameters', details: queryParseResult.error.flatten() }, { status: 400 });
    }

    const { startDate, endDate } = queryParseResult.data;

    try {
        // 1. Fetch all relevant equipment (e.g., not archived or out_of_commission permanently)
        const allEquipment = await prisma.equipment.findMany({
            where: {
                status: { 
                    notIn: [EquipmentStatus.ARCHIVED, EquipmentStatus.OUT_OF_COMMISSION] 
                }
            },
            select: {
                id: true,
                name: true,
            }
        });

        const equipmentContactHoursList: EquipmentContactHours[] = [];

        // 2. For each equipment, calculate its contact hours within the date range
        for (const equip of allEquipment) {
            const borrowWhereClause: Prisma.BorrowWhereInput = {
                equipmentId: equip.id,
                checkoutTime: { not: null },
                actualReturnTime: { not: null },
                borrowStatus: { in: [BorrowStatus.COMPLETED, BorrowStatus.RETURNED, BorrowStatus.OVERDUE] }
            };

            if (startDate && endDate) {
                borrowWhereClause.AND = [
                    { checkoutTime: { gte: parseISO(startDate) } },
                    { actualReturnTime: { lte: parseISO(endDate) } },
                ];
            } else if (startDate) {
                borrowWhereClause.checkoutTime = { gte: parseISO(startDate) };
            } else if (endDate) {
                borrowWhereClause.actualReturnTime = { lte: parseISO(endDate) };
            }

            const borrows = await prisma.borrow.findMany({
                where: borrowWhereClause,
                select: {
                    checkoutTime: true,
                    actualReturnTime: true,
                }
            });

            let totalHours = 0;
            for (const borrow of borrows) {
                if (borrow.checkoutTime && borrow.actualReturnTime) { // Should always be true due to query
                    totalHours += differenceInHours(borrow.actualReturnTime, borrow.checkoutTime);
                }
            }
            equipmentContactHoursList.push({
                equipmentId: equip.id,
                name: equip.name,
                totalContactHours: totalHours,
                borrowCount: borrows.length
            });
        }

        // 3. Sort the list by totalContactHours descending
        equipmentContactHoursList.sort((a, b) => b.totalContactHours - a.totalContactHours);

        return NextResponse.json(equipmentContactHoursList);

    } catch (error) {
        console.error('[API_UTILIZATION_RANKING_GET]', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
} 