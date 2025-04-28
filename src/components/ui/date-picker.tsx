"use client"

import * as React from "react"
import { format } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"
import { PopoverPortal } from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DatePickerProps {
  date: Date | undefined;
  setDate: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean | ((date: Date) => boolean); // Allow disabling dates
}

export function DatePicker({ date, setDate, placeholder = "Pick a date", disabled }: DatePickerProps) {
  // Re-add manual state for logging
  const [isOpen, setIsOpen] = React.useState(false); 

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={"outline"}
          className={cn(
            "w-full justify-start text-left font-normal", // Adjusted width
            !date && "text-muted-foreground"
          )}
          disabled={typeof disabled === 'boolean' ? disabled : false} // Disable button if boolean disabled
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, "PPP") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent 
          className="w-auto p-0 z-50" 
          onInteractOutside={(e) => {
            console.log("DatePicker: PopoverContent onInteractOutside fired");
            e.preventDefault();
          }}
          onClick={(e) => { 
            console.log("DatePicker: PopoverContent onClick fired");
            e.stopPropagation(); 
          }} 
        >
          <Calendar
            mode="single"
            selected={date}
            onSelect={(selectedDate) => {
              console.log("DatePicker: Calendar onSelect fired");
              setDate(selectedDate);
              setIsOpen(false);
            }}
            initialFocus
            disabled={disabled}
          />
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  )
} 