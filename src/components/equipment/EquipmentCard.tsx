'use client';

import React, { useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Equipment, EquipmentStatus as PrismaEquipmentStatus, EquipmentCategory } from '@prisma/client'; // Removed EquipmentCategory
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';
import { cn, transformGoogleDriveUrl } from '@/lib/utils';
import { Eye, BookOpen } from 'lucide-react'; // Removed ArrowRight, CalendarDays, CheckCircle, Info, Package, Slash, Wrench, XCircle
// import { useSession } from 'next-auth/react'; // Commented out useSession
// import { UserRole } from '@prisma/client'; // Removed UserRole
// import { 
//     Tooltip, 
//     TooltipContent, 
//     TooltipProvider, 
//     TooltipTrigger 
// } from "@/components/ui/tooltip"; // Removed Tooltip components
// import ReservationModal from "./ReservationModal"; // Removed ReservationModal
// If you use useRouter, uncomment the import:
// import { useRouter } from 'next/navigation';

// Using PrismaEquipmentStatus to avoid conflict if this file defines its own EquipmentStatus
const EquipmentStatus = PrismaEquipmentStatus;

// Helper function to get badge variant based on EquipmentStatus
// Replace with your actual implementation if it differs
const getEquipmentStatusVariant = (status: PrismaEquipmentStatus): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" => {
  switch (status) {
    case EquipmentStatus.AVAILABLE: return 'success';
    case EquipmentStatus.RESERVED: return 'warning';
    case EquipmentStatus.BORROWED: return 'destructive';
    case EquipmentStatus.UNDER_MAINTENANCE: return 'warning';
    case EquipmentStatus.DEFECTIVE: return 'destructive';
    case EquipmentStatus.OUT_OF_COMMISSION: return 'destructive';
    default: return 'outline';
  }
};

// Interface for the equipment data, ensuring all necessary fields are present
export interface EquipmentWithAvailability extends Equipment { // `Equipment` from prisma/client should have most fields
  // Ensure fields from the API not directly on Prisma's Equipment are here:
  _count: {
    borrowRecords: number;
  };
  nextUpcomingReservationStart: string | null;
  availableUnitsInFilterRange: number | null;
  activeBorrowCount: number;
  instrumentManualUrl: string | null; // MODIFIED: Type changed to string | null, and made non-optional
  // Explicitly list fields from `Equipment` if your base `Equipment` type is minimal
  // For example: id, name, images, stockCount, status, equipmentId, condition etc.
}

export interface EquipmentCardProps {
  equipment: EquipmentWithAvailability;
  isSelected: boolean;
  onSelectToggle: (id: string) => void;
  isDateFilterActive: boolean;
  canSelect: boolean;
  canManageEquipment: boolean;
}

