import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { UserRole } from '@prisma/client';

// GET: Fetch all borrow records for a specific borrowGroupId
export async function GET(request: NextRequest, context: { params: Promise<{ groupId: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ message: 'Authentication required' }, { status: 401 });
    }
    const currentUser = session.user; // Assign to variable for easier access

    const params = await context.params;

    if (!params.groupId) {
        return NextResponse.json({ message: 'Group ID is required' }, { status: 400 });
    }

    try {
        // --- Fetch Borrows in Group --- 
        const borrowsInGroup = await prisma.borrow.findMany({
            where: {
                borrowGroupId: params.groupId,
            },
            select: {
                id: true,
                borrowGroupId: true,
                borrowerId: true,
                equipmentId: true,
                classId: true,
                requestedStartTime: true,
                requestedEndTime: true,
                approvedStartTime: true,
                approvedEndTime: true,
                checkoutTime: true,
                actualReturnTime: true,
                borrowStatus: true,
                requestSubmissionTime: true,
                reservationType: true,
                equipment: {
                    select: { id: true, name: true, equipmentId: true, images: true }
                },
                borrower: {
                    select: { id: true, name: true, email: true }
                },
                approvedByFic: {
                    select: { name: true, email: true }
                },
                approvedByStaff: {
                    select: { name: true, email: true }
                },
                class: { 
                  select: {
                    courseCode: true,
                    section: true,
                    semester: true,
                    academicYear: true,
                    fic: {
                      select: {
                        id: true,
                        name: true,
                        email: true
                      }
                    }
                  }
                }
            },
            orderBy: {
                requestSubmissionTime: 'asc',
            },
        });

        if (borrowsInGroup.length === 0) {
            // If the group ID exists but has no items (shouldn't happen often) or if ID is invalid
            return NextResponse.json({ message: 'Borrow group not found or is empty' }, { status: 404 });
        }

        // --- Fetch Group Mates --- 
        const groupMates = await prisma.borrowGroupMate.findMany({
            where: {
                borrowGroupId: params.groupId 
            },
            include: { 
                user: { 
                    select: {
                        id: true,
                        name: true,
                        email: true 
                    }
                }
            },
            orderBy: {
                user: { name: 'asc' } 
            }
        });

        // --- Permission Check (Refined) --- 
        const isBorrower = borrowsInGroup[0].borrowerId === currentUser.id;
        const isGroupMember = groupMates.some(gm => gm.userId === currentUser.id);
        
        // Check role safely after confirming currentUser exists
        let isStaffOrFaculty = false;
        if (currentUser.role === UserRole.STAFF || currentUser.role === UserRole.FACULTY) {
            isStaffOrFaculty = true;
        }

        if (!isBorrower && !isGroupMember && !isStaffOrFaculty) {
            return NextResponse.json({ message: 'Forbidden: You do not have permission to view this borrow group.' }, { status: 403 });
        }
        // --- End Permission Check --- 

        // Return both borrows and group mates
        return NextResponse.json({ 
            borrows: borrowsInGroup, 
            groupMates: groupMates.map(gm => gm.user) 
        });

    } catch (error: unknown) {
        console.error(`API Error - GET /api/borrows/group/${params.groupId}:`, error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
} 