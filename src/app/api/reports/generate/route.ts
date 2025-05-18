import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { parseISO, isValid, format as formatDate, differenceInHours } from 'date-fns';
import { Borrow, User, Equipment, Class, BorrowStatus, DeficiencyType, DeficiencyStatus, UserRole } from '@prisma/client';
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
    courseId: z.string().optional(), // Expect 'all' or a specific ID
    ficId: z.string().optional(), // Expect 'all' or a specific ID
    equipmentId: z.string().optional(), // Expect 'all' or a specific ID
    borrowerId: z.string().optional(), // Expect 'all' or a specific User ID
    // Add other potential filters here
});

// --- Helper function to convert data array to CSV string ---
function arrayToCsv(data: any[], headers: string[]): string {
    const csvRows = [
        headers.join(','), // Header row
    ];

    for (const row of data) {
        const values = headers.map(header => {
            // Access nested properties if needed (e.g., 'borrower.name')
            const keys = header.split('.');
            let value = row;
            for (const key of keys) {
                if (value === null || typeof value === 'undefined') break;
                value = value[key];
            }
            
            // Format dates nicely
            if (value instanceof Date) {
                value = formatDate(value, 'yyyy-MM-dd HH:mm:ss');
            }

            // Handle null/undefined
            if (value === null || typeof value === 'undefined') {
                value = '';
            }

            // Escape commas and quotes
            const stringValue = String(value);
            if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                // Enclose in double quotes and escape existing double quotes
                value = `"${stringValue.replace(/"/g, '""')}"`;
            } else {
                value = stringValue;
            }
            return value;
        });
        csvRows.push(values.join(','));
    }

    return csvRows.join('\n');
}

// --- Basic PDF Generation Helper ---
async function generateBasicPdf(reportType: string, data: any[], headers: string[]): Promise<Uint8Array> {
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
            // Access nested properties if needed
            const keys = header.split('.');
            let value = row;
            for (const key of keys) {
                if (value === null || typeof value === 'undefined') break;
                value = value[key];
            }
            
            if (value instanceof Date) value = formatDate(value, 'yyyy-MM-dd HH:mm'); // Shorter date format
            if (value === null || typeof value === 'undefined') value = '';

            page.drawText(String(value), { 
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

    // Validate query parameters
    const queryParseResult = QuerySchema.safeParse(Object.fromEntries(searchParams));

    if (!queryParseResult.success) {
        return NextResponse.json({ error: 'Invalid query parameters', details: queryParseResult.error.flatten() }, { status: 400 });
    }

    const { reportType, format: outputFormat, startDate, endDate, courseId, ficId, equipmentId, borrowerId } = queryParseResult.data;

    // --- Build Filters --- 
    const borrowFilters: any = {}; // Filters applicable to Borrow model
    const deficiencyFilters: any = {}; // Filters applicable to Deficiency model

    // Date range filter (Apply to Deficiency createdAt or Borrow request time based on report)
    if (reportType === 'borrowing_activity' || reportType === 'equipment_utilization') {
        if (startDate || endDate) {
            borrowFilters.requestSubmissionTime = {};
            if (startDate) borrowFilters.requestSubmissionTime.gte = parseISO(startDate);
            if (endDate) borrowFilters.requestSubmissionTime.lte = parseISO(endDate);
        }
        borrowFilters.borrowStatus = { 
            in: [BorrowStatus.COMPLETED, BorrowStatus.RETURNED, BorrowStatus.ACTIVE, BorrowStatus.OVERDUE]
        };
    } else if (reportType === 'deficiency_summary') {
        if (startDate || endDate) {
            deficiencyFilters.createdAt = {};
            if (startDate) deficiencyFilters.createdAt.gte = parseISO(startDate);
            if (endDate) deficiencyFilters.createdAt.lte = parseISO(endDate);
        }
    }

    // Equipment ID Filter
     if (equipmentId && equipmentId !== 'all') {
         if (reportType === 'borrowing_activity' || reportType === 'equipment_utilization') {
             borrowFilters.equipmentId = equipmentId;
         } else if (reportType === 'deficiency_summary') {
             // Filter deficiencies linked to borrows involving specific equipment
             deficiencyFilters.borrow = { equipmentId: equipmentId };
         }
     }
    
    // Course ID Filter
    if (courseId && courseId !== 'all') {
         if (reportType === 'borrowing_activity') {
             borrowFilters.classId = courseId;
         } else if (reportType === 'deficiency_summary') {
             // Filter deficiencies linked to borrows from a specific class
             deficiencyFilters.borrow = { ...deficiencyFilters.borrow, classId: courseId };
         }
     }

    // FIC ID Filter
    if (ficId && ficId !== 'all') {
        if (reportType === 'borrowing_activity') {
            // Filter by ficId through the class association for borrows
            borrowFilters.class = { ...borrowFilters.class, ficId: ficId }; 
        } else if (reportType === 'deficiency_summary') {
            // Filter by the FIC directly intended to be notified on the deficiency
            deficiencyFilters.ficToNotifyId = ficId;
        }
        // Note for other report types or future enhancements: 
        // Deficiency linkage to an FIC via borrow.class.ficId or borrow.ficId 
        // would require more complex nested filters if ficToNotifyId is not the primary link.
    }
    
    // Borrower ID Filter (New)
    if (borrowerId && borrowerId !== 'all') {
        if (reportType === 'borrowing_activity') {
            borrowFilters.borrowerId = borrowerId;
        } else if (reportType === 'deficiency_summary') {
            // For deficiency summary, filter if the selected user is either responsible OR tagged the deficiency
            deficiencyFilters.OR = [
                { userId: borrowerId },       // User responsible for the deficiency
                { taggedById: borrowerId }    // User who tagged the deficiency
            ];
        }
    }
    
    try {
        let data: any[] = [];
        let csvHeaders: string[] = [];
        let isImplemented = true; // Flag for implemented reports
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
                    }
                });

                // Process data: Group by equipment, count borrows, sum hours
                const utilizationMap = new Map<string, { name: string; borrowCount: number; totalHours: number }>();
                for (const borrow of utilizationBorrows) {
                    if (!borrow.equipmentId || !borrow.equipment) continue; // Skip if no equipment linked
                    
                    const current = utilizationMap.get(borrow.equipmentId) || { name: borrow.equipment.name, borrowCount: 0, totalHours: 0 };
                    current.borrowCount++;

                    if (borrow.checkoutTime && borrow.actualReturnTime) {
                        // Use differenceInHours for potentially cleaner output
                        current.totalHours += differenceInHours(borrow.actualReturnTime, borrow.checkoutTime);
                    }
                    utilizationMap.set(borrow.equipmentId, current);
                }

                // Convert map to array and sort (e.g., by borrow count descending)
                data = Array.from(utilizationMap.entries()).map(([id, stats]) => ({
                    equipmentId: id,
                    equipmentName: stats.name,
                    borrowCount: stats.borrowCount,
                    totalUsageHours: stats.totalHours,
                })).sort((a, b) => b.borrowCount - a.borrowCount); // Sort by count desc

                csvHeaders = ['equipmentId', 'equipmentName', 'borrowCount', 'totalUsageHours'];
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
                const systemUsageBorrowFilters: any = { classId: { not: null } }; // Only count borrows linked to a class
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
                return NextResponse.json({ message: `Report type '${reportType}' is not yet implemented.` });
            }
            return NextResponse.json(data);
        }

    } catch (error) {
        console.error(`[API_REPORTS_GENERATE_${reportType.toUpperCase()}_GET]`, error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
} 