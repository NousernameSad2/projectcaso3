import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { parseISO, isValid, differenceInHours } from 'date-fns';
import { BorrowStatus } from '@prisma/client';

const ContactHoursQuerySchema = z.object({
    equipmentId: z.string().min(1, { message: "Equipment ID is required" }),
    startDate: z.string().refine(val => isValid(parseISO(val)), { message: "Invalid start date format" }),
    endDate: z.string().refine(val => isValid(parseISO(val)), { message: "Invalid end date format" }),
});

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);

    const queryParseResult = ContactHoursQuerySchema.safeParse(Object.fromEntries(searchParams));

    if (!queryParseResult.success) {
        return NextResponse.json({ error: 'Invalid query parameters', details: queryParseResult.error.flatten() }, { status: 400 });
    }

    const { equipmentId, startDate, endDate } = queryParseResult.data;

    try {
        const borrows = await prisma.borrow.findMany({
            where: {
                equipmentId: equipmentId,
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

        return NextResponse.json({ equipmentId, startDate, endDate, totalContactHours });

    } catch (error) {
        console.error('[API_CALCULATE_CONTACT_HOURS_GET]', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
} 