import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const transformGoogleDriveUrl = (url: string | undefined | null): string => {
  if (!url) return ''; // Or a placeholder path

  if (url.includes('drive.google.com')) {
    // Standard shareable link: https://drive.google.com/file/d/FILE_ID/view?usp=sharing
    // Or folder link (less common for single images): https://drive.google.com/drive/folders/FOLDER_ID?usp=sharing
    // Or open link: https://drive.google.com/open?id=FILE_ID
    
    let fileId: string | null = null;

    if (url.includes('/file/d/')) {
      const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        fileId = match[1];
      }
    } else if (url.includes('open?id=')) {
      const match = url.match(/open\?id=([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        fileId = match[1];
      }
    }
    // Add more regex for other GDrive URL patterns if necessary

    if (fileId) {
      return `https://drive.google.com/uc?export=view&id=${fileId}`;
    }
    // If it's a GDrive link but we can't extract ID, return original or a specific placeholder.
    // Returning original for now, but this could be improved.
    return url; 
  }
  return url; // Not a Google Drive link, return as is
};
