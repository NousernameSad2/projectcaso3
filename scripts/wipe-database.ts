import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// List of models to wipe, in an order that respects relations
// Start with models that are dependents, then the ones they depend on.
const modelsToWipe = [
    'Deficiency',
    'BorrowGroupMate',
    'UserClassEnrollment',
    'Borrow',
    'Class',
    'Equipment',
    'User',
];

async function main() {
    console.log('--- Database Wipe Script ---');
    console.warn('\x1b[31m%s\x1b[0m', 'WARNING: This script will permanently delete ALL data from the database.');
    console.log(`It will wipe the following collections: ${modelsToWipe.join(', ')}`);
    console.log('This action is IRREVERSIBLE.');
    console.log('');

    for (let i = 5; i > 0; i--) {
        process.stdout.write(`Starting in ${i} seconds... (Press CTRL+C to cancel) \r`);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log('\nStarting database wipe...');

    try {
        // We'll use a transaction to ensure all or nothing is deleted.
        // Prisma's $transaction with interactive transactions requires a different approach
        // for dynamically calling deleteMany. A simple sequential deletion is safer here.

        for (const modelName of modelsToWipe) {
            // Prisma Client doesn't support dynamic model names in the format `prisma[model].deleteMany`.
            // We need to access the property using bracket notation after casting to any to satisfy TypeScript.
            const model = (prisma as any)[modelName.charAt(0).toLowerCase() + modelName.slice(1)];
            
            if (model && typeof model.deleteMany === 'function') {
                const { count } = await model.deleteMany({});
                console.log(`- Deleted ${count} records from ${modelName}`);
            } else {
                console.warn(`- Model ${modelName} not found or doesn't have a deleteMany method.`);
            }
        }

        console.log('\n\x1b[32m%s\x1b[0m', '✅ Database wipe completed successfully.');

    } catch (error) {
        console.error('\n\x1b[31m%s\x1b[0m', '❌ An error occurred during the database wipe:');
        console.error(error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error('An unexpected error occurred:', e);
    process.exit(1);
}); 