This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Database Management

### Wiping the Database (USE WITH EXTREME CAUTION)

This project includes a script to completely wipe all data from the database collections managed by Prisma. This is useful for resetting the application to a clean state during development.

**WARNING:** This action is irreversible and will permanently delete all users, equipment, borrow records, and all other data in the database.

To wipe the database, follow these steps:

1.  **Ensure Dependencies are Installed:** The script uses `ts-node` to run. If you haven't installed it yet, add it as a development dependency:
    ```bash
    npm install -D ts-node
    ```

2.  **Verify Environment:** Make sure your `.env` file is present in the project root and the `DATABASE_URL` variable is pointing to the database instance you wish to wipe.

3.  **Run the Script:** Execute the following command in your terminal:
    ```bash
    npx ts-node scripts/wipe-database.ts
    ```

The script includes a 5-second countdown before it begins, giving you a final opportunity to cancel the operation by pressing `CTRL+C`.
