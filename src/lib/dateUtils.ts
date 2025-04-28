import { startOfDay as dateFnsStartOfDay, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';

/**
 * Returns the start of a given day (00:00:00.000).
 * @param date - The date to get the start of.
 * @returns A new Date object representing the start of the day.
 */
export function startOfDay(date: Date): Date {
  return dateFnsStartOfDay(date);
}

/**
 * Combines the date part of a Date object with a time string (HH:MM).
 * @param date - The date object providing the year, month, and day.
 * @param timeString - The time string in HH:MM format (e.g., "14:30").
 * @returns A new Date object with the combined date and time, or the original date if timeString is invalid.
 */
export function combineDateAndTime(date: Date, timeString: string): Date {
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const match = timeString.match(timeRegex);

  if (!match) {
    console.error(`Invalid timeString format provided to combineDateAndTime: ${timeString}`);
    // Return the original date or throw an error, depending on desired behavior
    return date; 
  }

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  // Create a new date object to avoid mutating the original
  let newDate = new Date(date);
  newDate = setHours(newDate, hours);
  newDate = setMinutes(newDate, minutes);
  newDate = setSeconds(newDate, 0);
  newDate = setMilliseconds(newDate, 0);

  return newDate;
} 