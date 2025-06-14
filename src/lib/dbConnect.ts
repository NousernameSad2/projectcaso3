import mongoose, { Mongoose } from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error(
    'Please define the MONGODB_URI environment variable inside .env.local'
  );
}

// Augment the NodeJS Global type
declare global {
  // eslint-disable-next-line no-var
  var mongoose_cache: { // Keeping var, but disabling the lint rule for this line
    conn: Mongoose | null;
    promise: Promise<Mongoose> | null;
  }
}

/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development. This prevents connections growing exponentially
 * during API Route usage.
 */
let cached = global.mongoose_cache;

if (!cached) {
  cached = global.mongoose_cache = { conn: null, promise: null };
}

async function dbConnect(): Promise<Mongoose> {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      // useNewUrlParser and useUnifiedTopology are deprecated but required by older mongoose versions if still used implicitly somewhere
      // For Mongoose 6+ they are default true and can be removed if causing issues
      // useNewUrlParser: true, 
      // useUnifiedTopology: true,
    };

    console.log('Attempting to connect to MongoDB...');
    cached.promise = mongoose.connect(MONGODB_URI!, opts).then((mongooseInstance: Mongoose) => {
      console.log("MongoDB Connected Successfully");
      return mongooseInstance;
    }).catch((err: Error) => {
        console.error("MongoDB ConnectionError:", err);
        cached.promise = null; // Reset promise on error
        throw err; // Re-throw error to indicate connection failure
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e: unknown) {
    cached.promise = null; // Reset promise if connection fails
    if (e instanceof Error) {
      console.error('Failed to establish MongoDB connection:', e.message);
    } else {
      console.error('Failed to establish MongoDB connection: An unknown error occurred', e);
    }
    throw e;
  }

  if (!cached.conn) {
    throw new Error('MongoDB connection failed after attempt.');
  }

  return cached.conn;
}

export default dbConnect; 