Readable is a Next.js application that personalizes research paper summaries and tutoring. It now integrates a managed Weaviate instance for hybrid retrieval over paper chunks, figures, citations, and persona concepts.

## Getting Started

First, install dependencies and run the development server with [pnpm](https://pnpm.io):

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `src/app/page.tsx`. The page auto-updates as you edit the file.

Once your environment variables are in place (see below), you can validate the Weaviate connection and schema with:

```bash
pnpm test:weaviate
```

This script checks liveness/ready status, ensures the hybrid schema, and runs a smoke hybrid query.

## Environment variables

Copy `.env.local.example` to `.env.local` and fill in the values before running the app:

```bash
cp .env.local.example .env.local
```

At minimum you should provide values for:

- `OPENAI_API_KEY`
- `WEAVIATE_URL`
- `WEAVIATE_API_KEY`
- `POSTHOG_KEY`
- `KONTEXT_API_KEY`
- `SEMANTIC_SCHOLAR_KEY`

Additional variables:

- `WEAVIATE_TIMEOUT_MS` (optional) — override the default 20s health-check timeout for managed clusters.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
