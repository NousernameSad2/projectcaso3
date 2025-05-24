import { z } from "zod";
import { EquipmentCategory, EquipmentStatus, UserRole, UserStatus } from "@prisma/client";

export const RegistrationSchema = z.object({
  name: z.string().min(2, { message: "Name must be at least 2 characters." }),
  email: z.string().email({ message: "Please enter a valid email address." }),
  studentNumber: z.string().min(1, { message: "Student number is required." }),
  contactNumber: z.string().min(10, { message: "Contact number must be at least 10 digits." }),
  sex: z.enum(['Male', 'Female'], { errorMap: () => ({ message: 'Please select a valid sex.' }) }),
  password: z.string().min(8, { message: "Password must be at least 8 characters." }),
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match.",
  path: ["confirmPassword"],
});

export type RegistrationInput = z.infer<typeof RegistrationSchema>;

// --- Add Login Schema --- 
export const LoginSchema = z.object({
  email: z.string().email({
    message: "Please enter a valid email address.",
  }),
  password: z.string().min(1, {
    message: "Password is required.",
  }),
});

export type LoginInput = z.infer<typeof LoginSchema>;

// --- Add Equipment Schema ---
export const EquipmentSchema = z.object({
  name: z.string().min(3, { message: "Name must be at least 3 characters." }),
  equipmentId: z.string().optional(),
  category: z.nativeEnum(EquipmentCategory),
  condition: z.string().optional(),
  status: z.nativeEnum(EquipmentStatus),
  stockCount: z.coerce.number().int().min(0),
  purchaseCost: z.coerce.number().positive().optional().nullable(),
  imageUrl: z.string()
    .refine((val) => {
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
  instrumentManualUrl: z.string().url({ message: "Invalid URL for instrument manual." }).optional().or(z.literal('')),
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
  classId: z.string().nullable().optional(),
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
  studentNumber: z.string().min(1, { message: "Student number cannot be empty." }).optional(),
  contactNumber: z.string().min(10, { message: "Contact number must be at least 10 digits." }).optional(),
  sex: z.enum(['Male', 'Female']).optional(),
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
  studentNumber: z.string().min(1, { message: "Student number is required." }),
  contactNumber: z.string().min(10, { message: "Contact number must be at least 10 digits." }),
});

export type AdminUserCreateInput = z.infer<typeof AdminUserCreateSchema>;

// --- Add Profile Update Schema --- 
export const ProfileUpdateSchema = z.object({
  name: z.string().min(2, { message: "Name must be at least 2 characters." }).optional(),
  studentNumber: z.string().min(1, { message: "Student number cannot be empty." }),
  contactNumber: z.string().min(10, { message: "Contact number must be at least 10 digits." }),
  sex: z.enum(['Male', 'Female'], { errorMap: () => ({ message: 'Please select a valid sex.' }) }).optional(),
});

export type ProfileUpdateInput = z.infer<typeof ProfileUpdateSchema>;

// Schema for Changing Password

// Define the base object schema first
const ChangePasswordBaseSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters long"),
  confirmPassword: z.string().min(1, "Please confirm your new password"),
});

// Apply refinement to the base schema
export const ChangePasswordSchema = ChangePasswordBaseSchema.refine((data) => data.newPassword === data.confirmPassword, {
  message: "New passwords do not match",
  path: ["confirmPassword"],
});

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

// Expose the base schema if needed elsewhere (like the API route)
export { ChangePasswordBaseSchema };

// Schema for Admin Changing Another User's Password
export const AdminChangePasswordSchema = z.object({
  newPassword: z.string().min(8, "New password must be at least 8 characters long"),
  // Optional: confirmPassword if desired, but often admins don't need to confirm
});

export type AdminChangePasswordInput = z.infer<typeof AdminChangePasswordSchema>;

// Schema for Borrow Request Creation
export const BorrowRequestSchema = z.object({
  equipmentId: z.string({ required_error: "Equipment ID is required."}),
}); 