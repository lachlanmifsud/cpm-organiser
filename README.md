# The Builder's Ledger

Professional admin and invoicing app for a self-employed residential builder.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS v4 + shadcn/ui
- Firebase (Auth, Firestore, Storage)
- TanStack Query

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create local env file:

```bash
cp .env.example .env.local
```

3. Add Firebase project values to `.env.local`.

4. Start development server:

```bash
npm run dev
```

## Firebase Files

- `src/lib/firebase/config.ts` validates and exposes Firebase env config.
- `src/lib/firebase/client.ts` initializes app, auth, firestore, and storage.
- `src/lib/firebase/collections.ts` centralizes collection name constants.

## Core Schema Types

All core domain types are defined in `src/types/database.ts`, including:

- Client (billing/site addresses + school fields like PO defaults)
- Job (workflow state, files, quote/invoice links, duplicate source tracking)
- Quote and Invoice (quote-to-invoice conversion support)
- LineItem (labor, materials, variations, credits, returns)
- Receipt extraction item allocations for splitting costs across jobs

## Current UI Scaffold

- Dashboard shell in `src/app/page.tsx`
- Active Jobs table with payment status indicator
- Desktop-first, high-contrast layout for admin workflows
