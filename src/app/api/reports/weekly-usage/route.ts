import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { BorrowStatus } from '@prisma/client';
import { startOfDay, endOfDay, subDays, format, getDay } from 'date-fns';

// Helper type for chart data
interface DailyUsage {
  name: string; // Day name (e.g., 'Mon')
  hours: number;
}

export async function GET() {
  try {
    const today = new Date();
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weeklyUsage: DailyUsage[] = [];

    // Initialize usage data for the last 7 days (today + previous 6)
    for (let i = 6; i >= 0; i--) {
      const date = subDays(today, i);
      const dayName = daysOfWeek[getDay(date)];
      weeklyUsage.push({ name: dayName, hours: 0 });
    }

    // Get borrows that ended within the last 7 days
    const startDate = startOfDay(subDays(today, 6)); // Start of 7 days ago
    const endDate = endOfDay(today); // End of today

    const completedBorrows = await prisma.borrow.findMany({
      where: {
        borrowStatus: {
          in: [BorrowStatus.COMPLETED, BorrowStatus.RETURNED],
        },
        checkoutTime: { not: null },
        actualReturnTime: {
          gte: startDate, // Returned on or after the start date
          lte: endDate,   // Returned on or before the end date
        },
      },
      select: {
        checkoutTime: true,
        actualReturnTime: true,
      },
    });

    // Calculate total hours per day
    completedBorrows.forEach((borrow) => {
      if (borrow.actualReturnTime && borrow.checkoutTime) {
        const returnDayIndex = getDay(borrow.actualReturnTime); // 0 (Sun) to 6 (Sat)
        const durationMillis = borrow.actualReturnTime.getTime() - borrow.checkoutTime.getTime();
        const durationHours = durationMillis / (1000 * 60 * 60);

        // Find the corresponding day in our weeklyUsage array
        // This mapping assumes the loop creating weeklyUsage and getDay() are consistent
        const targetDay = weeklyUsage.find(day => day.name === daysOfWeek[returnDayIndex]);
        if (targetDay) {
           // Find the index based on how many days ago it was
           const daysAgo = Math.floor((today.getTime() - startOfDay(borrow.actualReturnTime).getTime()) / (1000 * 60 * 60 * 24));
           const targetIndex = 6 - daysAgo; // Map daysAgo (0=today, 6=7 days ago) to array index

           if (targetIndex >= 0 && targetIndex < weeklyUsage.length) {
               weeklyUsage[targetIndex].hours += durationHours;
           } else {
               console.warn("Could not map borrow return date to weekly usage index:", borrow.actualReturnTime);
           }
        }
      }
    });
    
     // Round hours to 1 decimal place for cleaner display
    const formattedUsage = weeklyUsage.map(day => ({
        ...day,
        hours: parseFloat(day.hours.toFixed(1)),
    }));

    return NextResponse.json(formattedUsage);

  } catch (error) {
    console.error('[API_REPORTS_WEEKLY_USAGE_GET]', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
} 