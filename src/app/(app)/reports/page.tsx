'use client'; // Required for Recharts potentially

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'; // Assuming shadcn/ui path
import {
  ResponsiveContainer, Tooltip, PieChart, Pie, Cell, Legend as PieLegend // REMOVED BarChart, XAxis, YAxis, Legend, Bar, CartesianGrid
} from 'recharts'; // Example import
import { useQuery } from '@tanstack/react-query'; // Import useQuery
import axios from 'axios'; // Need axios or fetch for API calls
import LoadingSpinner from '@/components/ui/LoadingSpinner'; // Assuming a spinner component exists
import { AlertTriangle, Calendar as CalendarIcon, Download, Loader2, Wrench } from 'lucide-react'; // Icon for errors and new icons
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
import { format as formatDateFns, parseISO } from "date-fns"; // Added parseISO
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"; // Added Table components
import { Badge } from "@/components/ui/badge";
import { MultiSearchableSelect } from '@/components/ui/multi-searchable-select'; // NEW IMPORT FOR MULTISELECT

// Interface for the API response data
interface DashboardStats {
  contactHours: number;
  mostBorrowed: string;
  availabilityRate: number;
}

// Interface for the weekly usage chart data
// interface DailyUsage { // REMOVED
// name: string; // Day name (e.g., 'Mon')
// hours: number;
// }

interface FilterOption { // Generic interface for filter dropdowns
    id: string;
    name: string;
}

interface StatusCount { // Interface for status counts
    name: string; // Status name
    value: number; // Count
}

// --- NEW: Interface for Availability Metrics Data ---
interface AvailabilityMetricItem {
    id: string;
    name: string;
    equipmentId?: string | null;
    currentStatus: string; 
    totalUnavailabilityHours: number;
}
// --- END NEW ---

// --- NEW: Axios-like Error Type Definition ---
interface ApiErrorData {
  message?: string;
  error?: string;
}

interface AxiosLikeError extends Error {
  response?: {
    data?: ApiErrorData;
  };
}
// --- END NEW ---

// Fetcher function for React Query
const fetchDashboardStats = async (): Promise<DashboardStats> => {
  const { data } = await axios.get<DashboardStats>('/api/reports/dashboard-stats');
  return data;
};

// Fetcher function for Weekly Usage
// const fetchWeeklyUsage = async (): Promise<DailyUsage[]> => { // REMOVED
//   const { data } = await axios.get<DailyUsage[]>('/api/reports/weekly-usage');
//   return data;
// };

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

