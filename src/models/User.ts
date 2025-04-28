import mongoose, { Schema, Document, models, Model } from 'mongoose';

// Define the possible user roles
export enum UserRole {
    REGULAR = 'REGULAR',
    FACULTY = 'FACULTY',
    STAFF = 'STAFF'
}

// Define the possible user statuses
export enum UserStatus {
    PENDING_APPROVAL = 'pending_approval',
    APPROVED = 'approved',
    REJECTED = 'rejected', // Optional: if you want to explicitly mark rejected registrations
    DEACTIVATED = 'deactivated' // Optional: for disabling accounts
}

// Define the interface for the User document
export interface IUser extends Document {
    name: string;
    email: string;
    passwordHash: string;
    role: UserRole;
    status: UserStatus;
    createdAt: Date;
    updatedAt: Date;
    // Ensure _id is implicitly typed by Document or explicitly add:
    // _id: mongoose.Types.ObjectId;
}

// Define the Mongoose schema
const UserSchema: Schema<IUser> = new Schema(
    {
        name: {
            type: String,
            required: [true, 'Name is required'],
            trim: true,
        },
        email: {
            type: String,
            required: [true, 'Email is required'],
            unique: true,
            trim: true,
            lowercase: true,
            match: [/^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/, 'Please enter a valid email address'],
        },
        passwordHash: {
            type: String,
            required: [true, 'Password hash is required'],
        },
        role: {
            type: String,
            enum: Object.values(UserRole),
            default: UserRole.REGULAR,
        },
        status: {
            type: String,
            enum: Object.values(UserStatus),
            default: UserStatus.PENDING_APPROVAL,
        },
    },
    {
        timestamps: true, // Automatically adds createdAt and updatedAt fields
    }
);

// Create and export the User model
// Check if the model already exists before defining it
const User: Model<IUser> = models.User || mongoose.model<IUser>('User', UserSchema);

export default User; 