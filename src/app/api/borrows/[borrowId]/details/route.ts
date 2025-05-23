import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { UserRole, Borrow, Class } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';

// Define a more specific type for the FIC user details part of the response
interface FicDetailsResponse {
  id: string;
  name: string | null;
  email: string | null;
}

// Define the expected overall response structure after modification
// This type is based on the Prisma.Borrow type, with FIC potentially overridden
// and the nested class.fic removed.
interface BorrowerDetails {
  id: string;
  name: string | null;
  email: string | null;
  role: UserRole;
}

// Use a type alias as GroupMateDetails is identical to BorrowerDetails
type GroupMateDetails = BorrowerDetails;

// Define the expected overall response structure after modification
interface BorrowDetailsApiResponse extends Omit<Borrow, 'fic' | 'class' | 'borrower'> {
  borrower: BorrowerDetails | null;
  fic: FicDetailsResponse | null; // This will be the consolidated FIC
  class?: Omit<Class, 'fic'> | null; // Class details without its own fic property if class exists
  groupMates?: GroupMateDetails[]; // Added for group mates
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ borrowId: string }> }
) {
    const session = await getServerSession(authOptions);

    // Authentication Check: Ensure user is logged in and is Staff or Faculty
    if (!session?.user?.id || (session.user.role !== UserRole.STAFF && session.user.role !== UserRole.FACULTY)) {
        return NextResponse.json({ message: 'Forbidden: Only Staff or Faculty can access borrow details.' }, { status: 403 });
    }

    const { borrowId } = await params; // Await params here

    if (!borrowId) {
        return NextResponse.json({ message: 'Borrow ID is required' }, { status: 400 });
    }

    // Validate borrowId format (optional but good practice)
    const objectIdRegex = /^[0-9a-fA-F]{24}$/;
    if (!objectIdRegex.test(borrowId)) {
        return NextResponse.json({ message: 'Invalid Borrow ID format.' }, { status: 400 });
    }

    try {
        const borrowDetails = await prisma.borrow.findUnique({
            where: { id: borrowId },
            include: {
                borrower: {
                    select: { id: true, name: true, email: true, role: true }
                },
                fic: {
                    select: { id: true, name: true, email: true }
                },
                class: {
                    include: {
                        fic: {
                            select: {id: true, name: true, email: true}
                        }
                    }
                }
                // GroupMates are not directly on Borrow, will fetch separately if borrowGroupId exists
            }
        });

        if (!borrowDetails) {
            return NextResponse.json({ message: 'Borrow record not found' }, { status: 404 });
        }

        let groupMates: GroupMateDetails[] = [];
        if (borrowDetails.borrowGroupId) {
            const groupMateRecords = await prisma.borrowGroupMate.findMany({
                where: { borrowGroupId: borrowDetails.borrowGroupId },
                include: {
                    user: { // Include the user details for each groupmate
                        select: { id: true, name: true, email: true, role: true }
                    }
                }
            });
            groupMates = groupMateRecords.map(gm => gm.user).filter(user => user !== null) as GroupMateDetails[];
            // Filter out the main borrower from groupMates list if they are also listed as a groupmate
            if (borrowDetails.borrower) {
                 groupMates = groupMates.filter(gm => gm.id !== borrowDetails.borrowerId);
            }
        }
        
        const consolidatedFic = borrowDetails.class?.fic || borrowDetails.fic || null;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { fic, borrower, class: classDetailsFromBorrow, ...restOfBorrowDetails } = borrowDetails;

        // Construct the class object for the response, explicitly excluding 'fic'
        let responseClass: Omit<Class, 'fic'> | null = null;
        if (classDetailsFromBorrow) {
            // Destructure to get all properties except 'fic'
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { fic: _ficFromClass, ...restOfClassDetails } = classDetailsFromBorrow;
            responseClass = restOfClassDetails;
        }

        const response: BorrowDetailsApiResponse = {
            ...restOfBorrowDetails,
            borrower: borrower,
            fic: consolidatedFic,
            class: responseClass,
            groupMates: groupMates, // Add groupMates to the response
        };

        return NextResponse.json(response);

    } catch (error) {
        console.error(`API Error - GET /api/borrows/${borrowId}/details:`, error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
} 