export default function EquipmentCard({
  equipment,
  isSelected,
  onSelectToggle,
  isDateFilterActive,
  canSelect,
  canManageEquipment,
}: EquipmentCardProps) {
  // const { data: session } = useSession(); // Commented out session
  // const canReserve = equipment.status !== EquipmentStatus.OUT_OF_COMMISSION && equipment.status !== EquipmentStatus.DEFECTIVE; // Commented out canReserve

  const { displayStatus, statusLabel, statusVariant } = useMemo(() => {
    const now = new Date();
    const prismaStatus = equipment.status; // The actual status from the database
    const currentlyEffectivelyAvailableUnits = equipment.stockCount - equipment.activeBorrowCount;

    let derivedStatus: PrismaEquipmentStatus = prismaStatus;
    let detailedLabel: string = prismaStatus.replace(/_/g, ' '); // Default label

    // 1. Terminal statuses (these are definitive)
    if (
      prismaStatus === EquipmentStatus.UNDER_MAINTENANCE ||
      prismaStatus === EquipmentStatus.DEFECTIVE ||
      prismaStatus === EquipmentStatus.OUT_OF_COMMISSION ||
      prismaStatus === EquipmentStatus.ARCHIVED
    ) {
      derivedStatus = prismaStatus;
      detailedLabel = prismaStatus.replace(/_/g, ' ');
    } 
    // 2. All units are actively borrowed (ACTIVE or OVERDUE borrows)
    else if (currentlyEffectivelyAvailableUnits <= 0 && equipment.stockCount > 0) {
      derivedStatus = EquipmentStatus.BORROWED;
      detailedLabel = 'Borrowed (All units out)';
    } 
    // 3. Equipment has a future reservation, but some units are available NOW
    else if (
      prismaStatus === EquipmentStatus.RESERVED &&
      equipment.nextUpcomingReservationStart &&
      new Date(equipment.nextUpcomingReservationStart) > now &&
      currentlyEffectivelyAvailableUnits > 0
    ) {
      derivedStatus = EquipmentStatus.AVAILABLE; // Show as AVAILABLE for filtering
      detailedLabel = `Available (Reserved from ${format(new Date(equipment.nextUpcomingReservationStart), 'MMM d, p')})`;
    } 
    // 4. Equipment is RESERVED, and no units are effectively available NOW (either all reserved for now or borrowed)
    else if (prismaStatus === EquipmentStatus.RESERVED && currentlyEffectivelyAvailableUnits <= 0) {
      derivedStatus = EquipmentStatus.RESERVED;
      detailedLabel = 'Reserved (All units committed)';
    }
    // 5. Equipment is RESERVED, but some units ARE effectively available now (meaning the reservation is for a subset or future)
    // This case is largely covered by point 3 if reservation is future. If reservation is current for SOME units.
    else if (prismaStatus === EquipmentStatus.RESERVED && currentlyEffectivelyAvailableUnits > 0) {
        derivedStatus = EquipmentStatus.AVAILABLE; // If some are free NOW, it's effectively AVAILABLE for immediate interaction
        detailedLabel = `Available (Some units reserved)`; 
    }
    // 6. Equipment is marked AVAILABLE in DB, and units are effectively available.
    else if (prismaStatus === EquipmentStatus.AVAILABLE && currentlyEffectivelyAvailableUnits > 0) {
      derivedStatus = EquipmentStatus.AVAILABLE;
      detailedLabel = 'Available';
    }
    // 7. Fallback if DB says AVAILABLE but all units are out (e.g. active borrows not yet fully synced to status)
    // This is covered by point 2 already.

    // If after all this, derivedStatus is still, for example, RESERVED, but units are available,
    // we prefer to show AVAILABLE if the user can interact with it now.
    if (derivedStatus !== EquipmentStatus.BORROWED && 
        derivedStatus !== EquipmentStatus.UNDER_MAINTENANCE && 
        derivedStatus !== EquipmentStatus.DEFECTIVE && 
        derivedStatus !== EquipmentStatus.OUT_OF_COMMISSION && 
        derivedStatus !== EquipmentStatus.ARCHIVED && 
        currentlyEffectivelyAvailableUnits > 0) {
            // If it's not a terminal/borrowed state, and units are free, reflect that it's AVAILABLE
            // The detailedLabel will give context if there are upcoming reservations.
            if(derivedStatus === EquipmentStatus.RESERVED && equipment.nextUpcomingReservationStart && new Date(equipment.nextUpcomingReservationStart) > now){
                 // This is case 3, already handled.
            } else if (derivedStatus === EquipmentStatus.RESERVED) {
                detailedLabel = `Available (Some units reserved for now/later)`;
            }
            derivedStatus = EquipmentStatus.AVAILABLE;
    }

    const variant = getEquipmentStatusVariant(derivedStatus);
    return { displayStatus: derivedStatus, statusLabel: detailedLabel, statusVariant: variant };
  }, [
    equipment.status, 
    equipment.nextUpcomingReservationStart, 
    equipment.stockCount, 
    equipment.activeBorrowCount
  ]);

  const displayedStockInfo = useMemo(() => {
    const effectivelyAvailableNow = equipment.stockCount - equipment.activeBorrowCount;

    if (isDateFilterActive && typeof equipment.availableUnitsInFilterRange === 'number') {
      if (equipment.availableUnitsInFilterRange > 0) {
        return `${equipment.availableUnitsInFilterRange} unit(s) available for selected dates`;
      }
      return "0 units available for selected dates";
    }

    // Use the derived displayStatus for these checks
    if (displayStatus === EquipmentStatus.BORROWED) {
      return "0 units currently available (all out)";
    }
    if (
      displayStatus === EquipmentStatus.UNDER_MAINTENANCE ||
      displayStatus === EquipmentStatus.DEFECTIVE ||
      displayStatus === EquipmentStatus.OUT_OF_COMMISSION ||
      displayStatus === EquipmentStatus.ARCHIVED
    ) {
      return "Unavailable"; // More direct for terminal states
    }
    
    // If it's considered RESERVED by displayStatus, but all units are committed
    if (displayStatus === EquipmentStatus.RESERVED && effectivelyAvailableNow <= 0) {
        return "0 units currently available (all committed)";
    }

    // If it's displayStatus is AVAILABLE (which now has more nuanced logic)
    if (displayStatus === EquipmentStatus.AVAILABLE) {
        if (equipment.status === EquipmentStatus.RESERVED) { // DB is RESERVED but we show AVAILABLE
            return `${effectivelyAvailableNow} unit(s) currently available`; // Detailed label on badge gives reservation context
        } 
        return `${effectivelyAvailableNow} unit(s) currently available`;
    }
    
    // Fallback for displayStatus === EquipmentStatus.RESERVED (and some units are available)
    if (displayStatus === EquipmentStatus.RESERVED) {
        return `${effectivelyAvailableNow} unit(s) currently available (others reserved)`;
    }

    return `${equipment.stockCount} total unit(s)`; // Should be rare with new logic
  }, [
    equipment.stockCount,
    equipment.activeBorrowCount,
    equipment.availableUnitsInFilterRange,
    isDateFilterActive,
    displayStatus, // This is the derived status from the first useMemo
    equipment.status // Original DB status for comparison
  ]);

  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (canSelect && !(e.target as HTMLElement).closest('.interactive-element')) {
      onSelectToggle(equipment.id);
    }
  };

  const imageUrl = transformGoogleDriveUrl(equipment.images?.[0]) || "/images/placeholder-default.png";

  return (
    <Card 
      className={cn(
        "overflow-hidden flex flex-col h-full",
        canSelect && "cursor-pointer",
        isSelected && "ring-2 ring-primary shadow-lg"
      )}
      onClick={handleCardClick}
    >
      <CardHeader className="p-0 relative">
        {canManageEquipment ? (
          <Link href={`/equipment/${equipment.id}`} className="aspect-video w-full relative block group interactive-element" aria-label={`View details for ${equipment.name}`}>
            <div className="relative aspect-square w-full overflow-hidden">
              <Image
                src={imageUrl}
                alt={equipment.name}
                fill
                className="object-cover transition-transform duration-300 ease-in-out group-hover:scale-105"
                onError={(e) => {
                  if (e.currentTarget.src !== '/images/placeholder-default.png') {
                    e.currentTarget.srcset = '/images/placeholder-default.png';
                    e.currentTarget.src = '/images/placeholder-default.png';
                  }
                }}
              />
            </div>
          </Link>
        ) : (
          <div className="aspect-video w-full relative block">
            <div className="relative aspect-square w-full overflow-hidden">
              <Image
                src={imageUrl}
                alt={equipment.name}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                className="object-cover"
                priority={false}
                onError={(e) => {
                  if (e.currentTarget.src !== '/images/placeholder-default.png') {
                    e.currentTarget.srcset = '/images/placeholder-default.png';
                    e.currentTarget.src = '/images/placeholder-default.png';
                  }
                }}
              />
            </div>
          </div>
        )}
        {canSelect && (
          <div className="absolute top-2 right-2 interactive-element z-10">
            <Checkbox
              checked={isSelected}
              onClick={(e) => e.stopPropagation()}
              onCheckedChange={() => onSelectToggle(equipment.id)}
              aria-label={`Select ${equipment.name}`}
              className="bg-background/70 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground border-border/50 hover:bg-background/90 transition-colors"
            />
          </div>
        )}
      </CardHeader>
      <CardContent className="p-4 flex flex-col flex-grow">
        {canManageEquipment ? (
          <Link href={`/equipment/${equipment.id}`} className="hover:underline interactive-element mb-1" title={equipment.name}>
              <CardTitle className="text-lg font-semibold line-clamp-2">
                  {equipment.name}
              </CardTitle>
          </Link>
        ) : (
          <CardTitle className="text-lg font-semibold line-clamp-2 mb-1" title={equipment.name}>
              {equipment.name}
          </CardTitle>
        )}
        {equipment.equipmentId && (
          <p className="text-xs text-muted-foreground mb-3">ID: {equipment.equipmentId}</p>
        )}
        <div className="space-y-1.5 text-sm mt-1 flex-grow mb-3">
          <div className="flex items-center">
            <span className="font-medium text-muted-foreground w-[70px] shrink-0">Status:</span>
            <Badge variant={statusVariant} className="text-xs capitalize whitespace-nowrap">
              {statusLabel}
            </Badge>
          </div>
          <div className="flex items-start">
            <span className="font-medium text-muted-foreground w-[70px] shrink-0">Available:</span>
            <span className="text-foreground/90">{displayedStockInfo}</span>
          </div>
          <div className="flex items-center">
            <span className="font-medium text-muted-foreground w-[70px] shrink-0">Category:</span>
            <span className="text-foreground/90 capitalize">{(equipment.category || 'N/A').toLowerCase().replace(/_/g, ' ')}</span>
          </div>
          {equipment.condition && (
            <div className="flex items-start pt-1">
              <span className="font-medium text-muted-foreground w-[70px] shrink-0">Desc:</span>
              <p className="text-foreground/90 line-clamp-2" title={equipment.condition}> 
                {equipment.condition}
              </p>
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter className="p-4 pt-2 flex justify-between items-center">
        <div>
          {equipment.category === EquipmentCategory.INSTRUMENTS && equipment.instrumentManualUrl && (
            <Button asChild size="sm" variant="outline" className="interactive-element">
              <a href={equipment.instrumentManualUrl as string} target="_blank" rel="noopener noreferrer" title="View Instrument Manual">
                <BookOpen className="h-4 w-4" />
              </a>
            </Button>
          )}
        </div>
        {canManageEquipment ? (
          <Button asChild size="sm" className="interactive-element">
            <Link href={`/equipment/${equipment.id}`}>
              <Eye className="mr-2 h-4 w-4" />
              View Details
            </Link>
          </Button>
        ) : (
           <div className="h-9 w-full"></div>
        )}
      </CardFooter>
    </Card>
  );
}