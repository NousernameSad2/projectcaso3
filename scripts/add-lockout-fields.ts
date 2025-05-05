import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting script to ensure lockout fields exist on all users...');

  // Use updateMany with an empty 'where' to apply to all users.
  // This ensures 'failedLoginAttempts' exists and is set to 0,
  // and 'lockoutUntil' exists and is set to null.
  // If the fields already exist with these values, they won't be changed.
  // If 'failedLoginAttempts' has a non-zero value, it WILL be reset to 0.
  // If 'lockoutUntil' has a date, it WILL be reset to null.
  // This is the simplest approach for ensuring schema compliance.
  const result = await prisma.user.updateMany({
    where: {}, // Apply to all users
    data: {
      failedLoginAttempts: 0,
      lockoutUntil: null,
    },
  });

  console.log(`Processed ${result.count} user documents. Fields 'failedLoginAttempts' (set to 0) and 'lockoutUntil' (set to null) are ensured.`);
  console.log('Script finished.');
}

main()
  .catch(async (e) => {
    console.error('Error running script:', e);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 