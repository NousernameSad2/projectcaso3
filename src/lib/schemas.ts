import { z } from "zod";
import { EquipmentCategory, EquipmentStatus, UserRole, UserStatus } from "@prisma/client";

export const RegistrationSchema = z.object({
  name: z.string().min(2, { message: "Name must be at least 2 characters." }),
  email: z.string().email({ message: "Please enter a valid email address." }),
  studentNumber: z.string().optional(), // Added - Optional for now
  contactNumber: z.string().optional(), // Added - Optional for now
  sex: z.enum(['Male', 'Female'], { errorMap: () => ({ message: 'Please select a valid sex.' }) }), // Added - Required enum
  password: z.string().min(8, { message: "Password must be at least 8 characters." }),
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match.",
  path: ["confirmPassword"], // Set the error path to confirmPassword
});

export type RegistrationInput = z.infer<typeof RegistrationSchema>;

// --- Add Login Schema --- 
export const LoginSchema = z.object({
  email: z.string().email({
    message: "Please enter a valid email address.",
  }),
  password: z.string().min(1, { // Password is required
    message: "Password is required.",
  }),
});

export type LoginInput = z.infer<typeof LoginSchema>;

// --- Add Equipment Schema ---
export const EquipmentSchema = z.object({
  name: z.string().min(3, { message: "Name must be at least 3 characters." }),
  equipmentId: z.string().optional(), // Optional user-defined ID
  // qrCodeValue: z.string().optional(), // Handle QR separately if needed
  category: z.nativeEnum(EquipmentCategory),
  condition: z.string().optional(),
  status: z.nativeEnum(EquipmentStatus),
  stockCount: z.coerce.number().int().min(0),
  purchaseCost: z.coerce.number().positive().optional().nullable(), // Coerce, allow null/optional
  // images: z.array(z.string().url()).optional(), // Handle image uploads separately
  // Add optional image URL field
  imageUrl: z.string()
    .refine((val) => {
      // Allow empty string or string starting with '/' or a valid URL
      if (val === '' || val.startsWith('/')) return true;
      try {
        new URL(val);
        return true;
      } catch {
        return false;
      }
    }, { message: "Must be a valid URL (https://...) or a root-relative path (/...)" })
    .optional()
    .or(z.literal('')),
});

export type EquipmentInput = z.infer<typeof EquipmentSchema>;

// --- Add Reservation Schema (Updated for DateTime) ---

// Define the base object schema
export const ReservationBaseSchema = z.object({
  equipmentIds: z.array(z.string().min(1)).min(1, { message: "At least one equipment item must be selected." }),
  requestedStartTime: z.coerce.date({ 
      required_error: "Start date and time are required.",
      invalid_type_error: "Invalid start date/time format."
  }),
  requestedEndTime: z.coerce.date({ 
      required_error: "End date and time are required.",
      invalid_type_error: "Invalid end date/time format."
  }),
  classId: z.string().min(1, { message: "Class selection is required."}), 
  // groupMates is handled separately now, removed from base for form
  groupMateIds: z.array(z.string()).optional(),
});

// Define the refined schema with the time check
export const ReservationSchema = ReservationBaseSchema.refine((data) => data.requestedEndTime > data.requestedStartTime, {
  message: "End time must be after start time.",
  path: ["requestedEndTime"], 
});

// Type for the full refined schema (including refine check)
export type ReservationInput = z.infer<typeof ReservationSchema>;

// --- Add Admin User Update Schema --- 
export const AdminUserUpdateSchema = z.object({
  name: z.string().min(2, { message: "Name must be at least 2 characters." }).optional(),
  email: z.string().email({ message: "Please enter a valid email address." }).optional(),
  role: z.nativeEnum(UserRole).optional(),
  status: z.nativeEnum(UserStatus).optional(),
  studentNumber: z.string().optional(), // Added optional studentNumber
  contactNumber: z.string().optional(), // Added optional contactNumber
  sex: z.enum(['Male', 'Female']).optional(), // Added optional sex
  // Password updates should likely be a separate process or require specific handling
  // password: z.string().min(8).optional(), 
});

export type AdminUserUpdateInput = z.infer<typeof AdminUserUpdateSchema>;

// --- Add Admin User Create Schema --- (Similar to Registration, but allows setting role/status directly)
export const AdminUserCreateSchema = z.object({
  name: z.string().min(2, { message: "Name must be at least 2 characters." }),
  email: z.string().email({ message: "Please enter a valid email address." }),
  password: z.string().min(8, { message: "Password must be at least 8 characters." }),
  role: z.nativeEnum(UserRole),
  status: z.nativeEnum(UserStatus),
  sex: z.enum(['Male', 'Female'], { errorMap: () => ({ message: 'Please select a valid sex if provided.' }) }).optional(),
  studentNumber: z.string().optional(), // Added optional studentNumber
  contactNumber: z.string().optional(), // Added optional contactNumber
});

export type AdminUserCreateInput = z.infer<typeof AdminUserCreateSchema>;

// --- Add Profile Update Schema --- 
export const ProfileUpdateSchema = z.object({
  name: z.string().min(2, { message: "Name must be at least 2 characters." }).optional(),
  studentNumber: z.string().optional(), 
  contactNumber: z.string().optional(),
  // Ensure sex is optional but still one of the allowed values if provided
  sex: z.enum(['Male', 'Female'], { errorMap: () => ({ message: 'Please select a valid sex.' }) }).optional(),
});

export type ProfileUpdateInput = z.infer<typeof ProfileUpdateSchema>;

// Schema for Changing Password

// Define the base object schema first
const ChangePasswordBaseSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters long"), // Enforce minimum length
  confirmPassword: z.string().min(1, "Please confirm your new password"),
});

// Apply refinement to the base schema
export const ChangePasswordSchema = ChangePasswordBaseSchema.refine((data) => data.newPassword === data.confirmPassword, {
  message: "New passwords do not match",
  path: ["confirmPassword"], // Set the error on the confirm password field
});

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

// Expose the base schema if needed elsewhere (like the API route)
export { ChangePasswordBaseSchema };

// Schema for Borrow Request Creation
export const BorrowRequestSchema = z.object({
  equipmentId: z.string({ required_error: "Equipment ID is required."}),
  // ... existing code ...
}); 