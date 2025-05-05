import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma'; // Corrected import path
import { EquipmentStatus, BorrowStatus } from '@prisma/client'; // Removed Borrow type, not needed here

// No need for the separate type definition
// type CompletedBorrow = Pick<Borrow, 'checkoutTime' | 'actualReturnTime'>;

export async function GET() {
  try {
    // --- Calculations ---

    // 1. Equipment Counts & Status
    const totalEquipment = await prisma.equipment.count();
    const outOfCommissionEquipment = await prisma.equipment.count({
      where: { status: EquipmentStatus.OUT_OF_COMMISSION },
    });
    const borrowedEquipment = await prisma.equipment.count({
      where: { status: EquipmentStatus.BORROWED },
    });
    const availableEquipment = await prisma.equipment.count({
      where: { status: EquipmentStatus.AVAILABLE },
    });

    const operationalEquipmentCount = totalEquipment - outOfCommissionEquipment;

    // 2. Usage Rate (%)
    const usageRate =
      operationalEquipmentCount > 0
        ? (borrowedEquipment / operationalEquipmentCount) * 100
        : 0;

    // 3. Availability Rate (%)
    const availabilityRate =
      operationalEquipmentCount > 0
        ? (availableEquipment / operationalEquipmentCount) * 100
        : 0;

    // 4. Contact Hours (Total Duration of Completed/Returned Borrows)
    // Remove the explicit generic type argument
    const completedBorrows = await prisma.borrow.findMany({
      where: {
        borrowStatus: {
          in: [BorrowStatus.COMPLETED, BorrowStatus.RETURNED],
        },
        checkoutTime: { not: null }, // Ensure checkoutTime is not null
        actualReturnTime: { not: null }, // Ensure actualReturnTime is not null
      },
      select: {
        checkoutTime: true,
        actualReturnTime: true,
      },
    });

    let totalContactMillis = 0;
    // Type for 'borrow' is inferred correctly by TypeScript from the Prisma query + select
    completedBorrows.forEach((borrow) => {
      // Add explicit null check to satisfy TypeScript
      if (borrow.actualReturnTime && borrow.checkoutTime) {
        totalContactMillis +=
          borrow.actualReturnTime.getTime() - borrow.checkoutTime.getTime();
      }
    });
    const totalContactHours = totalContactMillis / (1000 * 60 * 60); // Convert ms to hours

    // 5. Most Borrowed Equipment
    const borrowCounts = await prisma.borrow.groupBy({
      by: ['equipmentId'],
      where: {
         borrowStatus: {
            notIn: [BorrowStatus.PENDING, BorrowStatus.REJECTED_FIC, BorrowStatus.REJECTED_STAFF, BorrowStatus.CANCELLED]
         }
      },
      _count: {
        equipmentId: true,
      },
      orderBy: {
        _count: {
          equipmentId: 'desc',
        },
      },
      take: 1,
    });

    let mostBorrowedEquipmentName = 'N/A';
    if (borrowCounts.length > 0) {
      const mostBorrowedId = borrowCounts[0].equipmentId;
      const equipment = await prisma.equipment.findUnique({
        where: { id: mostBorrowedId },
        select: { name: true },
      });
      mostBorrowedEquipmentName = equipment?.name ?? 'N/A';
    }

    // --- Response ---
    const stats = {
      equipmentUsageRate: parseFloat(usageRate.toFixed(1)),
      contactHours: parseFloat(totalContactHours.toFixed(1)),
      mostBorrowed: mostBorrowedEquipmentName,
      availabilityRate: parseFloat(availabilityRate.toFixed(1)),
    };

    return NextResponse.json(stats);

  } catch (error) {
    console.error('[API_REPORTS_DASHBOARD_STATS_GET]', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
} 