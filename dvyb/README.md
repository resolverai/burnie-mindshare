# DVYB - Brand Muse Scheduler

A standalone frontend application for brand content scheduling and management, built with Next.js 14.

## Project Setup

This is a Next.js 14 + React + TypeScript application with shadcn/ui components, integrated into the burnie-mindshare project and aligned with the tech stack used across other frontends in this repository.

## Technologies Used

- **Next.js 14** (App Router)
- TypeScript
- React 18
- shadcn/ui (Radix UI)
- Tailwind CSS
- TanStack Query
- React Hook Form
- Zod
- Recharts

## Getting Started

### Installation

Install dependencies using either npm or bun:

```sh
# Using npm
npm install

# Using bun (recommended)
bun install
```

### Development

Start the development server:

```sh
# Using npm
npm run dev

# Using bun
bun run dev
```

The application will start on **port 3005**: http://localhost:3005

### Build

Build the application for production:

```sh
# Production build
npm run build

# Or with bun
bun run build
```

### Production Start

Start the production server:

```sh
npm run start

# Or with bun
bun start
```

## Project Structure

```
dvyb/
├── src/
│   ├── app/                # Next.js App Router
│   │   ├── layout.tsx     # Root layout with providers
│   │   ├── page.tsx       # Homepage
│   │   ├── providers.tsx  # Client-side providers
│   │   └── globals.css    # Global styles
│   ├── components/        # React components
│   │   ├── ui/           # shadcn/ui components
│   │   ├── calendar/     # Calendar-related components
│   │   ├── onboarding/   # Onboarding flow components
│   │   └── pages/        # Page-level components
│   ├── hooks/            # Custom React hooks
│   ├── lib/              # Utility functions
│   └── assets/           # Static assets
├── public/               # Public static files
└── ...config files
```

## Features

- Brand profile management
- Content scheduling calendar
- Social media integration
- Content library
- Brand kit customization
- Content generation tools
- AI-powered marketing onboarding
- Complete brand strategy builder

## Tech Stack Alignment

This project now uses the same tech stack as other frontends in the burnie-mindshare repository:

- ✅ Next.js 14 (same as `burnie-influencer-platform/frontend` and `mining-interface`)
- ✅ React 18
- ✅ TypeScript
- ✅ Tailwind CSS
- ✅ Radix UI components
- ✅ TanStack Query

## Port Configuration

- **Development**: Port 3005 (configured in `package.json`)
- **Production**: Port 3005 (configured in `package.json`)

## Migration Notes

This project was converted from Vite + React to Next.js 14 to maintain tech stack consistency across the burnie-mindshare monorepo. The frontend appearance and functionality remain identical to the original implementation.

### Key Changes Made:
1. Converted from Vite build system to Next.js
2. Migrated from React Router to Next.js App Router
3. Added "use client" directives to client components
4. Updated image imports for Next.js compatibility
5. Converted PostCSS config to CommonJS format
6. Updated TypeScript configuration for Next.js

## Development Guidelines

- All interactive components use "use client" directive
- Follow Next.js App Router conventions
- Use Next.js Image component for optimized images when needed
- Maintain component structure from original Vite app
