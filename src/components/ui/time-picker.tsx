'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface TimePickerProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string; // Expecting HH:MM format
  onValueChange: (value: string) => void;
}

export const TimePicker = React.forwardRef<HTMLInputElement, TimePickerProps>(
  ({ className, value, onValueChange, ...props }, ref) => {
    
    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        onValueChange(event.target.value);
    };

    return (
      <Input
        ref={ref}
        type="time"
        className={cn("w-[180px]", className)} // Basic styling
        value={value} 
        onChange={handleChange}
        step="900" // Optional: 15-minute intervals
        {...props}
      />
    );
  }
);
TimePicker.displayName = 'TimePicker'; 