import { NextResponse } from 'next/server';
import { PrismaClient, BorrowStatus, UserRole, EquipmentStatus } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions'; // Updated import
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { addDays } from 'date-fns'; // For calculating return date

const prisma = new PrismaClient();

// Define SessionUser locally if not shared
interface SessionUser {
  id: string;
  role: UserRole;
}

// Define the expected shape of the request body
const bulkCheckoutSchema = z.object({
  equipmentIds: z.array(z.string().min(1)).min(1, 'At least one equipment ID is required'),
  classId: z.string().min(1, 'Class ID is required'),
  // Add borrowerId if an admin/staff checks out for someone else
  // borrowerId: z.string().optional(), 
});

export async function POST(request: Request) {
  // 1. Get User Session (User performing the checkout)
  const session = await getServerSession(authOptions);
  const user = session?.user as SessionUser | undefined; // Assuming SessionUser type is defined

  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized: User session not found.' }, { status: 401 });
  }
  
  // --- Permission Check (Only Staff can perform direct checkout) ---
  if (user.role !== UserRole.STAFF) { 
    console.warn(`User ${user.id} with role ${user.role || 'unknown'} attempted direct bulk checkout.`);
    return NextResponse.json({ error: 'Forbidden: Only Staff can perform direct checkouts.' }, { status: 403 });
  }
  // --- End Permission Check --- 
  
  const performingUserId = user.id; 

  // 2. Parse and Validate Request Body
  let validatedData;
  try {
    const body = await request.json();
    validatedData = bulkCheckoutSchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to parse request body' }, { status: 400 });
  }

  // For now, assume the user performing the action is the borrower
  // If admin checks out for others, get borrowerId from validatedData
  const borrowerUserId = performingUserId; 
  const { equipmentIds, classId } = validatedData;

  // 3. Fetch Equipment Statuses to check availability
  const equipmentToCheck = await prisma.equipment.findMany({
    where: {
      id: { in: equipmentIds },
    },
    select: {
      id: true,
      status: true,
      name: true, // For error messages
    },
  });

  const unavailableItems = equipmentToCheck.filter(
    (item) => item.status !== EquipmentStatus.AVAILABLE
  );

  if (unavailableItems.length > 0) {
    const itemNames = unavailableItems.map(item => item.name).join(', ');
    return NextResponse.json(
      { error: `Cannot perform direct checkout: The following items are not available: ${itemNames}` },
      { status: 409 } // 409 Conflict is suitable here
    );
  }

  // --- If all items are available, proceed --- 

  // 4. Generate a unique Group ID
  const borrowGroupId = createId();
  const checkoutTime = new Date(); 

  // 5. Calculate Expected Return Time (which will be used for approvedEndTime and requestedEndTime)
  const defaultBorrowDays = parseInt(process.env.DEFAULT_BORROW_DAYS || '7', 10);
  const calculatedReturnTime = addDays(checkoutTime, defaultBorrowDays);

  // 6. Prepare data for batch creation
  const borrowData = equipmentIds.map((equipmentId) => ({
    borrowGroupId: borrowGroupId,
    borrowerId: borrowerUserId, // The actual user borrowing the items
    equipmentId: equipmentId,
    classId: classId,
    borrowStatus: BorrowStatus.ACTIVE, // Direct checkout to ACTIVE status
    checkoutTime: checkoutTime,
    approvedStartTime: checkoutTime, // For direct checkout, approvedStartTime is checkoutTime
    approvedEndTime: calculatedReturnTime, // Use the calculated return time
    requestedStartTime: checkoutTime, // Set requestedStartTime to checkoutTime
    requestedEndTime: calculatedReturnTime, // Set requestedEndTime to the calculated return time
    approvedByStaffId: performingUserId, // ID of staff who approved/performed the checkout
    // Add defaults for other fields if needed
  }));

  // 7. Create Borrow Records in Batch
  // IMPORTANT: Add availability checks before this step in a real implementation!
  try {
    // Consider wrapping in a transaction if you add availability checks/updates
    const result = await prisma.borrow.createMany({
      data: borrowData,
    });

    if (result.count !== equipmentIds.length) {
       console.warn(`Bulk checkout: Attempted ${equipmentIds.length} records, created ${result.count}. Investigate potential issues.`);
       // Maybe some items failed validation/availability checks if added earlier
    }

    // TODO: Optionally update Equipment status here if not handled by triggers/other logic

    // 8. Return Success Response
    return NextResponse.json(
      {
        message: `${result.count} items checked out successfully.`,
        borrowGroupId: borrowGroupId,
        count: result.count
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Failed to perform bulk checkout:', error);
    return NextResponse.json({ error: 'Database error occurred during checkout.' }, { status: 500 });
  }
} 