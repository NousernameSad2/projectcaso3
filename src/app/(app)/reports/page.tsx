'use client'; // Required for Recharts potentially

import React, { useState, useMemo } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'; // Assuming shadcn/ui path
import {
  ResponsiveContainer, BarChart, XAxis, YAxis, Tooltip, Legend, Bar,
  CartesianGrid, PieChart, Pie, Cell, Legend as PieLegend // Added PieChart components
} from 'recharts'; // Example import
import { useQuery } from '@tanstack/react-query'; // Import useQuery
import axios from 'axios'; // Need axios or fetch for API calls
import LoadingSpinner from '@/components/ui/LoadingSpinner'; // Assuming a spinner component exists
import { AlertTriangle, Calendar as CalendarIcon, Download } from 'lucide-react'; // Icon for errors and new icons
import { Button } from "@/components/ui/button"; // Added Button
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"; // Added Select
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"; // Added Popover
import { Calendar } from "@/components/ui/calendar"; // Added Calendar
import { format as formatDateFns } from "date-fns";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

// Interface for the API response data
interface DashboardStats {
  equipmentUsageRate: number;
  contactHours: number;
  mostBorrowed: string;
  availabilityRate: number;
}

// Interface for the weekly usage chart data
interface DailyUsage {
  name: string; // Day name (e.g., 'Mon')
  hours: number;
}

interface EquipmentMaintenanceStats { // Updated interface from API
    equipmentId: string;
    equipmentName: string;
    mttrHours: number | null;
    totalMaintenanceHours: number;
}

interface UserMtbf { // Updated interface for user-based MTBF
    userId: string;
    userName: string;
    mtbfHours: number | null;
}

interface FilterOption { // Generic interface for filter dropdowns
    id: string;
    name: string;
}

interface StatusCount { // Interface for status counts
    name: string; // Status name
    value: number; // Count
}

// Fetcher function for React Query
const fetchDashboardStats = async (): Promise<DashboardStats> => {
  const { data } = await axios.get<DashboardStats>('/api/reports/dashboard-stats');
  return data;
};

// Fetcher function for Weekly Usage
const fetchWeeklyUsage = async (): Promise<DailyUsage[]> => {
  const { data } = await axios.get<DailyUsage[]>('/api/reports/weekly-usage');
  return data;
};

const fetchMttrData = async (): Promise<EquipmentMaintenanceStats[]> => {
    const { data } = await axios.get<EquipmentMaintenanceStats[]>('/api/reports/mttr');
    return data;
};

const fetchMtbfData = async (): Promise<UserMtbf[]> => { // Expect UserMtbf[] now
    const { data } = await axios.get<UserMtbf[]>('/api/reports/mtbf');
    return data;
};

const fetchCourses = async (): Promise<FilterOption[]> => {
    const { data } = await axios.get<FilterOption[]>('/api/reports/filters/courses');
    return data;
};

const fetchFics = async (): Promise<FilterOption[]> => {
    const { data } = await axios.get<FilterOption[]>('/api/reports/filters/fics');
    return data;
};

const fetchEquipment = async (): Promise<FilterOption[]> => {
    const { data } = await axios.get<FilterOption[]>('/api/reports/filters/equipment');
    return data;
};

const fetchEquipmentStatusCounts = async (): Promise<StatusCount[]> => {
    const { data } = await axios.get<StatusCount[]>('/api/reports/equipment-status-counts');
    return data;
};

// Report Types Enum
enum ReportType {
    BORROWING_ACTIVITY = 'borrowing_activity',
    EQUIPMENT_UTILIZATION = 'equipment_utilization',
    DEFICIENCY_SUMMARY = 'deficiency_summary',
    SYSTEM_USAGE = 'system_usage',
}

// Define colors for Pie Chart
const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

