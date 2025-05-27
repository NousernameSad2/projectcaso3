import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { parseISO, isValid, format as formatDate, differenceInHours } from 'date-fns';
import type { Prisma } from '@prisma/client';
import { BorrowStatus, ReservationType } from '@prisma/client';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Define possible report types (must match frontend enum/values)
const ReportTypeEnum = z.enum([
    'borrowing_activity',
    'equipment_utilization',
    'deficiency_summary',
    'system_usage',
]);

// Define the schema for query parameters
const QuerySchema = z.object({
    reportType: ReportTypeEnum,
    format: z.enum(['json', 'csv', 'pdf']).optional().default('json'),
    startDate: z.string().optional().refine(val => !val || (isValid(parseISO(val))), { message: "Invalid start date format" }),
    endDate: z.string().optional().refine(val => !val || (isValid(parseISO(val))), { message: "Invalid end date format" }),
    courseId: z.union([z.string(), z.array(z.string())]).optional(), // MODIFIED
    ficId: z.union([z.string(), z.array(z.string())]).optional(), // MODIFIED
    equipmentId: z.union([z.string(), z.array(z.string())]).optional(), // MODIFIED
    borrowerId: z.union([z.string(), z.array(z.string())]).optional(), // MODIFIED
    returnStatus: z.enum(['all', 'LATE', 'REGULAR']).optional().default('all'),
    borrowContext: z.enum(['all', 'IN_CLASS', 'OUT_OF_CLASS']).optional().default('all'),
    classId: z.union([z.string(), z.array(z.string())]).optional(), // ADDED for Equipment Utilization class filter
    // Add other potential filters here
});

// --- Helper function to convert data array to CSV string ---
function arrayToCsv(data: Record<string, unknown>[], headers: string[]): string {
    const csvRows = [
        headers.join(','), // Header row
    ];

    for (const row of data) {
        const values = headers.map(header => {
            const keys = header.split('.');
            let currentValue: unknown = row;
            for (const key of keys) {
                if (typeof currentValue === 'object' && currentValue !== null && key in currentValue) {
                    currentValue = (currentValue as Record<string, unknown>)[key];
                } else {
                    currentValue = undefined;
                    break;
                }
            }
            
            let formattedValue = currentValue;
            // Format dates nicely
            if (formattedValue instanceof Date) {
                formattedValue = formatDate(formattedValue, 'yyyy-MM-dd HH:mm:ss');
            }

            // Handle null/undefined
            if (formattedValue === null || typeof formattedValue === 'undefined') {
                formattedValue = '';
            }

            // Escape commas and quotes
            const stringValue = String(formattedValue);
            if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                return `"${stringValue.replace(/"/g, '""')}"`;
            }
            return stringValue;
        });
        csvRows.push(values.join(','));
    }

    return csvRows.join('\n');
}

