import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Equipment, EquipmentStatus, EquipmentCategory, UserRole } from '@prisma/client'; // Use standard path
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox"; // Import Checkbox
import { cn } from "@/lib/utils"; // For conditional classes
import { useSession } from 'next-auth/react'; // Added useSession
import { toast } from 'sonner'; // Import toast
import { Eye } from 'lucide-react'; // Import Eye icon for View Details

// Define the structure of the _count object expected from the API
interface EquipmentWithCount extends Equipment {
  _count: {
    borrowRecords: number; // Note: This count includes ALL borrows, not just active.
  };
}

// Update props to expect the enhanced equipment type
interface EquipmentCardProps {
  equipment: EquipmentWithCount; 
  isSelected: boolean; // Add isSelected prop
  onSelectToggle: (id: string) => void; // Add callback for selection toggle
  onReservationSuccess?: () => void; // Add optional callback prop
}

// Helper function to get badge color based on status
const getStatusVariant = (status: EquipmentStatus): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" => {
  switch (status) {
    case EquipmentStatus.AVAILABLE:
      return "success"; // Assuming 'success' variant exists or is added
    case EquipmentStatus.BORROWED:
    case EquipmentStatus.RESERVED:
      return "secondary";
    case EquipmentStatus.UNDER_MAINTENANCE:
      return "warning"; // Assuming 'warning' variant exists or is added
    case EquipmentStatus.DEFECTIVE:
    case EquipmentStatus.OUT_OF_COMMISSION:
      return "destructive";
    default:
      return "default";
  }
};

// Helper function to format category names (optional)
const formatCategory = (category: EquipmentCategory) => {
  switch (category) {
    case EquipmentCategory.INSTRUMENTS: return 'Instruments';
    case EquipmentCategory.ACCESSORIES: return 'Accessories';
    case EquipmentCategory.TOOLS: return 'Tools';
    case EquipmentCategory.CONSUMABLES: return 'Consumables';
    case EquipmentCategory.OTHER: return 'Other';
    default: return category;
  }
};

// Helper function to format status text (optional, but good for consistency)
const formatStatusText = (status: EquipmentStatus) => {
  return status.toLowerCase().replace('_', ' ');
};

export default function EquipmentCard({
  equipment,
  isSelected,
  onSelectToggle,
  onReservationSuccess,
}: EquipmentCardProps) {
  const { data: session, status: sessionStatus } = useSession(); // Get session
  const imageUrl = equipment.images?.[0] || '/images/placeholder-default.png'; // Use first image or default
  
  // --- CORRECTED STATUS CALCULATION --- 
  // Rely directly on the equipment's status field managed by the backend.
  const effectiveStatus = equipment.status;
  // --- END CORRECTION ---

  // Get variant based on the calculated effective status
  const statusVariant = getStatusVariant(effectiveStatus);
  const isAvailable = effectiveStatus === EquipmentStatus.AVAILABLE;

  // Determine if the user can see details (not REGULAR)
  const canViewDetails = sessionStatus === 'authenticated' && !!session?.user && session.user.role !== UserRole.REGULAR;

  // Click handler for the entire card (for selection)
  const handleCardClick = () => {
    if (isAvailable) {
      onSelectToggle(equipment.id);
    } else {
      // Optional: Add a toast or visual feedback if clicking unavailable item for selection
      // toast.info("This item is currently unavailable for reservation.");
    }
  };
  
  // Prevent click propagation from interactive elements like the details button
  const stopPropagation = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    // Add onClick handler and conditional cursor to the Card
    <Card 
      className={cn(
        "overflow-hidden flex flex-col h-full bg-card/60 border-border/40 hover:border-border/80 transition-colors duration-200 relative",
        isAvailable && "cursor-pointer" 
      )}
      onClick={handleCardClick}
    >
      {/* Selection Checkbox - remains the same */}
      <div 
        className={cn(
          "absolute bottom-2 left-2 z-20 bg-background/80 p-1 rounded",
          !isAvailable && "opacity-50 cursor-not-allowed" 
        )}
        onClick={stopPropagation} // Prevent card click when clicking checkbox area
      >
        <Checkbox
          id={`select-${equipment.id}`}
          checked={isSelected}
          // Use onCheckedChange, but it effectively mirrors the card click logic
          onCheckedChange={() => { 
            // We could call handleCardClick here, or just let the card click handle it
            // Since the card click stops propagation from this area, we might not need this
            // but let's keep it for potential direct checkbox interaction if needed.
            handleCardClick(); 
          }}
          disabled={!isAvailable} 
          aria-label={`Select ${equipment.name}`}
          className={cn(!isAvailable && "cursor-not-allowed")} 
        />
      </div>

      {/* Remove Link and Div wrappers */}
      {/* Card content is now directly inside Card */}
      <CardHeader 
        className="p-0 relative aspect-video" 
        aria-hidden="true" // Hide from accessibility tree as card itself is focusable/clickable
      >
        <Image
          src={imageUrl}
          alt="" // Alt text handled by card level if needed, empty for decorative image part
          fill
          style={{ objectFit: 'cover' }}
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          priority={false}
          onError={(e) => { // Add basic error handling for image
            e.currentTarget.srcset = '/images/placeholder-default.png';
            e.currentTarget.src = '/images/placeholder-default.png';
          }}
        />
        <Badge variant={statusVariant} className="absolute top-2 right-2 z-10 capitalize">
          {formatStatusText(effectiveStatus)}
        </Badge>
      </CardHeader>
      <CardContent 
        className="p-4 flex-grow" 
        aria-hidden="true" // Hide from accessibility tree
      >
        <h3 className="font-semibold text-lg text-foreground mb-1 leading-tight">{equipment.name}</h3>
        <p className="text-sm text-muted-foreground mb-2 capitalize">
          {formatCategory(equipment.category)}
        </p>
        <p className="text-xs text-muted-foreground truncate" title={equipment.condition || 'No condition specified'}>
          Condition: {equipment.condition || 'N/A'}
        </p>
      </CardContent>

      {/* Keep CardFooter, remove ReservationModal, add View Details button */}
      <CardFooter className="p-4 pt-0 flex justify-end items-center mt-auto">
        {canViewDetails && (
          <Button 
            asChild 
            variant="outline" 
            size="sm"
            onClick={stopPropagation} // Prevent card click when clicking button
          >
            <Link href={`/equipment/${equipment.id}`} aria-label={`View details for ${equipment.name}`}>
               <Eye className="mr-2 h-4 w-4" /> View Details
            </Link>
          </Button>
        )}
        {/* Ensure footer has content or takes space if needed, add placeholder if button might not render? */}
        {!canViewDetails && <div className="h-9"></div>} {/* Placeholder to maintain height */} 
      </CardFooter>
    </Card>
  );
} 