export default function ReportsPage() {
  // Use React Query to fetch data
  const { data: stats, isLoading: isLoadingStats, isError: isErrorStats, error: errorStats } = useQuery<DashboardStats, Error>({
    queryKey: ['dashboardStats'], // Unique key for this query
    queryFn: fetchDashboardStats,
  });

  // Query for Weekly Usage Chart Data
  const {
    data: weeklyUsageData,
    isLoading: isLoadingUsage,
    isError: isErrorUsage,
    error: errorUsage
  } = useQuery<DailyUsage[], Error>({
    queryKey: ['weeklyUsage'],
    queryFn: fetchWeeklyUsage,
  });

  const { data: mttrData, isLoading: isLoadingMttr, isError: isErrorMttr, error: errorMttr }
    = useQuery<EquipmentMaintenanceStats[], Error>({
      queryKey: ['mttrData'],
      queryFn: fetchMttrData,
    });

  const { data: mtbfData, isLoading: isLoadingMtbf, isError: isErrorMtbf, error: errorMtbf }
    = useQuery<UserMtbf[], Error>({ // Use UserMtbf[] type
      queryKey: ['mtbfData'], // Keep query key, or change if desired
      queryFn: fetchMtbfData,
    });

  // Hooks for filter data
  const { data: courses, isLoading: isLoadingCourses } = useQuery<FilterOption[], Error>({ queryKey: ['reportFilterCourses'], queryFn: fetchCourses });
  const { data: fics, isLoading: isLoadingFics } = useQuery<FilterOption[], Error>({ queryKey: ['reportFilterFics'], queryFn: fetchFics });
  const { data: equipment, isLoading: isLoadingEquipment } = useQuery<FilterOption[], Error>({ queryKey: ['reportFilterEquipment'], queryFn: fetchEquipment });

  const { data: statusCounts, isLoading: isLoadingStatusCounts, isError: isErrorStatusCounts, error: errorStatusCounts }
    = useQuery<StatusCount[], Error>({
        queryKey: ['equipmentStatusCounts'],
        queryFn: fetchEquipmentStatusCounts,
    });

  // Calculate Overall Average MTTR and Avg Maintenance Duration
  const maintenanceAverages = useMemo(() => {
    if (!mttrData || mttrData.length === 0) return { avgMttr: null, avgMaintenance: null };
    
    const validMttrs = mttrData.filter(item => item.mttrHours !== null);
    const sumMttr = validMttrs.reduce((acc, item) => acc + item.mttrHours!, 0);
    const avgMttr = validMttrs.length > 0 ? parseFloat((sumMttr / validMttrs.length).toFixed(1)) : null;

    // Calculate average of the totalMaintenanceHours across all equipment
    const sumMaintenance = mttrData.reduce((acc, item) => acc + item.totalMaintenanceHours, 0);
    const avgMaintenance = mttrData.length > 0 ? parseFloat((sumMaintenance / mttrData.length).toFixed(1)) : null;

    return { avgMttr, avgMaintenance };

  }, [mttrData]);

  // Calculate Overall Average MTBF (using UserMtbf data)
  const overallAverageMtbf = React.useMemo(() => {
    if (!mtbfData || mtbfData.length === 0) return null;
    // Filter users who have a calculated MTBF (i.e., >= 2 mishandles)
    const validMtbfs = mtbfData.filter(item => item.mtbfHours !== null);
    if (validMtbfs.length === 0) return null;
    // Average the MTBF hours across those users
    const sum = validMtbfs.reduce((acc, item) => acc + item.mtbfHours!, 0);
    return parseFloat((sum / validMtbfs.length).toFixed(1));
  }, [mtbfData]);

  // --- State for Report Filters ---
  const [reportType, setReportType] = useState<ReportType | undefined>();
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [selectedCourse, setSelectedCourse] = useState<string>('all'); // Default to 'all'
  const [selectedFic, setSelectedFic] = useState<string>('all'); // Default to 'all'
  const [selectedEquipment, setSelectedEquipment] = useState<string>('all'); // Default to 'all'

  // --- Event Handlers ---
  const handleGenerateCsv = () => {
      if (!reportType) {
          alert("Please select a report type first.");
          return;
      }

      // Construct query parameters
      const params = new URLSearchParams({
          reportType: reportType,
          format: 'csv',
      });

      if (dateRange?.from) {
          params.append('startDate', formatDateFns(dateRange.from, 'yyyy-MM-dd'));
      }
      if (dateRange?.to) {
          params.append('endDate', formatDateFns(dateRange.to, 'yyyy-MM-dd'));
      }
      if (selectedCourse !== 'all') {
          params.append('courseId', selectedCourse);
      }
      if (selectedFic !== 'all') {
          params.append('ficId', selectedFic);
      }
      if (selectedEquipment !== 'all') {
          params.append('equipmentId', selectedEquipment);
      }
      // Add other filters to params as needed

      const apiUrl = `/api/reports/generate?${params.toString()}`;
      console.log("Requesting CSV report:", apiUrl);

      // Trigger download by navigating to the API URL
      window.open(apiUrl, '_blank');
      // Alternatively, could use fetch to get the blob and create a download link,
      // but window.open is simpler for GET requests returning Content-Disposition.
  };

  const handleGeneratePdf = () => {
      if (!reportType) {
          alert("Please select a report type first.");
          return;
      }

      // Construct query parameters
      const params = new URLSearchParams({
          reportType: reportType,
          format: 'pdf', // Request PDF format
      });

      if (dateRange?.from) {
          params.append('startDate', formatDateFns(dateRange.from, 'yyyy-MM-dd'));
      }
      if (dateRange?.to) {
          params.append('endDate', formatDateFns(dateRange.to, 'yyyy-MM-dd'));
      }
      if (selectedCourse !== 'all') {
          params.append('courseId', selectedCourse);
      }
      if (selectedFic !== 'all') {
          params.append('ficId', selectedFic);
      }
      if (selectedEquipment !== 'all') {
          params.append('equipmentId', selectedEquipment);
      }

      const apiUrl = `/api/reports/generate?${params.toString()}`;
      console.log("Requesting PDF report:", apiUrl);

      // Trigger download
      window.open(apiUrl, '_blank');
  };

  return (
      <div className="p-4 md:p-6 space-y-8">
          <h1 className="text-3xl font-bold text-white mb-6">Reports & Analytics</h1>
          {/* Section 1: Analytics Dashboard */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">Analytics Dashboard</h2>
            <p className="text-muted-foreground mb-6">
              Overview of key equipment and usage metrics.
            </p>

            {/* Loading State */}
            {isLoadingStats && (
                <div className="flex justify-center items-center h-40">
                     <LoadingSpinner />
                 </div>
             )}

            {/* Error State */}
            {isErrorStats && (
                <div className="flex flex-col items-center justify-center h-40 p-4 bg-destructive/10 rounded-md border border-destructive text-destructive">
                     <AlertTriangle className="w-8 h-8 mb-2" />
                     <p className="font-semibold">Failed to load dashboard data</p>
                     <p className="text-sm">{errorStats?.message ?? 'An unexpected error occurred.'}</p>
                 </div>
             )}

             {/* Success State - Display Data */}
            {stats && !isLoadingStats && !isErrorStats && (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Usage Rate</CardTitle>
                    {/* Icon placeholder */}
                    </CardHeader>
                    <CardContent>
                    <div className="text-2xl font-bold">{stats.equipmentUsageRate}%</div>
                    <p className="text-xs text-muted-foreground">
                        Overall equipment utilization
                    </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Contact Hours</CardTitle>
                    {/* Icon placeholder */}
                    </CardHeader>
                    <CardContent>
                    <div className="text-2xl font-bold">{stats.contactHours}</div>
                    <p className="text-xs text-muted-foreground">
                        Total student contact hours
                    </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Most Borrowed</CardTitle>
                    {/* Icon placeholder */}
                    </CardHeader>
                    <CardContent>
                    <div className="text-2xl font-bold truncate">{stats.mostBorrowed}</div>
                    <p className="text-xs text-muted-foreground">
                        Highest demand item
                    </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Availability Rate</CardTitle>
                    {/* Icon placeholder */}
                    </CardHeader>
                    <CardContent>
                    <div className="text-2xl font-bold">{stats.availabilityRate}%</div>
                    <p className="text-xs text-muted-foreground">
                        Equipment ready for borrowing
                    </p>
                    </CardContent>
                </Card>
                </div>
            )}

            {/* Weekly Usage Chart - Updated Title/Desc */}
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Borrow Hours by Return Day (Last 7 Days)</CardTitle>
                <CardDescription>Sum of total duration (hours) for borrows completed on each day.</CardDescription>
              </CardHeader>
              <CardContent className="h-[300px]">
                {isLoadingUsage && (
                  <div className="flex justify-center items-center h-full">
                    <LoadingSpinner />
                  </div>
                )}
                {isErrorUsage && (
                  <div className="flex flex-col items-center justify-center h-full text-destructive">
                    <AlertTriangle className="w-6 h-6 mb-2" />
                    <p>Failed to load usage data</p>
                    <p className="text-xs">{errorUsage?.message}</p>
                  </div>
                )}
                {weeklyUsageData && !isLoadingUsage && !isErrorUsage && (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weeklyUsageData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted))"/>
                        <XAxis 
                            dataKey="name" 
                            stroke="hsl(var(--muted-foreground))" 
                            fontSize={12}
                        />
                        <YAxis 
                            stroke="hsl(var(--muted-foreground))" 
                            fontSize={12}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(value) => `${value}h`}
                        />
                        <Tooltip 
                            cursor={{ fill: 'hsl(var(--accent))' }} 
                            contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)' }}
                            labelStyle={{ color: 'hsl(var(--popover-foreground))' }}
                        />
                        <Bar dataKey="hours" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Equipment Status Chart Card */}
            <Card className="mt-6">
                <CardHeader>
                    <CardTitle>Current Equipment Status</CardTitle>
                    <CardDescription>Distribution of equipment across different statuses.</CardDescription>
                </CardHeader>
                <CardContent className="h-[300px]">
                    {isLoadingStatusCounts && (
                        <div className="flex justify-center items-center h-full"><LoadingSpinner /></div>
                    )}
                    {isErrorStatusCounts && (
                        <div className="flex flex-col items-center justify-center h-full text-destructive">
                            <AlertTriangle className="w-6 h-6 mb-2" />
                            <p>Failed to load status data</p>
                        </div>
                    )}
                    {statusCounts && !isLoadingStatusCounts && !isErrorStatusCounts && (
                         <ResponsiveContainer width="100%" height="100%">
                             <PieChart>
                                <Pie
                                    data={statusCounts}
                                    cx="50%"
                                    cy="50%"
                                    labelLine={false}
                                    // label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                                    outerRadius={80}
                                    fill="#8884d8"
                                    dataKey="value"
                                    nameKey="name"
                                >
                                    {statusCounts.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(value) => `${value} items`} />
                                <PieLegend />
                             </PieChart>
                         </ResponsiveContainer>
                    )}
                     {!isLoadingStatusCounts && !isErrorStatusCounts && (!statusCounts || statusCounts.length === 0) && (
                         <div className="flex justify-center items-center h-full text-muted-foreground">
                             <p>No status data available.</p>
                         </div>
                     )}
                </CardContent>
            </Card>
          </section>
          {/* Section 2: Generate Reports */}
          <section>
           <h2 className="text-2xl font-semibold text-white mb-4">Generate Reports</h2>
           <p className="text-muted-foreground mb-6">
             Create and export detailed reports based on various criteria.
           </p>
            <Card>
              <CardHeader>
                <CardTitle>Report Generation</CardTitle>
                <CardDescription>Select filters and generate reports (PDF/CSV).</CardDescription>
              </CardHeader>
              <CardContent>
                {/* Row 1: Report Type and Date Range */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="reportType">Report Type</Label>
                        <Select 
                            value={reportType} 
                            onValueChange={(value) => setReportType(value as ReportType)}
                        >
                            <SelectTrigger id="reportType">
                                <SelectValue placeholder="Select report type..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ReportType.BORROWING_ACTIVITY}>Borrowing Activity</SelectItem>
                                <SelectItem value={ReportType.EQUIPMENT_UTILIZATION}>Equipment Utilization</SelectItem>
                                <SelectItem value={ReportType.DEFICIENCY_SUMMARY}>Deficiency Summary</SelectItem>
                                <SelectItem value={ReportType.SYSTEM_USAGE}>System Usage</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="dateRange">Date Range</Label>
                        <Popover>
                           <PopoverTrigger asChild>
                             <Button
                               id="dateRange"
                               variant={"outline"}
                               className={cn(
                                 "w-full justify-start text-left font-normal",
                                 !dateRange && "text-muted-foreground"
                               )}
                             >
                               <CalendarIcon className="mr-2 h-4 w-4" />
                               {dateRange?.from ? (
                                 dateRange.to ? (
                                   (<>
                                       {formatDateFns(dateRange.from, "LLL dd, y")}-{" "}
                                       {formatDateFns(dateRange.to, "LLL dd, y")}
                                   </>) // Use space instead of non-breaking if wrapping is ok
                                 ) : (
                                   formatDateFns(dateRange.from, "LLL dd, y")
                                 )
                               ) : (
                                 <span>Pick a date range</span>
                               )}
                             </Button>
                           </PopoverTrigger>
                           <PopoverContent className="w-auto p-0" align="start">
                             <Calendar
                               initialFocus
                               mode="range" // Correct mode for range selection
                               defaultMonth={dateRange?.from}
                               selected={dateRange} // Pass the DateRange state
                               onSelect={setDateRange} // Directly use the state setter
                               numberOfMonths={1}
                             />
                           </PopoverContent>
                         </Popover>
                    </div>
                </div>

                {/* Row 2: Conditional Filters */}
                {reportType && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-border">
                        <h3 className="md:col-span-3 text-sm font-medium text-muted-foreground">
                            Filters
                        </h3>

                        {/* Course Select (Only for Borrowing Activity, Deficiency Summary) */}
                        {(reportType === ReportType.BORROWING_ACTIVITY || reportType === ReportType.DEFICIENCY_SUMMARY) && (
                            <div className="space-y-2">
                                <Label htmlFor="filterCourse">Course</Label>
                                <Select 
                                    value={selectedCourse} 
                                    onValueChange={setSelectedCourse}
                                    disabled={isLoadingCourses || !courses || courses.length === 0}
                                >
                                    <SelectTrigger id="filterCourse">
                                        <SelectValue placeholder={isLoadingCourses ? "Loading..." : "All Courses"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Courses</SelectItem>
                                        {courses?.map((course) => (
                                            <SelectItem key={course.id} value={course.id}>{course.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {/* FIC Select (Only for Borrowing Activity) */}
                        {/* Deficiency doesn't easily link to FIC via borrow in current setup */} 
                        {(reportType === ReportType.BORROWING_ACTIVITY) && (
                            <div className="space-y-2">
                                <Label htmlFor="filterFic">Faculty-in-Charge</Label>
                                <Select 
                                    value={selectedFic} 
                                    onValueChange={setSelectedFic}
                                    disabled={isLoadingFics || !fics || fics.length === 0}
                                >
                                    <SelectTrigger id="filterFic">
                                        <SelectValue placeholder={isLoadingFics ? "Loading..." : "All FICs"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All FICs</SelectItem>
                                        {fics?.map((fic) => (
                                            <SelectItem key={fic.id} value={fic.id}>{fic.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        
                        {/* Equipment Select (Only for Borrowing Activity, Deficiency Summary, Equip Utilization) */}
                        {(reportType === ReportType.BORROWING_ACTIVITY || 
                          reportType === ReportType.DEFICIENCY_SUMMARY || 
                          reportType === ReportType.EQUIPMENT_UTILIZATION) && (
                            <div className="space-y-2">
                                <Label htmlFor="filterEquipment">Equipment</Label>
                                <Select 
                                    value={selectedEquipment} 
                                    onValueChange={setSelectedEquipment}
                                    disabled={isLoadingEquipment || !equipment || equipment.length === 0}
                                >
                                    <SelectTrigger id="filterEquipment">
                                        <SelectValue placeholder={isLoadingEquipment ? "Loading..." : "All Equipment"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Equipment</SelectItem>
                                        {equipment?.map((item) => (
                                            <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        
                        {/* Add placeholders or specific filters for System Usage if needed */}

                    </div>
                )}

                {/* Row 3: Action Buttons */}
                <div className="flex justify-end gap-2 pt-6 border-t border-border">
                    <Button variant="outline" onClick={handleGenerateCsv} disabled={!reportType}>
                        <Download className="mr-2 h-4 w-4" />
                        Generate CSV
                     </Button>
                    <Button variant="outline" onClick={handleGeneratePdf} disabled={!reportType}>
                        <Download className="mr-2 h-4 w-4" />
                        Generate PDF
                    </Button>
                </div>

              </CardContent>
            </Card>
          </section>
          {/* Section 3: Maintenance Analytics */}
          <section>
           <h2 className="text-2xl font-semibold text-white mb-4">Maintenance Analytics</h2>
           <p className="text-muted-foreground mb-6">
             Key maintenance performance indicators.
           </p>
           <div className="grid gap-4 md:grid-cols-3">
             <Card>
               <CardHeader>
                 <CardTitle>Mean Time Between Mishandles (User)</CardTitle>
                 <CardDescription>Avg. time between user mishandles (hours).</CardDescription>
               </CardHeader>
               <CardContent>
                   {isLoadingMtbf && <LoadingSpinner size="sm" />}
                   {isErrorMtbf && (
                       <div className="text-destructive text-sm flex items-center">
                           <AlertTriangle className="w-4 h-4 mr-1" /> Error loading MTBF
                       </div>
                   )}
                   {!isLoadingMtbf && !isErrorMtbf && (
                       <div className="text-2xl font-bold">
                           {overallAverageMtbf !== null ? `${overallAverageMtbf}h` : 'N/A'}
                       </div>
                   )}
                   <p className="text-xs text-muted-foreground">
                       Based on user MISHANDLING deficiencies.
                   </p>
               </CardContent>
             </Card>
             <Card>
               <CardHeader>
                 <CardTitle>Mean Time To Repair (MTTR)</CardTitle>
                 <CardDescription>Avg. repair duration per instance (hours).</CardDescription>
               </CardHeader>
               <CardContent>
                 {isLoadingMttr && <LoadingSpinner size="sm" />}
                 {isErrorMttr && (
                     <div className="text-destructive text-sm flex items-center">
                         <AlertTriangle className="w-4 h-4 mr-1" /> Error loading MTTR
                     </div>
                 )}
                 {!isLoadingMttr && !isErrorMttr && (
                     <div className="text-2xl font-bold">
                        {maintenanceAverages.avgMttr !== null ? `${maintenanceAverages.avgMttr}h` : 'N/A'}
                     </div>
                 )}
                  <p className="text-xs text-muted-foreground">
                    Based on Maintenance Log entries.
                  </p>
               </CardContent>
             </Card>
             
              {/* Average Maintenance Duration Card (New) */}
             <Card>
               <CardHeader>
                 <CardTitle>Avg. Maintenance Duration</CardTitle>
                 <CardDescription>Avg. total time in maintenance per item (hours).</CardDescription>
               </CardHeader>
               <CardContent>
                 {isLoadingMttr && <LoadingSpinner size="sm" />} 
                 {isErrorMttr && (
                     <div className="text-destructive text-sm flex items-center">
                         <AlertTriangle className="w-4 h-4 mr-1" /> Error loading data
                     </div>
                 )}
                 {!isLoadingMttr && !isErrorMttr && (
                     <div className="text-2xl font-bold">
                        {maintenanceAverages.avgMaintenance !== null ? `${maintenanceAverages.avgMaintenance}h` : 'N/A'}
                     </div>
                 )}
                  <p className="text-xs text-muted-foreground">
                    Based on Maintenance Log entries.
                  </p>
               </CardContent>
             </Card>

           </div>
         </section>
      </div>
  );
} 