// --- Basic PDF Generation Helper ---
async function generateBasicPdf(reportType: string, data: Record<string, unknown>[], headers: string[]): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const fontSize = 8; // Smaller font for tables
    const margin = 40;
    const tableTop = height - margin - 30; // Position table below title
    const rowHeight = fontSize * 1.5;
    const colWidth = (width - 2 * margin) / headers.length; // Simple equal width columns

    // Draw Title
    page.drawText(`Report: ${reportType}`, {
        x: margin,
        y: height - margin,
        size: 14,
        font: timesRomanFont,
        color: rgb(0, 0.53, 0.71),
    });
    
    // Draw Table Header
    let currentX = margin;
    let currentY = tableTop;
    headers.forEach(header => {
        page.drawText(header.replace('.', ' \n'), { // Basic wrap on dot
            x: currentX + 2,
            y: currentY - fontSize * 1.2, 
            size: fontSize, 
            font: timesRomanFont, 
            maxWidth: colWidth - 4, 
            lineHeight: fontSize * 1.1
        });
        page.drawRectangle({ x: currentX, y: currentY - rowHeight, width: colWidth, height: rowHeight, borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 0.5 });
        currentX += colWidth;
    });
    currentY -= rowHeight;

    // Draw Table Rows
    for (const row of data) {
        if (currentY < margin) { // Basic pagination check
            // TODO: Add new page and redraw headers
            page.drawText("...content truncated...", { x: margin, y: currentY, size: fontSize, font: timesRomanFont });
            break;
        }
        currentX = margin;
        for (const header of headers) {
            const keys = header.split('.');
            let currentValue: unknown = row;
            for (const key of keys) {
                if (typeof currentValue === 'object' && currentValue !== null && key in currentValue) {
                    currentValue = (currentValue as Record<string, unknown>)[key];
                } else {
                    currentValue = undefined;
                    break;
                }
            }
            
            let formattedValue = currentValue;
            if (formattedValue instanceof Date) formattedValue = formatDate(formattedValue, 'yyyy-MM-dd HH:mm');
            if (formattedValue === null || typeof formattedValue === 'undefined') formattedValue = '';

            page.drawText(String(formattedValue), { 
                x: currentX + 2, 
                y: currentY - fontSize * 1.2,
                size: fontSize, 
                font: timesRomanFont, 
                maxWidth: colWidth - 4,
                lineHeight: fontSize * 1.1
             });
             page.drawRectangle({ x: currentX, y: currentY - rowHeight, width: colWidth, height: rowHeight, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });
            currentX += colWidth;
        }
        currentY -= rowHeight;
    }

    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);

    const rawParams: Record<string, string | string[] | undefined> = {};
    for (const key of searchParams.keys()) {
      const allVals = searchParams.getAll(key);
      if (allVals.length > 0) {
        rawParams[key] = allVals.length === 1 ? allVals[0] : allVals;
      }
    }
    const queryParseResult = QuerySchema.safeParse(rawParams);

    if (!queryParseResult.success) {
        return NextResponse.json({ error: 'Invalid query parameters', details: queryParseResult.error.flatten() }, { status: 400 });
    }

    const { reportType, format: outputFormat, startDate, endDate, courseId, ficId, equipmentId, borrowerId, returnStatus: rawReturnStatus, borrowContext, classId } = queryParseResult.data;

    // Transform returnStatus to uppercase before further processing
    let returnStatus = rawReturnStatus; // Keep returnStatus as let since it's reassigned
    if (returnStatus && returnStatus !== 'all') {
        returnStatus = returnStatus.toUpperCase() as 'LATE' | 'REGULAR';
    }

    const borrowFilters: Prisma.BorrowWhereInput = {};
    const deficiencyFilters: Prisma.DeficiencyWhereInput = {}; // Initialize as const
    const deficiencyAndConditions: Prisma.DeficiencyWhereInput[] = []; // ADDED: To collect AND conditions for deficiency reports

    // Date range filter
    if (reportType === 'borrowing_activity' || reportType === 'equipment_utilization') {
        if (startDate || endDate) {
            borrowFilters.requestSubmissionTime = {};
            if (startDate) borrowFilters.requestSubmissionTime.gte = parseISO(startDate);
            if (endDate) borrowFilters.requestSubmissionTime.lte = parseISO(endDate);
        }
        let applicableBorrowStatuses: BorrowStatus[] = [BorrowStatus.COMPLETED, BorrowStatus.RETURNED, BorrowStatus.ACTIVE, BorrowStatus.OVERDUE];
        if (returnStatus && returnStatus !== 'all') {
            if (returnStatus === 'LATE') {
                applicableBorrowStatuses = [BorrowStatus.OVERDUE];
            } else if (returnStatus === 'REGULAR') {
                applicableBorrowStatuses = [BorrowStatus.COMPLETED, BorrowStatus.RETURNED, BorrowStatus.ACTIVE];
            }
        }
        borrowFilters.borrowStatus = { in: applicableBorrowStatuses };
        if (borrowContext && borrowContext !== 'all') {
            borrowFilters.reservationType = borrowContext as ReservationType;
        }
    } else if (reportType === 'deficiency_summary') {
        if (startDate || endDate) {
            deficiencyFilters.createdAt = {};
            if (startDate) deficiencyFilters.createdAt.gte = parseISO(startDate);
            if (endDate) deficiencyFilters.createdAt.lte = parseISO(endDate);
        }
    }

    // Equipment ID Filter
    if (equipmentId && equipmentId !== 'all') {
        const ids = (Array.isArray(equipmentId) ? equipmentId : [equipmentId]).filter(id => id !== 'all' && id !== '');
        if (ids.length > 0) {
            if (reportType === 'borrowing_activity' || reportType === 'equipment_utilization') {
                borrowFilters.equipmentId = { in: ids };
            } else if (reportType === 'deficiency_summary') {
                deficiencyFilters.borrow = { // MODIFIED: direct assignment with correct type
                    ...(deficiencyFilters.borrow || {}),
                    equipmentId: { in: ids },
                } as Prisma.BorrowWhereInput;
            }
        }
    }
    
    // Course ID Filter (also used as Class filter for Borrowing Activity)
    if (courseId && courseId !== 'all') {
        const ids = (Array.isArray(courseId) ? courseId : [courseId]).filter(id => id !== 'all' && id !== '');
        if (ids.length > 0) {
            if (reportType === 'borrowing_activity') {
                borrowFilters.classId = { in: ids };
            } else if (reportType === 'deficiency_summary') {
                deficiencyFilters.borrow = { // MODIFIED: direct assignment with correct type
                    ...(deficiencyFilters.borrow || {}),
                    classId: { in: ids },
                } as Prisma.BorrowWhereInput;
            }
        }
    }

    // FIC ID Filter
    if (ficId && ficId !== 'all') {
        const ids = (Array.isArray(ficId) ? ficId : [ficId]).filter(id => id !== 'all' && id !== '');
        if (ids.length > 0) {
            if (reportType === 'borrowing_activity') {
                borrowFilters.class = {
                    ...(borrowFilters.class || {}),
                    ficId: { in: ids }, 
                } as Prisma.ClassWhereInput;
            } else if (reportType === 'deficiency_summary') {
                // MODIFIED: Collect FIC conditions for an AND clause
                const ficOrItems: Prisma.DeficiencyWhereInput[] = [];
                if (ids.length === 1) {
                    ficOrItems.push({ ficToNotifyId: ids[0] });
                } else {
                    ids.forEach(id => {
                        ficOrItems.push({ ficToNotifyId: id });
                    });
                }
                if (ficOrItems.length > 0) {
                    deficiencyAndConditions.push({ OR: ficOrItems });
                }
            }
        }
    }
    
    // Borrower ID Filter (User)
    if (borrowerId && borrowerId !== 'all') {
        const ids = (Array.isArray(borrowerId) ? borrowerId : [borrowerId]).filter(id => id !== 'all' && id !== '');
        if (ids.length > 0) {
            if (reportType === 'borrowing_activity') {
                borrowFilters.borrowerId = { in: ids };
            } else if (reportType === 'deficiency_summary') {
                // MODIFIED: Collect Borrower conditions for an AND clause
                const borrowerOrItems: Prisma.DeficiencyWhereInput[] = [];
                ids.forEach(id => {
                    borrowerOrItems.push({ userId: id });
                    borrowerOrItems.push({ taggedById: id });
                });
                if (borrowerOrItems.length > 0) {
                    deficiencyAndConditions.push({ OR: borrowerOrItems });
                }
            }
        }
    }

    // ADDED: Consolidate AND conditions for deficiency reports before the try block
    if (reportType === 'deficiency_summary' && deficiencyAndConditions.length > 0) {
        if (deficiencyFilters.AND) {
            // Ensure deficiencyFilters.AND is an array before pushing
            if (Array.isArray(deficiencyFilters.AND)) {
                deficiencyFilters.AND.push(...deficiencyAndConditions);
            } else {
                // If it was a single object, convert to an array and add the new conditions
                deficiencyFilters.AND = [deficiencyFilters.AND, ...deficiencyAndConditions];
            }
        } else {
            deficiencyFilters.AND = deficiencyAndConditions;
        }
    }

    // Class ID Filter (Specifically for Equipment Utilization report type)
    if (reportType === 'equipment_utilization' && classId && classId !== 'all') {
        const ids = (Array.isArray(classId) ? classId : [classId]).filter(id => id !== 'all' && id !== '');
        if (ids.length > 0) {
            borrowFilters.classId = { in: ids };
        }
    }
    
    try {
        let data: Record<string, unknown>[] = [];
        let csvHeaders: string[] = [];
        const isImplemented = true; // Changed to const
        let pdfImplemented = false; // Flag for implemented PDF reports
        let pdfHeaders: string[] = []; // Store headers for PDF separately if needed

        switch (reportType) {
            case 'borrowing_activity':
                // The necessary filters (borrow + course/fic if provided) 
                // should already be in borrowingActivityFilters due to logic above.
                const borrowingActivityFilters = { ...borrowFilters };
                // Directly add courseId if it was set (already handled by borrowFilters but explicit here for clarity if needed)
                // if (courseId && courseId !== 'all') borrowingActivityFilters.classId = courseId; 
                // REMOVED: ficId direct filter, as it's now handled via borrowFilters.class.ficId
                // if (ficId && ficId !== 'all') borrowingActivityFilters.ficId = ficId;
                
                console.log("Fetching Borrowing Activity with filters:", borrowingActivityFilters);
                data = await prisma.borrow.findMany({
                    where: borrowingActivityFilters, 
                    include: { 
                        borrower: { select: { name: true } }, 
                        equipment: { select: { name: true } }, 
                        class: { select: { courseCode: true, section: true, semester: true, academicYear: true } },
                        approvedByFic: { select: { name: true } }
                    },
                    orderBy: { requestSubmissionTime: 'desc' }
                });
                csvHeaders = [
                    'id', 'borrowStatus', 'requestSubmissionTime', 'requestedStartTime', 'requestedEndTime',
                    'borrower.name', 'equipment.name', 'class.courseCode', 'class.section',
                    'class.semester', 'class.academicYear', 'checkoutTime', 'actualReturnTime',
                    'approvedByFic.name'
                ];
                pdfHeaders = csvHeaders;
                pdfImplemented = true; // Mark borrowing activity PDF as (basically) implemented
                break;
            case 'equipment_utilization':
                console.log("Fetching data for Equipment Utilization with filters:", borrowFilters);
                const utilizationBorrows = await prisma.borrow.findMany({
                    where: borrowFilters, 
                    select: {
                        equipmentId: true,
                        equipment: { select: { name: true } },
                        checkoutTime: true,
                        actualReturnTime: true,
                        reservationType: true, // ADDED: Select reservationType
                    }
                });

                // Process data: Group by equipment AND reservationType, count borrows, sum hours
                const utilizationMap = new Map<string, { name: string; borrowCount: number; totalHours: number; utilizationContext: string }>();
                for (const borrow of utilizationBorrows) {
                    if (!borrow.equipmentId || !borrow.equipment) continue; // Skip if no equipment linked
                    
                    const context = borrow.reservationType || 'UNKNOWN'; // Default context if null/undefined
                    const key = `${borrow.equipmentId}-${context}`; // Composite key

                    const current = utilizationMap.get(key) || { 
                        name: borrow.equipment.name, 
                        borrowCount: 0, 
                        totalHours: 0,
                        utilizationContext: context === 'IN_CLASS' ? 'In Class' : (context === 'OUT_OF_CLASS' ? 'Out of Class' : 'N/A (Other)') 
                    };
                    current.borrowCount++;

                    if (borrow.checkoutTime && borrow.actualReturnTime) {
                        current.totalHours += differenceInHours(borrow.actualReturnTime, borrow.checkoutTime);
                    }
                    utilizationMap.set(key, current);
                }

                // Convert map to array and sort (e.g., by borrow count descending)
                data = Array.from(utilizationMap.entries()).map(([key, stats]) => {
                    const [eqId] = key.split('-'); // Removed contextValue
                    return {
                        equipmentId: eqId,
                        equipmentName: stats.name,
                        utilizationContext: stats.utilizationContext, 
                        borrowCount: stats.borrowCount,
                        totalUsageHours: stats.totalHours,
                    };
                }).sort((a, b) => b.borrowCount - a.borrowCount); // Sort by count desc

                csvHeaders = ['equipmentId', 'equipmentName', 'utilizationContext', 'borrowCount', 'totalUsageHours'];
                pdfHeaders = csvHeaders;
                pdfImplemented = true; // Mark as implemented for PDF
                break;
            case 'deficiency_summary':
                console.log("Fetching Deficiency Summary with filters:", deficiencyFilters);
                // Fetch deficiencies based on the built filters
                data = await prisma.deficiency.findMany({
                    where: deficiencyFilters,
                    include: {
                        user: { select: { name: true } }, // User responsible
                        taggedBy: { select: { name: true } }, // Staff/FIC who tagged
                        borrow: { // Include borrow details for context
                            select: {
                                id: true,
                                equipment: { select: { name: true } }
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' }
                });

                csvHeaders = [
                    'id', 
                    'createdAt',
                    'type',
                    'status',
                    'description',
                    'resolution',
                    'user.name', // User responsible
                    'taggedBy.name', // Tagged by
                    'borrow.id', // Related Borrow ID
                    'borrow.equipment.name' // Related Equipment Name
                ];
                pdfHeaders = csvHeaders;
                pdfImplemented = true; // Mark as implemented for PDF
                break;
            case 'system_usage':
                console.log("Fetching System Usage data...");
                // Example: Get user counts by role
                const userCountsByRole = await prisma.user.groupBy({
                    by: ['role'],
                    _count: { id: true },
                    orderBy: { role: 'asc' }
                });

                // Get borrow counts by class within the date range
                const systemUsageBorrowFilters: Prisma.BorrowWhereInput = { classId: { not: null } }; // Only count borrows linked to a class
                if (startDate || endDate) {
                    systemUsageBorrowFilters.requestSubmissionTime = {};
                    if (startDate) systemUsageBorrowFilters.requestSubmissionTime.gte = parseISO(startDate);
                    if (endDate) systemUsageBorrowFilters.requestSubmissionTime.lte = parseISO(endDate);
                }
                const borrowCountsByClass = await prisma.borrow.groupBy({
                    by: ['classId'],
                    where: systemUsageBorrowFilters,
                    _count: {
                        id: true
                    },
                    orderBy: {
                        _count: {
                            id: 'desc' // Order by borrow count descending
                        }
                    },
                    take: 10 // Limit to top 10 most active classes
                });

                // Fetch class details for the top classes to show names
                const topClassIds = borrowCountsByClass.map(c => c.classId!);
                const topClassDetails = await prisma.class.findMany({
                    where: { id: { in: topClassIds } },
                    select: { id: true, courseCode: true, section: true, semester: true, academicYear: true }
                });
                const classDetailMap = new Map(topClassDetails.map(c => [c.id, `${c.courseCode}-${c.section} (${c.semester} ${c.academicYear || ''})`]));

                // Format data for report
                data = userCountsByRole.map(roleCount => ({
                    metric: `User Count (${roleCount.role})`,
                    value: roleCount._count.id
                }));
                
                data.push({ metric: '-- Active Classes (by Borrow Count) --', value: '' }); // Separator
                borrowCountsByClass.forEach(classCount => {
                    data.push({
                        metric: classDetailMap.get(classCount.classId!) ?? `Class ID: ${classCount.classId}`,
                        value: classCount._count.id
                    });
                });

                 csvHeaders = ['metric', 'value'];
                pdfHeaders = csvHeaders;
                pdfImplemented = true; // Mark as implemented for PDF
                break;
            default:
                return NextResponse.json({ error: 'Invalid report type' }, { status: 400 });
        }

        // --- Return based on format ---
        const filenameBase = `${reportType}_${formatDate(new Date(), 'yyyyMMddHHmmss')}`;

        if (outputFormat === 'csv') {
            if (!isImplemented) {
                return new Response(`Report type '${reportType}' CSV export is not yet implemented.`, { status: 400, headers: { 'Content-Type': 'text/plain' } });
            }
            if (data.length === 0) {
                 return new Response("No data found for the selected filters.", { status: 200, headers: { 'Content-Type': 'text/plain' } });
            }
            const csvData = arrayToCsv(data, csvHeaders);
            const filename = `${filenameBase}.csv`;
            return new Response(csvData, {
                status: 200,
                headers: {
                    'Content-Type': 'text/csv',
                    'Content-Disposition': `attachment; filename="${filename}"`,
                },
            });
        } else if (outputFormat === 'pdf') {
            if (!pdfImplemented) {
                return new Response(`PDF export for report type '${reportType}' is not yet implemented.`, { status: 400, headers: { 'Content-Type': 'text/plain' } });
            }
            if (data.length === 0) {
                 return new Response("No data found for the selected filters.", { status: 200, headers: { 'Content-Type': 'text/plain' } });
            }
            // Generate basic PDF using appropriate headers
            const pdfBytes = await generateBasicPdf(reportType, data, pdfHeaders);
            const filename = `${filenameBase}.pdf`;
            return new Response(pdfBytes, {
                status: 200,
                headers: {
                    'Content-Type': 'application/pdf',
                    'Content-Disposition': `attachment; filename="${filename}"`,
                },
            });
        } else {
            // Default to JSON
            if (!isImplemented) {
                return NextResponse.json({ message: `Report type '${reportType}' is not yet implemented.` }, { status: 400 });
            }
            return NextResponse.json(data);
        }

    } catch (error) {
        console.error(`[API_REPORTS_GENERATE_${reportType.toUpperCase()}_GET]`, error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
} // End of GET function