const fetchBorrowers = async (): Promise<FilterOption[]> => {
    const { data } = await axios.get<FilterOption[]>('/api/reports/filters/borrowers');
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
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Use React Query to fetch data
  const { data: stats, isLoading: isLoadingStats, isError: isErrorStats, error: errorStats } = useQuery<DashboardStats, Error>({
    queryKey: ['dashboardStats'], // Unique key for this query
    queryFn: fetchDashboardStats,
  });

  // Query for Weekly Usage Chart Data
  // const { // REMOVED All these related to weeklyUsageData
  //   data: weeklyUsageData,
  //   isLoading: isLoadingUsage,
  //   isError: isErrorUsage,
  //   error: errorUsage
  // } = useQuery<DailyUsage[], Error>({
  //   queryKey: ['weeklyUsage'],
  //   queryFn: fetchWeeklyUsage,
  // });

  // Hooks for filter data
  const { data: courses, isLoading: isLoadingCourses } = useQuery<FilterOption[], Error>({ queryKey: ['reportFilterCourses'], queryFn: fetchCourses });
  const { data: fics, isLoading: isLoadingFics } = useQuery<FilterOption[], Error>({ queryKey: ['reportFilterFics'], queryFn: fetchFics });
  const { data: equipment, isLoading: isLoadingEquipment } = useQuery<FilterOption[], Error>({ queryKey: ['reportFilterEquipment'], queryFn: fetchEquipment });
  const { data: borrowers, isLoading: isLoadingBorrowers } = useQuery<FilterOption[], Error>({ queryKey: ['reportFilterBorrowers'], queryFn: fetchBorrowers });

  const { data: statusCounts, isLoading: isLoadingStatusCounts, isError: isErrorStatusCounts /*, error: errorStatusCounts REMOVED */ }
    = useQuery<StatusCount[], Error>({
        queryKey: ['equipmentStatusCounts'],
        queryFn: fetchEquipmentStatusCounts,
    });

  // --- State for Report Filters ---
  const [reportType, setReportType] = useState<ReportType | undefined>();
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [selectedCourse, setSelectedCourse] = useState<string[]>([]); // Default to empty array for multi-select
  const [selectedFic, setSelectedFic] = useState<string[]>([]); // Default to empty array for multi-select
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([]); // Default to empty array for multi-select
  const [selectedBorrower, setSelectedBorrower] = useState<string[]>([]); // Default to empty array for multi-select
  const [selectedBorrowContext, setSelectedBorrowContext] = useState<string>('all'); // NEW STATE for borrow context filter
  const [selectedReturnStatus, setSelectedReturnStatus] = useState<string>('all'); // NEW STATE for return status filter
  const [selectedUtilizationClasses, setSelectedUtilizationClasses] = useState<string[]>([]); // NEW STATE for utilization classes filter

  // --- State for Live Report Preview ---
  const [liveReportData, setLiveReportData] = useState<Record<string, unknown>[] | null>(null);
  const [isLiveReportLoading, setIsLiveReportLoading] = useState<boolean>(false);
  const [liveReportError, setLiveReportError] = useState<Error | string | null>(null);
  const [activeReportTypeForDisplay, setActiveReportTypeForDisplay] = useState<ReportType | undefined>();

  // --- State for Contact Hours Calculator ---
  const [contactHoursEquipment, setContactHoursEquipment] = useState<string | undefined>();
  const [contactHoursDateRange, setContactHoursDateRange] = useState<DateRange | undefined>();
  const [calculatedContactHours, setCalculatedContactHours] = useState<number | null>(null);
  const [isCalculatingContactHours, setIsCalculatingContactHours] = useState<boolean>(false);
  const [contactHoursError, setContactHoursError] = useState<string | null>(null);

  // --- State for Utilization Ranking Table ---
  const [utilizationRankingData, setUtilizationRankingData] = useState<Record<string, unknown>[] | null>(null);
  const [isFetchingUtilizationRanking, setIsFetchingUtilizationRanking] = useState<boolean>(false);
  const [utilizationRankingError, setUtilizationRankingError] = useState<string | null>(null);
  const [utilizationRankingDateRange, setUtilizationRankingDateRange] = useState<DateRange | undefined>();

  // --- State for Maintenance Activity Report ---
  const [maintenanceActivityEquipmentId, setMaintenanceActivityEquipmentId] = useState<string | undefined>();
  const [maintenanceActivityDateRange, setMaintenanceActivityDateRange] = useState<DateRange | undefined>();
  const [maintenanceActivityData, setMaintenanceActivityData] = useState<Record<string, unknown>[] | null>(null);
  const [isMaintenanceActivityLoading, setIsMaintenanceActivityLoading] = useState<boolean>(false);
  const [maintenanceActivityError, setMaintenanceActivityError] = useState<string | null>(null);

  // --- NEW: State for Availability Metrics Table ---
  const [availabilityMetricsData, setAvailabilityMetricsData] = useState<AvailabilityMetricItem[] | null>(null);
  const [isFetchingAvailabilityMetrics, setIsFetchingAvailabilityMetrics] = useState<boolean>(false);
  const [availabilityMetricsError, setAvailabilityMetricsError] = useState<string | null>(null);
  // --- END NEW ---

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
      if (selectedCourse.length > 0) {
          selectedCourse.forEach(courseId => params.append('courseId', courseId));
      }
      if (selectedFic.length > 0) {
          selectedFic.forEach(ficId => params.append('ficId', ficId));
      }
      if (selectedEquipment.length > 0) {
          selectedEquipment.forEach(equipmentId => params.append('equipmentId', equipmentId));
      }
      if (selectedBorrower.length > 0) {
          selectedBorrower.forEach(borrowerId => params.append('borrowerId', borrowerId));
      }
      if (selectedBorrowContext !== 'all') {
          params.append('borrowContext', selectedBorrowContext);
      }
      if (selectedReturnStatus !== 'all') {
          params.append('returnStatus', selectedReturnStatus);
      }
      if (reportType === ReportType.EQUIPMENT_UTILIZATION && selectedUtilizationClasses.length > 0) {
        selectedUtilizationClasses.forEach(classId => params.append('classId', classId));
      }

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
      if (selectedCourse.length > 0) {
          selectedCourse.forEach(courseId => params.append('courseId', courseId));
      }
      if (selectedFic.length > 0) {
          selectedFic.forEach(ficId => params.append('ficId', ficId));
      }
      if (selectedEquipment.length > 0) {
          selectedEquipment.forEach(equipmentId => params.append('equipmentId', equipmentId));
      }
      if (selectedBorrower.length > 0) {
          selectedBorrower.forEach(borrowerId => params.append('borrowerId', borrowerId));
      }
      if (selectedBorrowContext !== 'all') {
          params.append('borrowContext', selectedBorrowContext);
      }
      if (selectedReturnStatus !== 'all') {
          params.append('returnStatus', selectedReturnStatus);
      }
      if (reportType === ReportType.EQUIPMENT_UTILIZATION && selectedUtilizationClasses.length > 0) {
        selectedUtilizationClasses.forEach(classId => params.append('classId', classId));
      }

      const apiUrl = `/api/reports/generate?${params.toString()}`;
      console.log("Requesting PDF report:", apiUrl);

      // Trigger download
      window.open(apiUrl, '_blank');
  };

  // --- Fetch Live Report Data ---
  const fetchAndDisplayLiveReport = useCallback(async () => {
    if (!reportType) {
        setLiveReportData(null);
        setActiveReportTypeForDisplay(undefined);
        return;
    }

    setIsLiveReportLoading(true);
    setLiveReportError(null);
    setLiveReportData(null); 

    const params = new URLSearchParams({
        reportType: reportType,
        format: 'json', 
    });

    if (dateRange?.from) params.append('startDate', formatDateFns(dateRange.from, 'yyyy-MM-dd'));
    if (dateRange?.to) params.append('endDate', formatDateFns(dateRange.to, 'yyyy-MM-dd'));
    
    // Conditionally append filters based on report type, mimicking generation logic
    // This ensures we only send relevant filters, though the API should also handle extras.
    switch (reportType) {
        case ReportType.BORROWING_ACTIVITY:
            if (selectedCourse.length > 0) {
                selectedCourse.forEach(courseId => params.append('courseId', courseId));
            }
            if (selectedFic.length > 0) {
                selectedFic.forEach(ficId => params.append('ficId', ficId));
            }
            if (selectedEquipment.length > 0) {
                selectedEquipment.forEach(equipmentId => params.append('equipmentId', equipmentId));
            }
            if (selectedBorrower.length > 0) {
                selectedBorrower.forEach(borrowerId => params.append('borrowerId', borrowerId));
            }
            if (selectedBorrowContext !== 'all') {
                params.append('borrowContext', selectedBorrowContext);
            }
            if (selectedReturnStatus !== 'all') {
                params.append('returnStatus', selectedReturnStatus);
            }
            break;
        case ReportType.EQUIPMENT_UTILIZATION:
            if (selectedEquipment.length > 0) {
                selectedEquipment.forEach(equipmentId => params.append('equipmentId', equipmentId));
            }
            if (selectedBorrowContext !== 'all') {
                params.append('borrowContext', selectedBorrowContext);
            }
            // Add classId filters for Equipment Utilization report type
            if (selectedUtilizationClasses.length > 0) {
                selectedUtilizationClasses.forEach(classId => params.append('classId', classId));
            }
            break;
        case ReportType.DEFICIENCY_SUMMARY:
            if (selectedCourse.length > 0) {
                selectedCourse.forEach(courseId => params.append('courseId', courseId));
            }
            if (selectedEquipment.length > 0) {
                selectedEquipment.forEach(equipmentId => params.append('equipmentId', equipmentId));
            }
            if (selectedBorrower.length > 0) {
                selectedBorrower.forEach(borrowerId => params.append('borrowerId', borrowerId));
            }
            if (selectedFic.length > 0) {
                selectedFic.forEach(ficId => params.append('ficId', ficId));
            }
            break;
        case ReportType.SYSTEM_USAGE:
            // System usage often doesn't use these specific item/course/fic filters
            break;
    }


    try {
        const response = await axios.get<Record<string, unknown>[]>(`/api/reports/generate?${params.toString()}`);
        if (response.data && Array.isArray(response.data) && response.data.length === 0) {
             setLiveReportData([]); 
        } else if (typeof response.data === 'string' && response.status === 200) { 
            // Handle cases where API might return a "no data" string with 200 OK for non-JSON formats
            // For JSON, we expect an empty array or actual data.
            // This primarily becomes relevant if the API's JSON "no data" response changes.
            // For now, a string response for format=json is treated as an issue or empty.
             setLiveReportData([]);
             console.warn("Received string data for JSON report, treating as no data:", response.data);
        } else if (response.data && Array.isArray(response.data)) {
            setLiveReportData(response.data);
        } else {
            // If response.data is not an array (e.g. error object from API but with 200 status)
            console.error("Unexpected data structure for live report:", response.data);
            setLiveReportData(null);
        }
        setActiveReportTypeForDisplay(reportType);
    } catch (error: unknown) {
        console.error("Error fetching live report:", error);
        const typedError = error as AxiosLikeError;
        const errorMsg = typedError.response?.data?.error || typedError.response?.data?.message || typedError.message || 'Failed to fetch live report';
        setLiveReportError(errorMsg);
        setLiveReportData(null);
    } finally {
        setIsLiveReportLoading(false);
    }
  }, [reportType, dateRange, selectedCourse, selectedFic, selectedEquipment, selectedBorrower, selectedBorrowContext, selectedReturnStatus, selectedUtilizationClasses]);

  // --- Calculate Contact Hours Handler ---
  const handleCalculateContactHours = async () => {
    if (!contactHoursEquipment || !contactHoursDateRange?.from || !contactHoursDateRange?.to) {
        setContactHoursError("Please select equipment and a full date range.");
        setCalculatedContactHours(null);
        return;
    }

    setIsCalculatingContactHours(true);
    setContactHoursError(null);
    setCalculatedContactHours(null);

    const params = new URLSearchParams({
        equipmentId: contactHoursEquipment,
        startDate: formatDateFns(contactHoursDateRange.from, 'yyyy-MM-dd'),
        endDate: formatDateFns(contactHoursDateRange.to, 'yyyy-MM-dd'),
    });

    try {
        const response = await axios.get<{ totalContactHours: number }>(`/api/reports/calculate-contact-hours?${params.toString()}`);
        setCalculatedContactHours(response.data.totalContactHours);
    } catch (error: unknown) {
        console.error("Error calculating contact hours:", error);
        const typedError = error as AxiosLikeError;
        const errorMsg = typedError.response?.data?.error || typedError.response?.data?.message || typedError.message || 'Failed to calculate contact hours';
        setContactHoursError(errorMsg);
        setCalculatedContactHours(null);
    } finally {
        setIsCalculatingContactHours(false);
    }
  };

  // --- Fetch Utilization Ranking Data ---
  const fetchUtilizationRanking = async (currentDateRange?: DateRange) => {
    setIsFetchingUtilizationRanking(true);
    setUtilizationRankingError(null);

    const params = new URLSearchParams();
    if (currentDateRange?.from) {
        params.append('startDate', formatDateFns(currentDateRange.from, 'yyyy-MM-dd'));
    }
    if (currentDateRange?.to) {
        params.append('endDate', formatDateFns(currentDateRange.to, 'yyyy-MM-dd'));
    }

    try {
        const response = await axios.get(`/api/reports/utilization-ranking?${params.toString()}`);
        setUtilizationRankingData(response.data);
    } catch (error: unknown) {
        console.error("Error fetching utilization ranking:", error);
        const typedError = error as AxiosLikeError;
        const errorMsg = typedError.response?.data?.error || typedError.response?.data?.message || typedError.message || 'Failed to fetch utilization ranking';
        setUtilizationRankingError(errorMsg);
        setUtilizationRankingData(null);
    } finally {
        setIsFetchingUtilizationRanking(false);
    }
  };

  // useEffect to fetch utilization ranking when date range changes or on initial load option
  useEffect(() => {
    fetchUtilizationRanking(utilizationRankingDateRange); // Fetch on initial load/date change
  }, [utilizationRankingDateRange]);

  // --- useEffect to Fetch Live Data on Filter Change (with debounce) ---
  useEffect(() => {
    const handler = setTimeout(() => {
        if (reportType) { 
            fetchAndDisplayLiveReport();
        } else {
            setLiveReportData(null); 
            setActiveReportTypeForDisplay(undefined);
            setLiveReportError(null);
        }
    }, 700); // Debounce by 700ms

    return () => {
        clearTimeout(handler);
    };
  }, [reportType, dateRange, selectedCourse, selectedFic, selectedEquipment, selectedBorrower, selectedBorrowContext, selectedReturnStatus, selectedUtilizationClasses, fetchAndDisplayLiveReport]);

  // --- Fetch Maintenance Activity Report ---
  const fetchMaintenanceActivityReport = useCallback(async () => {
    setIsMaintenanceActivityLoading(true);
    setMaintenanceActivityError(null);
    setMaintenanceActivityData(null);

    const params = new URLSearchParams();
    if (maintenanceActivityEquipmentId) {
        params.append('equipmentId', maintenanceActivityEquipmentId);
    }
    if (maintenanceActivityDateRange?.from) {
        params.append('startDate', formatDateFns(maintenanceActivityDateRange.from, 'yyyy-MM-dd'));
    }
    if (maintenanceActivityDateRange?.to) {
        params.append('endDate', formatDateFns(maintenanceActivityDateRange.to, 'yyyy-MM-dd'));
    }

    try {
        const response = await axios.get(`/api/reports/maintenance-activity?${params.toString()}`);
        if (response.data && Array.isArray(response.data) && response.data.length === 0) {
            setMaintenanceActivityData([]);
        } else if (typeof response.data === 'string' && response.status === 200) {
            setMaintenanceActivityData([]);
            console.warn("Received string data for maintenance activity report, treating as no data:", response.data);
        } else if (response.data && Array.isArray(response.data)) {
            setMaintenanceActivityData(response.data);
        } else {
            console.error("Unexpected data structure for maintenance activity report:", response.data);
            setMaintenanceActivityError(response.data?.message || response.data?.error || 'Unexpected data structure received.');
            setMaintenanceActivityData(null);
        }
    } catch (error: unknown) {
        console.error("Error fetching maintenance activity report:", error);
        const typedError = error as AxiosLikeError;
        const errorMsg = typedError.response?.data?.error || typedError.response?.data?.message || typedError.message || 'Failed to fetch maintenance activity report';
        setMaintenanceActivityError(errorMsg);
        setMaintenanceActivityData(null);
    } finally {
        setIsMaintenanceActivityLoading(false);
    }
  }, [maintenanceActivityEquipmentId, maintenanceActivityDateRange]);

  // useEffect for Maintenance Activity Report (triggers on filter change)
  useEffect(() => {
    fetchMaintenanceActivityReport();
  }, [maintenanceActivityEquipmentId, maintenanceActivityDateRange, fetchMaintenanceActivityReport]);

  // --- NEW: Fetch Availability Metrics ---
  const fetchAvailabilityMetrics = async () => {
    setIsFetchingAvailabilityMetrics(true);
    setAvailabilityMetricsError(null);
    try {
        const { data } = await axios.get<AvailabilityMetricItem[]>('/api/reports/availability-metrics');
        setAvailabilityMetricsData(data);
    } catch (err) {
        setAvailabilityMetricsError(err instanceof Error ? err.message : 'Failed to fetch availability metrics');
        setAvailabilityMetricsData(null);
    } finally {
        setIsFetchingAvailabilityMetrics(false);
    }
  };

  useEffect(() => {
    // Fetch utilization ranking on initial load or when its specific date range changes
    fetchUtilizationRanking(utilizationRankingDateRange);
    // Fetch maintenance activity report if equipment is selected
    if (maintenanceActivityEquipmentId) {
        fetchMaintenanceActivityReport();
    }
  }, [utilizationRankingDateRange, maintenanceActivityEquipmentId, fetchMaintenanceActivityReport]);

  // --- NEW: useEffect for fetching availability metrics on mount ---
  useEffect(() => {
    fetchAvailabilityMetrics();
  }, []); // Empty dependency array ensures it runs once on mount
  // --- END NEW ---

  return (
      <div className="p-4 md:p-6 space-y-8">
          <div className="mb-6">
            <h1 style={{ color: 'hsl(var(--foreground))' }} className="text-3xl font-bold">Reports & Analytics</h1>
            <p className="text-muted-foreground mt-1">
              View system analytics, generate reports, and gain insights into equipment usage.
            </p>
          </div>
          {/* Section 1: Analytics Dashboard */}
          <section>
            {/* <h2 className="text-2xl font-semibold text-white mb-4">Analytics Dashboard</h2>
            <p className="text-muted-foreground mb-6">
              Overview of key equipment and usage metrics.
            </p> */}

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
                {/* <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Contact Hours</CardTitle>
                    </CardHeader>
                    <CardContent>
                    <div className="text-2xl font-bold">{stats.contactHours}</div>
                    <p className="text-xs text-muted-foreground">
                        Total student contact hours
                    </p>
                    </CardContent>
                </Card> */}
                {/* <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Most Borrowed</CardTitle>
                    </CardHeader>
                    <CardContent>
                    <div className="text-2xl font-bold truncate">{stats.mostBorrowed}</div>
                    <p className="text-xs text-muted-foreground">
                        Highest demand item
                    </p>
                    </CardContent>
                </Card> */}
                {/* <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Availability Rate</CardTitle>
                    </CardHeader>
                    <CardContent>
                    <div className="text-2xl font-bold">{stats.availabilityRate}%</div>
                    <p className="text-xs text-muted-foreground">
                        Equipment ready for borrowing
                    </p>
                    </CardContent>
                </Card> */}
                </div>
            )}

            {/* Weekly Usage Chart - Updated Title/Desc */}
            {/* {isClient && (
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
            )} */}

            {/* Equipment Status Chart Card */}
            {isClient && (
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
            )}
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
                            <SelectTrigger id="reportType" className="w-full">
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
                                <MultiSearchableSelect
                                    value={selectedCourse}
                                    onChange={setSelectedCourse}
                                    options={courses?.map(course => ({ value: course.id, label: course.name })) || []}
                                    placeholder={isLoadingCourses ? "Loading..." : "Select courses..."}
                                    searchPlaceholder="Search courses..."
                                    emptyStateMessage="No courses found."
                                    disabled={isLoadingCourses || !courses || courses.length === 0}
                                    className="w-full"
                                />
                            </div>
                        )}

                        {/* FIC Select (Now for Borrowing Activity OR Deficiency Summary) */}
                        {(reportType === ReportType.BORROWING_ACTIVITY || reportType === ReportType.DEFICIENCY_SUMMARY) && (
                            <div className="space-y-2">
                                <Label htmlFor="filterFic">Faculty-in-Charge (Associated/To Notify)</Label>
                                <MultiSearchableSelect
                                    value={selectedFic}
                                    onChange={setSelectedFic}
                                    options={fics?.map(fic => ({ value: fic.id, label: fic.name })) || []}
                                    placeholder={isLoadingFics ? "Loading..." : "Search or select FICs..."}
                                    searchPlaceholder="Search FICs..."
                                    emptyStateMessage="No FICs found."
                                    disabled={isLoadingFics || !fics || fics.length === 0}
                                    className="w-full"
                                />
                            </div>
                        )}
                        
                        {/* Equipment Select (Only for Borrowing Activity, Deficiency Summary, Equip Utilization) */}
                        {(reportType === ReportType.BORROWING_ACTIVITY || 
                          reportType === ReportType.DEFICIENCY_SUMMARY || 
                          reportType === ReportType.EQUIPMENT_UTILIZATION) && (
                            <div className="space-y-2">
                                <Label htmlFor="filterEquipment">Equipment</Label>
                                <MultiSearchableSelect
                                    value={selectedEquipment}
                                    onChange={setSelectedEquipment}
                                    options={equipment?.map(item => ({ value: item.id, label: item.name })) || []}
                                    placeholder={isLoadingEquipment ? "Loading..." : "Search or select equipment..."}
                                    searchPlaceholder="Search equipment..."
                                    emptyStateMessage="No equipment found."
                                    disabled={isLoadingEquipment || !equipment || equipment.length === 0}
                                    className="w-full"
                                />
                            </div>
                        )}

                        {/* Borrower Select (Now for Borrowing Activity OR Deficiency Summary) - Label changed to User */}
                        {(reportType === ReportType.BORROWING_ACTIVITY || reportType === ReportType.DEFICIENCY_SUMMARY) && (
                            <div className="space-y-2">
                                <Label htmlFor="filterUser">User (Borrower/Tagged By/Responsible)</Label>
                                <MultiSearchableSelect
                                    value={selectedBorrower}
                                    onChange={setSelectedBorrower}
                                    options={borrowers?.map(user => ({ value: user.id, label: user.name })) || []}
                                    placeholder={isLoadingBorrowers ? "Loading..." : "Search or select users..."}
                                    searchPlaceholder="Search users..."
                                    emptyStateMessage="No users found."
                                    disabled={isLoadingBorrowers || !borrowers || borrowers.length === 0}
                                    className="w-full"
                                />
                            </div>
                        )}

                        {/* Borrow Context Filter (Only for Borrowing Activity OR Equipment Utilization) */} 
                        {(reportType === ReportType.BORROWING_ACTIVITY || reportType === ReportType.EQUIPMENT_UTILIZATION) && (
                            <div className="space-y-2">
                                <Label htmlFor="filterBorrowContext">Usage Context</Label>
                                <Select 
                                    value={selectedBorrowContext} 
                                    onValueChange={setSelectedBorrowContext}
                                >
                                    <SelectTrigger id="filterBorrowContext" className="w-full">
                                        <SelectValue placeholder="All Contexts" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Contexts</SelectItem>
                                        <SelectItem value="IN_CLASS">In Class</SelectItem>
                                        <SelectItem value="OUT_OF_CLASS">Out of Class</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {/* Return Status Filter (Only for Borrowing Activity) */} 
                        {reportType === ReportType.BORROWING_ACTIVITY && (
                            <div className="space-y-2">
                                <Label htmlFor="filterReturnStatus">Request Type</Label>
                                <Select 
                                    value={selectedReturnStatus} 
                                    onValueChange={setSelectedReturnStatus}
                                >
                                    <SelectTrigger id="filterReturnStatus" className="w-full">
                                        <SelectValue placeholder="All Statuses" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Statuses</SelectItem>
                                        <SelectItem value="Late">Late</SelectItem>
                                        <SelectItem value="Regular">Regular</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        
                        {/* Add placeholders or specific filters for System Usage if needed */}

                        {/* Class Select for Equipment Utilization */} 
                        {reportType === ReportType.EQUIPMENT_UTILIZATION && (
                            <div className="space-y-2">
                                <Label htmlFor="filterUtilizationClass">Class</Label>
                                <MultiSearchableSelect
                                    value={selectedUtilizationClasses}
                                    onChange={setSelectedUtilizationClasses}
                                    options={courses?.map(course => ({ value: course.id, label: course.name })) || []} // Re-use courses data
                                    placeholder={isLoadingCourses ? "Loading..." : "Select classes..."}
                                    searchPlaceholder="Search classes..."
                                    emptyStateMessage="No classes found."
                                    disabled={isLoadingCourses || !courses || courses.length === 0}
                                    className="w-full"
                                />
                            </div>
                        )}

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

          {/* Section for Live Report Preview - ADDED */}
          <section className="mt-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Live Report Preview</h2>
            {!reportType && (
                <Card>
                    <CardContent className="pt-6">
                        <p className="text-muted-foreground">Select a report type and filters above to see a live preview.</p>
                    </CardContent>
                </Card>
            )}
            {reportType && isLiveReportLoading && (
                <Card>
                    <CardContent className="pt-6 flex justify-center items-center h-40">
                        <LoadingSpinner />
                    </CardContent>
                </Card>
            )}
            {reportType && !isLiveReportLoading && liveReportError && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-destructive">Error Loading Preview</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-destructive-foreground">
                            {typeof liveReportError === 'string' ? liveReportError : (liveReportError as Error)?.message || 'An unexpected error occurred.'}
                        </p>
                    </CardContent>
                </Card>
            )}
            {reportType && !isLiveReportLoading && !liveReportError && liveReportData && (
                <Card>
                    <CardHeader>
                        <CardTitle>
                            Preview: {activeReportTypeForDisplay?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </CardTitle>
                        <CardDescription>
                            {liveReportData.length > 0 
                                ? `Showing ${liveReportData.length} record(s) based on current filters.`
                                : "No data found for the selected filters."}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {liveReportData.length > 0 ? (
                            <div className="h-[70vh] overflow-y-auto">
                                <RenderLiveReportTable data={liveReportData} reportType={activeReportTypeForDisplay!} />
                            </div>
                        ) : (
                            <p className="text-muted-foreground">No results to display for the current filter selection.</p>
                        )}
                    </CardContent>
                </Card>
            )}
          </section>
          {/* End of Live Report Preview Section */}

          {/* Section for Contact Hours Calculator - NEW */}
          <section className="mt-8">
            <Card>
                <CardHeader>
                    <CardTitle className="text-gray-900">Calculate Contact Hours for Equipment</CardTitle>
                    <CardDescription>Select specific equipment and a date range to calculate its total contact hours (sum of borrow durations).</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                        <div className="space-y-2 md:col-span-1">
                            <Label htmlFor="contactHoursEquipment">Equipment</Label>
                            <Select 
                                value={contactHoursEquipment} 
                                onValueChange={setContactHoursEquipment}
                                disabled={isLoadingEquipment || !equipment || equipment.length === 0} // Re-use existing equipment list and loading state
                            >
                                <SelectTrigger id="contactHoursEquipment" className="w-full">
                                    <SelectValue placeholder={isLoadingEquipment ? "Loading..." : "Select Equipment..."} />
                                </SelectTrigger>
                                <SelectContent>
                                    {equipment?.map((item) => (
                                        <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2 md:col-span-1">
                            <Label htmlFor="contactHoursDateRange">Date Range</Label>
                            <Popover>
                               <PopoverTrigger asChild>
                                 <Button
                                   id="contactHoursDateRange"
                                   variant={"outline"}
                                   className={cn(
                                     "w-full justify-start text-left font-normal",
                                     !contactHoursDateRange && "text-muted-foreground"
                                   )}
                                 >
                                   <CalendarIcon className="mr-2 h-4 w-4" />
                                   {contactHoursDateRange?.from ? (
                                     contactHoursDateRange.to ? (
                                       (<>
                                           {formatDateFns(contactHoursDateRange.from, "LLL dd, y")}-{" "}
                                           {formatDateFns(contactHoursDateRange.to, "LLL dd, y")}
                                       </>)
                                     ) : (
                                       formatDateFns(contactHoursDateRange.from, "LLL dd, y")
                                     )
                                   ) : (
                                     <span>Pick a date range</span>
                                   )}
                                 </Button>
                               </PopoverTrigger>
                               <PopoverContent className="w-auto p-0" align="start">
                                 <Calendar
                                   initialFocus
                                   mode="range"
                                   defaultMonth={contactHoursDateRange?.from}
                                   selected={contactHoursDateRange}
                                   onSelect={setContactHoursDateRange}
                                   numberOfMonths={1}
                                 />
                               </PopoverContent>
                             </Popover>
                        </div>

                        <div className="md:col-span-1">
                            <Button 
                                onClick={handleCalculateContactHours} 
                                disabled={isCalculatingContactHours || !contactHoursEquipment || !contactHoursDateRange?.from || !contactHoursDateRange?.to}
                                className="w-full"
                            >
                                {isCalculatingContactHours && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Calculate
                            </Button>
                        </div>
                    </div>

                    {contactHoursError && (
                        <p className="text-sm text-destructive">Error: {contactHoursError}</p>
                    )}

                    {calculatedContactHours !== null && !contactHoursError && (
                        <div className="pt-4">
                            <p className="text-lg font-semibold">
                                Total Contact Hours: <span className="text-primary">{calculatedContactHours.toFixed(1)} hours</span>
                            </p>
                        </div>
                    )}
                    {calculatedContactHours === null && !contactHoursError && !isCalculatingContactHours && (
                         <p className="text-sm text-muted-foreground">Enter equipment and date range then click calculate.</p>
                    )
                    }
                </CardContent>
            </Card>
          </section>
          {/* End of Contact Hours Calculator Section */}

          {/* Section for Utilization Ranking by Contact Hours - NEW */}
          <section className="mt-8">
            <Card>
                <CardHeader>
                    <CardTitle className="text-gray-900">Equipment Utilization Ranking (by Contact Hours)</CardTitle>
                    <CardDescription>
                        Ranking of equipment from most to least used based on total contact hours (sum of borrow durations).
                        Optionally, filter by date range.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2 md:w-1/3">
                        <Label htmlFor="utilizationRankingDateRange">Date Range (Optional)</Label>
                        <Popover>
                           <PopoverTrigger asChild>
                             <Button
                               id="utilizationRankingDateRange"
                               variant={"outline"}
                               className={cn(
                                 "w-full justify-start text-left font-normal",
                                 !utilizationRankingDateRange && "text-muted-foreground"
                               )}
                             >
                               <CalendarIcon className="mr-2 h-4 w-4" />
                               {utilizationRankingDateRange?.from ? (
                                 utilizationRankingDateRange.to ? (
                                   (<>
                                       {formatDateFns(utilizationRankingDateRange.from, "LLL dd, y")}-{" "}
                                       {formatDateFns(utilizationRankingDateRange.to, "LLL dd, y")}
                                   </>)
                                 ) : (
                                   formatDateFns(utilizationRankingDateRange.from, "LLL dd, y")
                                 )
                               ) : (
                                 <span>All Time / Pick a date range</span>
                               )}
                             </Button>
                           </PopoverTrigger>
                           <PopoverContent className="w-auto p-0" align="start">
                             <Calendar
                               initialFocus
                               mode="range"
                               defaultMonth={utilizationRankingDateRange?.from}
                               selected={utilizationRankingDateRange}
                               onSelect={(range) => {
                                   setUtilizationRankingDateRange(range);
                               }}
                               numberOfMonths={1}
                             />
                           </PopoverContent>
                         </Popover>
                         {utilizationRankingDateRange && (
                            <Button variant="outline" size="sm" onClick={() => setUtilizationRankingDateRange(undefined)} className="mt-1 text-xs">
                                Clear Date Range (Show All Time)
                            </Button>
                         )}
                    </div>

                    {isFetchingUtilizationRanking && (
                        <div className="flex justify-center items-center h-40"><LoadingSpinner /></div>
                    )}
                    {utilizationRankingError && (
                         <p className="text-sm text-destructive">Error: {utilizationRankingError}</p>
                    )}
                    {!isFetchingUtilizationRanking && !utilizationRankingError && utilizationRankingData && (
                        utilizationRankingData.length > 0 ? (
                            <div className="h-[70vh] overflow-y-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[80px]">Rank</TableHead>
                                            <TableHead>Equipment Name</TableHead>
                                            <TableHead className="text-right">Total Contact Hours</TableHead>
                                            <TableHead className="text-right">Borrow Count</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {utilizationRankingData.map((item, index) => (
                                            <TableRow key={item.equipmentId as React.Key}>
                                                <TableCell>{index + 1}</TableCell>
                                                <TableCell className="font-medium">{String(item.name)}</TableCell>
                                                <TableCell className="text-right">{(item.totalContactHours as number)?.toFixed(1)}</TableCell>
                                                <TableCell className="text-right">{String(item.borrowCount)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        ) : (
                            <p className="text-muted-foreground">No utilization data available for the selected period or no equipment found.</p>
                        )
                    )}
                </CardContent>
            </Card>
          </section>
          {/* End of Utilization Ranking Section */}

          {/* Section for Maintenance Activity Report - NEW */}
          <section className="mt-8">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Wrench className="h-6 w-6 text-gray-900" />
                  <CardTitle className="text-gray-900">Maintenance Activity Report</CardTitle>
                </div>
                <CardDescription>
                  View a log of maintenance activities for equipment, filterable by equipment and date range of maintenance start.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <div className="space-y-2">
                    <Label htmlFor="maintenanceActivityEquipment">Equipment (Optional)</Label>
                    <Select
                      value={maintenanceActivityEquipmentId || 'all'}
                      onValueChange={(value) => setMaintenanceActivityEquipmentId(value === 'all' ? undefined : value)}
                      disabled={isLoadingEquipment || !equipment || equipment.length === 0}
                    >
                      <SelectTrigger id="maintenanceActivityEquipment" className="w-full">
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

                  <div className="space-y-2">
                    <Label htmlFor="maintenanceActivityDateRange">Maintenance Start Date Range (Optional)</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          id="maintenanceActivityDateRange"
                          variant={"outline"}
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !maintenanceActivityDateRange && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {maintenanceActivityDateRange?.from ? (
                            maintenanceActivityDateRange.to ? (
                              <>
                                {formatDateFns(maintenanceActivityDateRange.from, "LLL dd, y")} - {" "}
                                {formatDateFns(maintenanceActivityDateRange.to, "LLL dd, y")}
                              </>
                            ) : (
                              formatDateFns(maintenanceActivityDateRange.from, "LLL dd, y")
                            )
                          ) : (
                            <span>Pick a date range</span>
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          initialFocus
                          mode="range"
                          defaultMonth={maintenanceActivityDateRange?.from}
                          selected={maintenanceActivityDateRange}
                          onSelect={setMaintenanceActivityDateRange}
                          numberOfMonths={1}
                        />
                      </PopoverContent>
                    </Popover>
                     {maintenanceActivityDateRange && (
                        <Button variant="outline" size="sm" onClick={() => setMaintenanceActivityDateRange(undefined)} className="mt-1 text-xs">
                            Clear Date Range
                        </Button>
                     )}
                  </div>
                  
                  <Button
                    onClick={() => fetchMaintenanceActivityReport()}
                    disabled={isMaintenanceActivityLoading}
                    className="w-full md:w-auto"
                  >
                    {isMaintenanceActivityLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Fetch Maintenance Report
                  </Button>
                </div>

                {isMaintenanceActivityLoading && (
                  <div className="flex justify-center items-center h-40"><LoadingSpinner /></div>
                )}
                {maintenanceActivityError && !isMaintenanceActivityLoading && (
                  <div className="flex flex-col items-center justify-center h-40 p-4 bg-destructive/10 rounded-md border border-destructive text-destructive">
                    <AlertTriangle className="w-8 h-8 mb-2" />
                    <p className="font-semibold">Error Fetching Maintenance Report</p>
                    <p className="text-sm">{maintenanceActivityError}</p>
                  </div>
                )}
                {!isMaintenanceActivityLoading && !maintenanceActivityError && maintenanceActivityData && (
                  maintenanceActivityData.length > 0 ? (
                    <div className="h-[70vh] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Equipment Name</TableHead>
                            <TableHead>Identifier</TableHead>
                            <TableHead>Maint. Start</TableHead>
                            <TableHead>Notes</TableHead>
                            <TableHead>Initiated By</TableHead>
                            <TableHead>Maint. End</TableHead>
                            <TableHead className="text-right">Duration (hrs)</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {maintenanceActivityData.map((item) => (
                            <TableRow key={`${item.equipmentId as string}-${item.maintenanceStartDate as string}`}>
                              <TableCell className="font-medium">{String(item.equipmentName)}</TableCell>
                              <TableCell>{String(item.equipmentIdentifier || 'N/A')}</TableCell>
                              <TableCell>{formatDateFns(item.maintenanceStartDate as string | Date, 'PP p')}</TableCell>
                              <TableCell className="max-w-xs truncate" title={String(item.maintenanceNotes || '')}>{String(item.maintenanceNotes || 'N/A')}</TableCell>
                              <TableCell>{String(item.initiatedBy || 'N/A')}</TableCell>
                              <TableCell>{item.maintenanceEndDate ? formatDateFns(item.maintenanceEndDate as string | Date, 'PP p') : 'N/A'}</TableCell>
                              <TableCell className="text-right">{(item.durationHours as number)?.toFixed(1) ?? 'N/A'}</TableCell>
                              <TableCell>
                                <Badge variant={(item.status as string) === 'Completed' ? 'success' : 'secondary'}>
                                  {String(item.status)}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="flex justify-center items-center h-40 text-muted-foreground">
                      <p>No maintenance activities found for the selected criteria.</p>
                    </div>
                  )
                )}
              </CardContent>
            </Card>
          </section>
          {/* End of Maintenance Activity Report Section */}

          {/* --- NEW: Equipment Availability Ranking --- */}
          <Card className="col-span-1 md:col-span-2 lg:col-span-3">
            <CardHeader>
              <CardTitle>Equipment Unavailability Ranking</CardTitle>
              <CardDescription>Equipment ranked by total time spent in unavailable states (Under Maintenance, Defective, Out of Commission).</CardDescription>
            </CardHeader>
            <CardContent>
              {isFetchingAvailabilityMetrics && (
                <div className="flex items-center justify-center p-6">
                  <Loader2 className="h-8 w-8 animate-spin mr-3" />
                  <span className="text-lg">Loading availability metrics...</span>
                </div>
              )}
              {availabilityMetricsError && (
                <div className="text-red-600 p-6 bg-red-50 rounded-md flex items-center">
                  <AlertTriangle className="h-6 w-6 mr-3" />
                  <span className="text-lg">Error: {availabilityMetricsError}</span>
                </div>
              )}
              {!isFetchingAvailabilityMetrics && !availabilityMetricsError && availabilityMetricsData && (
                <div className="h-[70vh] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[80px]">Rank</TableHead>
                        <TableHead>Equipment Name</TableHead>
                        <TableHead>Current Status</TableHead>
                        <TableHead className="text-right">Total Unavailability (Hours)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {availabilityMetricsData.length > 0 ? (
                        availabilityMetricsData.map((item, index) => (
                          <TableRow key={item.id}>
                            <TableCell>{index + 1}</TableCell>
                            <TableCell>{item.name}{item.equipmentId ? ` (${item.equipmentId})` : ''}</TableCell>
                            <TableCell><Badge variant={getBadgeVariantForStatus(item.currentStatus)}>{item.currentStatus}</Badge></TableCell>
                            <TableCell className="text-right">{item.totalUnavailabilityHours.toFixed(2)}</TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center">
                            No availability data found or all equipment has been fully available.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
              {!isFetchingAvailabilityMetrics && !availabilityMetricsError && !availabilityMetricsData && (
                 <div className="text-center p-6 text-gray-500">No data to display.</div>
              )}
            </CardContent>
          </Card>
          {/* --- END NEW --- */}
      </div>
  );
} 

// --- Helper Functions & Components for Live Report Table ---

// Helper to format date strings if they come as ISO strings or Date objects
const formatDateDisplay = (dateInput: string | Date | undefined | null): string => {
    if (!dateInput) return 'N/A';
    try {
        return formatDateFns(parseISO(dateInput.toString()), "PPpp"); // Format with time
    } catch { // REMOVED unused _
        // console.error("Error formatting date:", _error); // Optional: log the error
        return 'Invalid Date';
    }
};


interface ColumnDefinition {
    header: string;
    accessor: string | ((row: Record<string, unknown>) => unknown);
    render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode;
}

// Helper to get nested values, supporting dot notation and accessor functions
const getNestedValue = (obj: Record<string, unknown>, path: string | ((row: Record<string, unknown>) => unknown)): unknown => {
    if (typeof path === 'function') {
        try {
            return path(obj);
        } catch { // REMOVED unused _
            // console.error(`Error accessing path via function for object:`, obj, _err);
            return 'Error'; // Or some other placeholder for error
        }
    }
    return path.split('.').reduce((acc: Record<string, unknown> | undefined, part: string) => { // Changed any to unknown
        if (acc && typeof acc === 'object' && part in acc) {
            return acc[part] as Record<string, unknown> | undefined; // Changed any to unknown
        }
        return undefined;
    }, obj as Record<string, unknown>); // Changed any to unknown
};


const getColumnDefinitions = (reportType: ReportType): ColumnDefinition[] => {
    switch (reportType) {
        case ReportType.BORROWING_ACTIVITY:
            return [
                { header: 'Borrower', accessor: (row) => (row.borrower as Record<string, unknown>)?.name },
                { header: 'Equipment', accessor: (row) => (row.equipment as Record<string, unknown>)?.name },
                { 
                    header: 'Class', 
                    accessor: (row) => {
                        const classInfo = row.class as Record<string, unknown> | null;
                        if (!classInfo) return 'N/A';
                        return `${classInfo.courseCode || ''} ${classInfo.section || ''} (${classInfo.semester || ''} ${classInfo.academicYear || ''})`.replace(/\(\s*\)/g, '').trim() || 'N/A';
                    }
                },
                { header: 'Usage Context', accessor: 'reservationType', render: (val: unknown) => {
                    if (val === 'IN_CLASS') return 'In Class';
                    if (val === 'OUT_OF_CLASS') return 'Out of Class';
                    return String(val || 'N/A');
                } },
                { header: 'Return Status', accessor: 'borrowStatus', render: (val: unknown) => {
                    const status = val as string;
                    if (status === 'OVERDUE') {
                        return <Badge variant="destructive">Late</Badge>;
                    } else if (['ACTIVE', 'COMPLETED', 'RETURNED'].includes(status)) {
                        return <Badge variant="success">Regular</Badge>;
                    }
                    // Fallback for any statuses not explicitly handled by "Late" or "Regular"
                    return <Badge variant="outline">{status || 'N/A'}</Badge>;
                } },
                { header: 'Borrow Status', accessor: 'borrowStatus' }, // Changed header from 'Status' to 'Borrow Status' for clarity
                { header: 'Requested', accessor: 'requestSubmissionTime', render: (val: unknown) => formatDateDisplay(val as string | Date) }, 
                { header: 'Checkout', accessor: 'checkoutTime', render: (val: unknown) => formatDateDisplay(val as string | Date) }, 
                { header: 'Returned', accessor: 'actualReturnTime', render: (val: unknown) => formatDateDisplay(val as string | Date) }, // Typed val
                { header: 'Approved By FIC', accessor: (row) => (row.approvedByFic as Record<string, unknown>)?.name },
            ];
        case ReportType.EQUIPMENT_UTILIZATION:
            return [
                // { header: 'Equipment ID', accessor: 'equipmentId' }, // Often redundant if name is present
                { header: 'Equipment Name', accessor: 'equipmentName' },
                { header: 'In Class/Out of Class', accessor: 'utilizationContext' },
                { header: 'Borrow Count', accessor: 'borrowCount' },
                { header: 'Total Usage (Hours)', accessor: 'totalUsageHours' },
            ];
        case ReportType.DEFICIENCY_SUMMARY:
            return [
                // @ts-expect-error TODO: Investigate why TS infers {} here despite explicit React.ReactNode and string return
                { header: 'Description', accessor: 'description', render: (val: unknown): React.ReactNode => val || 'N/A' },
                { header: 'Type', accessor: 'type' },
                { header: 'Status', accessor: 'status', 
                  render: (val: unknown) => { 
                    return <Badge variant={getBadgeVariantForStatus(val as string)}>{String(val)}</Badge>;
                  }
                },
                { header: 'User Responsible', accessor: (row) => (row.user as Record<string, unknown>)?.name }, 
                { header: 'Tagged By', accessor: (row) => (row.taggedBy as Record<string, unknown>)?.name }, 
                { header: 'Reported At', accessor: 'createdAt', render: (val: unknown) => formatDateDisplay(val as string | Date) }, 
                { header: 'Related Equipment', accessor: (row) => ((row.borrow as Record<string, { equipment?: Record<string, unknown> }>)?.equipment as Record<string, unknown>)?.name },
                { header: 'Related Borrow ID', accessor: (row) => (row.borrow as Record<string, unknown>)?.id },
            ];
        case ReportType.SYSTEM_USAGE:
            return [
                { header: 'Metric', accessor: 'metric' },
                { header: 'Value', accessor: 'value' },
            ];
        default:
            // Basic fallback for unknown report types
            return [{ header: 'Details', accessor: (row) => JSON.stringify(row) }];
    }
};

const RenderLiveReportTable: React.FC<{ data: Record<string, unknown>[]; reportType: ReportType }> = ({ data, reportType }) => {
    if (!data || data.length === 0) {
        return <p className="text-muted-foreground italic">No data available for this report configuration.</p>;
    }

    const columns = getColumnDefinitions(reportType);

    return (
        <div className="overflow-x-auto"> 
            <Table>
                <TableHeader>
                    <TableRow>
                        {columns.map((col) => <TableHead key={col.header}>{col.header}</TableHead>)}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {data.map((row, rowIndex) => (
                        <TableRow key={rowIndex}>
                            {columns.map((col, colIndex) => {
                                const value = getNestedValue(row, col.accessor);
                                return (
                                    <TableCell key={`${rowIndex}-${col.header}-${colIndex}`}>
                                        {col.render ? col.render(value, row) : (value === undefined || value === null ? 'N/A' : String(value))}
                                    </TableCell>
                                );
                            })}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
};

// Need to import parseISO from date-fns for the formatDateDisplay helper
// It's already imported if used elsewhere, but good to ensure.
// import { parseISO } from 'date-fns'; // Ensure this is imported at the top with other date-fns imports

// Helper function to determine badge variant based on equipment status
const getBadgeVariantForStatus = (status: string): "default" | "destructive" | "secondary" | "outline" | "warning" | "success" => {
    switch (status) {
        case 'AVAILABLE':
            return "success";
        case 'BORROWED':
        case 'RESERVED':
            return "secondary";
        case 'UNDER_MAINTENANCE':
            return "warning";
        case 'DEFECTIVE':
        case 'OUT_OF_COMMISSION':
            return "destructive";
        case 'ARCHIVED':
            return "outline";
        default:
            return "default";
    }
};
