import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { parseISO, isValid, differenceInHours } from 'date-fns';
import { BorrowStatus } from '@prisma/client';

const ContactHoursQuerySchema = z.object({
    equipmentId: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).describe("Can be a single ID or an array of IDs"),
    startDate: z.string().refine(val => isValid(parseISO(val)), { message: "Invalid start date format" }),
    endDate: z.string().refine(val => isValid(parseISO(val)), { message: "Invalid end date format" }),
});

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);

    // Get all equipmentId parameters
    const equipmentIdParams = searchParams.getAll('equipmentId');

    const queryData = {
        equipmentId: equipmentIdParams.length === 1 ? equipmentIdParams[0] : equipmentIdParams,
        startDate: searchParams.get('startDate'),
        endDate: searchParams.get('endDate'),
    };

    const queryParseResult = ContactHoursQuerySchema.safeParse(queryData);

    if (!queryParseResult.success) {
        return NextResponse.json({ error: 'Invalid query parameters', details: queryParseResult.error.flatten() }, { status: 400 });
    }

    const { equipmentId, startDate, endDate } = queryParseResult.data;
    const equipmentIds = Array.isArray(equipmentId) ? equipmentId : [equipmentId];

    try {
        const borrows = await prisma.borrow.findMany({
            where: {
                equipmentId: {
                    in: equipmentIds,
                },
                checkoutTime: {
                    gte: parseISO(startDate),
                },
                actualReturnTime: {
                    lte: parseISO(endDate),
                },
                // Only include borrows that have actually been checked out and returned
                // and are in a state that implies usage.
                borrowStatus: {
                    in: [BorrowStatus.COMPLETED, BorrowStatus.RETURNED, BorrowStatus.OVERDUE]
                },
                AND: [
                    { checkoutTime: { not: null } },
                    { actualReturnTime: { not: null } },
                ]
            },
            select: {
                checkoutTime: true,
                actualReturnTime: true,
            }
        });

        let totalContactHours = 0;
        for (const borrow of borrows) {
            // Ensure both dates are present, though the query should already handle this
            if (borrow.checkoutTime && borrow.actualReturnTime) {
                totalContactHours += differenceInHours(borrow.actualReturnTime, borrow.checkoutTime);
            }
        }

        return NextResponse.json({ equipmentIds, startDate, endDate, totalContactHours });

    } catch (error) {
        console.error('[API_CALCULATE_CONTACT_HOURS_GET]', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
} 