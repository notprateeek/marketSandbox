# TradePlay

A paper trading simulator for learning and practicing stock market strategies with virtual money, built for the Indian market.

## Tech Stack

- **Framework**: Next.js (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4 (Cohere Design System)
- **Database**: Prisma + SQLite (dev)
- **Validation**: Zod
- **Testing**: Vitest (Unit) + Playwright (E2E)

## Getting Started

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Set up environment variables:**

   ```bash
   cp .env.example .env
   ```

3. **Initialize and seed the database:**

   ```bash
   npm run db:migrate:deploy
   npm run db:seed
   ```

4. **Run the development server:**
   ```bash
   npm run dev
   ```

Open [http://localhost:3002](http://localhost:3002) with your browser to see the result.

## Scripts

- `npm run dev` - Start dev server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run test:unit` - Run Vitest unit tests
- `npm run test:e2e` - Run Playwright E2E tests
- `npm run db:generate` - Generate Prisma client
- `npm run db:prepare` - Create the local SQLite file when needed
- `npm run db:migrate` - Create and apply development migrations
- `npm run db:migrate:deploy` - Apply committed migrations
- `npm run db:push` - Sync schema to database
- `npm run db:seed` - Seed example Indian equities
- `npm run db:studio` - Open Prisma Studio to view database contents
