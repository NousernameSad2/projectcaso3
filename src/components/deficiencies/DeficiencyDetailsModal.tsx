'use client';

import React from 'react';
import { 
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose 
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { format } from 'date-fns';
import { DeficiencyStatus } from '@prisma/client';
import { DeficiencyAdminView } from '@/app/(app)/deficiencies/columns'; // Adjust import path if needed
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";

// Helper function to get badge variant (similar to the one in columns/page)
const getDeficiencyStatusVariant = (status?: DeficiencyStatus): "default" | "destructive" | "success" | "secondary" | "outline" | "warning" => {
  if (!status) return "default";
  switch (status) {
    case DeficiencyStatus.UNRESOLVED: return "warning";
    case DeficiencyStatus.UNDER_REVIEW: return "secondary";
    case DeficiencyStatus.RESOLVED: return "success";
    default: return "default";
  }
};

interface DeficiencyDetailsModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  deficiency: DeficiencyAdminView | null;
}

const DetailItem: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => {
    if (value === null || value === undefined || value === '') return null;
    return (
        <div className="mb-3">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <div className="text-sm text-foreground break-words">{value}</div>
        </div>
    );
};

export default function DeficiencyDetailsModal({ 
    isOpen, 
    onOpenChange, 
    deficiency 
}: DeficiencyDetailsModalProps) {
    if (!deficiency) return null;

    const formattedStatus = deficiency.status.toLowerCase().replace(/_/g, ' ');
    const formattedType = deficiency.type.replace(/_/g, ' ');

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 capitalize">
                        Deficiency Details
                        <Badge variant={getDeficiencyStatusVariant(deficiency.status)} className="capitalize text-xs">
                            {formattedStatus}
                        </Badge>
                    </DialogTitle>
                    <DialogDescription>
                        ID: {deficiency.id}
                    </DialogDescription>
                </DialogHeader>
                
                <ScrollArea className="max-h-[60vh] pr-4 my-4">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
                        <DetailItem label="Status" value={<span className="capitalize font-medium">{formattedStatus}</span>} />
                        <DetailItem label="Type" value={<span className="capitalize font-medium">{formattedType}</span>} />
                        <DetailItem label="Equipment" value={`${deficiency.borrow.equipment.name} (${deficiency.borrow.equipment.equipmentId || 'N/A'})`} />
                        <DetailItem label="Borrow ID" value={deficiency.borrowId} />
                        <DetailItem label="User Responsible" value={`${deficiency.user.name} (${deficiency.user.email})`} />
                        <DetailItem label="Tagged By" value={deficiency.taggedBy?.name || 'N/A'} />
                        <DetailItem label="FIC to Notify" value={deficiency.ficToNotify?.name || 'N/A'} />
                        <DetailItem label="Created At" value={format(new Date(deficiency.createdAt), 'PPpp')} />
                        <DetailItem label="Last Updated At" value={format(new Date(deficiency.updatedAt), 'PPpp')} />
                    </div>
                    
                    <Separator className="my-4" />

                    <DetailItem label="Description" value={deficiency.description || '-'} />
                    <DetailItem label="Resolution Notes" value={deficiency.resolution || '-'} />
                </ScrollArea>
                
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="outline">Close</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
} 