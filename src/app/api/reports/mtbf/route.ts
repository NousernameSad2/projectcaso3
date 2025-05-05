import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { DeficiencyType, Prisma } from '@prisma/client';
import { differenceInMilliseconds } from 'date-fns';

// Define the structure of the API response (User-based MTBF)
interface UserMtbf {
  userId: string;
  userName: string;
  mtbfHours: number | null; // Null if < 2 mishandles for the user
}

// Define the expected payload structure from the Prisma query
const deficiencyWithUser = Prisma.validator<Prisma.DeficiencyDefaultArgs>()({
  include: {
    user: { select: { name: true } } // Include user name
  }
});
type DeficiencyWithUser = Prisma.DeficiencyGetPayload<typeof deficiencyWithUser>;

export async function GET() {
  try {
    // 1. Fetch all MISHANDLING deficiencies with related user info
    const mishandlings = await prisma.deficiency.findMany({
      where: {
        type: DeficiencyType.MISHANDLING,
      },
      include: {
        user: { select: { name: true } } // Select user name for the report
      },
      orderBy: [
        // Correct syntax: array of order objects
        { userId: 'asc' }, 
        { createdAt: 'asc' },
      ],
    });

    // 2. Group deficiencies by User ID
    const userDeficiencies: { [key: string]: DeficiencyWithUser[] } = {};
    for (const deficiency of mishandlings) {
      const userId = deficiency.userId;
      if (!userDeficiencies[userId]) {
        userDeficiencies[userId] = [];
      }
      userDeficiencies[userId].push(deficiency);
    }

    const mtbfResults: UserMtbf[] = [];

    // 3. Calculate MTBF for each user group
    for (const userId in userDeficiencies) {
      const deficiencies = userDeficiencies[userId];
      // Use the name from the included user relation (check for null just in case)
      const userName = deficiencies[0].user?.name ?? 'Unknown User'; 
      let mtbfHours: number | null = null;

      // Need at least two mishandles for the user
      if (deficiencies.length >= 2) {
        let totalMillisBetweenMishandles = 0;
        for (let i = 1; i < deficiencies.length; i++) {
          const timeDiff = differenceInMilliseconds(
            deficiencies[i].createdAt,
            deficiencies[i - 1].createdAt
          );
          totalMillisBetweenMishandles += timeDiff;
        }
        const avgMillis = totalMillisBetweenMishandles / (deficiencies.length - 1);
        mtbfHours = parseFloat((avgMillis / (1000 * 60 * 60)).toFixed(1)); // Convert to hours
      }

      mtbfResults.push({
        userId: userId,
        userName: userName,
        mtbfHours: mtbfHours,
      });
    }

    return NextResponse.json(mtbfResults);

  } catch (error) {
    console.error('[API_REPORTS_MTBF_GET - User Based]', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
} 