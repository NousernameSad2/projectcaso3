'use client';

import React, { useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Equipment, EquipmentStatus as PrismaEquipmentStatus } from '@prisma/client'; // Renamed to avoid conflict
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
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
    case EquipmentStatus.UNDER_MAINTENANCE: return 'secondary';
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
  // Explicitly list fields from `Equipment` if your base `Equipment` type is minimal
  // For example: id, name, images, stockCount, status, equipmentId, condition etc.
}

export interface EquipmentCardProps {
  equipment: EquipmentWithAvailability;
  isSelected: boolean;
  onSelectToggle: (id: string) => void;
  isDateFilterActive: boolean;
  // Example: onReserveClick?: (equipmentId: string) => void;
}

export default function EquipmentCard({
  equipment,
  isSelected,
  onSelectToggle,
  isDateFilterActive,
  // onReserveClick
}: EquipmentCardProps) {
  // const router = useRouter(); // Uncomment if using router.push

  const { displayStatus, statusLabel, statusVariant } = useMemo(() => {
    const now = new Date();
    let currentDisplayStatus = equipment.status; // This is PrismaEquipmentStatus
    let label = equipment.status.replace(/_/g, ' '); // Basic formatting

    if (
      equipment.status === EquipmentStatus.RESERVED &&
      equipment.nextUpcomingReservationStart &&
      new Date(equipment.nextUpcomingReservationStart) > now
    ) {
      currentDisplayStatus = EquipmentStatus.AVAILABLE;
      label = `Available (Reserved from ${format(new Date(equipment.nextUpcomingReservationStart), 'MMM d, p')})`;
    } else if (equipment.status === EquipmentStatus.RESERVED) {
      label = 'Reserved';
    } else if (equipment.status === EquipmentStatus.BORROWED) {
      label = 'Borrowed';
    }
    // You can add more specific labels for other statuses here

    const variant = getEquipmentStatusVariant(currentDisplayStatus);
    return { displayStatus: currentDisplayStatus, statusLabel: label, statusVariant: variant };
  }, [equipment.status, equipment.nextUpcomingReservationStart]);

  const displayedStockInfo = useMemo(() => {
    if (isDateFilterActive && typeof equipment.availableUnitsInFilterRange === 'number') {
      if (equipment.availableUnitsInFilterRange > 0) {
        return `${equipment.availableUnitsInFilterRange} unit(s) available for selected dates`;
      }
      return "0 units available for selected dates";
    }

    if (displayStatus === EquipmentStatus.AVAILABLE) {
      return `${equipment.stockCount} unit(s) in stock`;
    }
    
    const isEffectivelyReservedOrBorrowed = 
      displayStatus === EquipmentStatus.BORROWED ||
      (displayStatus === EquipmentStatus.RESERVED && 
       !(equipment.nextUpcomingReservationStart && new Date(equipment.nextUpcomingReservationStart) > new Date()));

    if (isEffectivelyReservedOrBorrowed) {
      return "0 units currently available";
    }

    if (
      displayStatus === EquipmentStatus.UNDER_MAINTENANCE ||
      displayStatus === EquipmentStatus.DEFECTIVE ||
      displayStatus === EquipmentStatus.OUT_OF_COMMISSION
    ) {
      return "Currently unavailable";
    }
    return `${equipment.stockCount} total unit(s)`; // Fallback
  }, [
    equipment.stockCount,
    equipment.availableUnitsInFilterRange,
    isDateFilterActive,
    displayStatus,
    equipment.nextUpcomingReservationStart,
  ]);

  const canReserve = useMemo(() => {
    if (isDateFilterActive && typeof equipment.availableUnitsInFilterRange === 'number' && equipment.availableUnitsInFilterRange === 0) {
      return false;
    }
    // Check if item is in a state that generally prevents reservation
    const nonReservableStatus = 
      displayStatus === EquipmentStatus.BORROWED ||
      displayStatus === EquipmentStatus.UNDER_MAINTENANCE ||
      displayStatus === EquipmentStatus.DEFECTIVE ||
      displayStatus === EquipmentStatus.OUT_OF_COMMISSION ||
      (displayStatus === EquipmentStatus.RESERVED && 
       !(equipment.nextUpcomingReservationStart && new Date(equipment.nextUpcomingReservationStart) > new Date()));
    
    return !nonReservableStatus;
  }, [isDateFilterActive, equipment.availableUnitsInFilterRange, displayStatus, equipment.nextUpcomingReservationStart]);

  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.interactive-element')) {
      return;
    }
    // Example: router.push(`/equipment/${equipment.id}`);
  };

  const imageUrl = equipment.images && equipment.images.length > 0 
    ? equipment.images[0] 
    : '/images/placeholder-default.png'; // Adjust your placeholder path

  return (
    <Card 
      className={cn("overflow-hidden flex flex-col", isSelected && "ring-2 ring-primary")}
      // onClick={handleCardClick} // Optional: make whole card clickable
    >
      <CardHeader className="p-0 relative">
        <Link href={`/equipment/${equipment.id}`} passHref legacyBehavior>
          <a className="aspect-video w-full relative block cursor-pointer group">
            <Image
              src={imageUrl}
              alt={equipment.name}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover transition-transform group-hover:scale-105"
              priority={false}
            />
          </a>
        </Link>
        <div className="absolute top-2 right-2 interactive-element z-10">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onSelectToggle(equipment.id)}
            aria-label={`Select ${equipment.name}`}
            className="bg-background/70 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground border-border/50 hover:bg-background/90 transition-colors"
          />
        </div>
      </CardHeader>
      <CardContent className="p-4 flex-grow">
        <Link href={`/equipment/${equipment.id}`} passHref legacyBehavior>
            <a className="hover:underline">
                <CardTitle className="text-lg font-semibold line-clamp-2 mb-1" title={equipment.name}>
                    {equipment.name}
                </CardTitle>
            </a>
        </Link>
        {equipment.equipmentId && (
          <p className="text-xs text-muted-foreground mb-2">ID: {equipment.equipmentId}</p>
        )}
        <div className="mb-3">
          <Badge variant={statusVariant} className="text-xs capitalize whitespace-nowrap">
            {statusLabel}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground line-clamp-3" title={equipment.condition || 'No condition specified'}>
          {displayedStockInfo}
        </p>
      </CardContent>
      <CardFooter className="p-4 pt-0 flex justify-end gap-2">
        {/* The Reserve button could be here or handled by the BulkReservationModal trigger on the parent page */}
        {/* If you want a reserve button per card that triggers a single item reservation modal: */}
        {/*
        <Button 
            variant="outline" 
            size="sm"
            // onClick={() => onReserveClick && onReserveClick(equipment.id)}
            disabled={!canReserve}
            className="interactive-element"
           >
          Reserve
        </Button>
        */}
        <Button asChild size="sm" className="interactive-element">
          <Link href={`/equipment/${equipment.id}`}>View Details</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}