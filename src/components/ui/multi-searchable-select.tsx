"use client"

import * as React from "react"
import { Check, ChevronsUpDown, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Badge } from "./badge"

interface MultiSearchableSelectOption {
  value: string;
  label: string;
}

interface MultiSearchableSelectProps {
  options: MultiSearchableSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyStateMessage?: string;
  disabled?: boolean;
  className?: string;
}

export function MultiSearchableSelect({
  options,
  value = [],
  onChange,
  placeholder = "Select options...",
  searchPlaceholder = "Search...",
  emptyStateMessage = "No results found.",
  disabled,
  className,
}: MultiSearchableSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [inputValue, setInputValue] = React.useState("")

  const selectedOptions = options.filter((option) => value.includes(option.value));

  const handleSelect = (currentValue: string) => {
    if (value.includes(currentValue)) {
      onChange(value.filter((v) => v !== currentValue));
    } else {
      onChange([...value, currentValue]);
    }
    setInputValue("") // Clear search input on select
  };

  const handleRemove = (valToRemove: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent popover from opening/closing
    onChange(value.filter((v) => v !== valToRemove));
  };
  
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between h-auto", className)} 
          disabled={disabled}
          onClick={() => setOpen(!open)}
        >
          <div className="flex flex-wrap gap-1 items-center">
            {selectedOptions.length > 0 ? selectedOptions.map(option => (
              <Badge
                variant="secondary"
                key={option.value}
                className="mr-1"
              >
                {option.label}
                <X
                  className="ml-1 h-3 w-3 cursor-pointer"
                  onClick={(e) => handleRemove(option.value, e)}
                />
              </Badge>
            )) : placeholder}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput 
            placeholder={searchPlaceholder} 
            value={inputValue}
            onValueChange={setInputValue}
          />
          <CommandList className="overflow-y-auto max-h-60">
            <CommandEmpty>{emptyStateMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label} // CommandItem value is used for filtering
                  onSelect={() => {
                    handleSelect(option.value);
                    // Do not close popover on select to allow multiple selections
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value.includes(option.value) ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
} 