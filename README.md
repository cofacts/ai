# Cofacts.ai

This is the web application for [Cofacts.ai](https://cofacts.ai), a chat-based AI assistant for collaborative fact-checking. It provides a modern TanStack Start application with an integrated multi-agent system powered by Google's [ADK](https://google.github.io/adk-docs/) that can research claims, verify sources, and help compose fact-check replies.

## Prerequisites

- Node.js 18+
- Python 3.12+
- Google AI Studio API Key (for the ADK agent) (see https://aistudio.google.com/app/apikey)
- pnpm

> **Note:** This repository includes a pnpm-lock.yaml file. Please ensure you have pnpm installed.

## Getting Started

1. Install Node.js dependencies:

```bash
pnpm install
```

> **Note:** This will *not* install Python dependencies. You must run the next step manually.

2. Install Python dependencies for the ADK agent:

```bash
pnpm install:agent
```

> **Note:** This will automatically setup a `.venv` (virtual environment) inside the `adk` directory.
>
> To activate the virtual environment manually, you can run:
>
> ```bash
> source adk/.venv/bin/activate
> ```

3. Set up environment variables:

For the ADK backend agent:
```bash
cp adk/cofacts_ai/.env.example adk/cofacts_ai/.env
```
Edit `adk/cofacts_ai/.env` and fill in the required values (at minimum `GOOGLE_API_KEY`).

For the frontend UI (Vite / TanStack Start):
```bash
cp .env.example .env
```
Edit `.env` to configure your browser-safe variables (e.g. Langfuse keys).

4. Start the development server:

```bash
pnpm dev
```

This will start both the UI and agent servers concurrently:

- http://localhost:3000 for UI
- http://localhost:8000 for ADK web
- http://localhost:8000/docs for ADK API docs

## Deployment

This project uses GitHub Actions for automated deployments to Google Cloud Run.

### Vertex AI IAM requirements

The agent talks to Gemini through Vertex AI and feeds it Cofacts media as
`gs://` URIs, which involves two separate identities and two separate
permissions. Both must be granted on the project set via `GC_PROJECT_ID`:

1. **Calling the model** — the Cloud Run runtime service account
   (`SERVICE_ACCOUNT_EMAIL`) needs **Vertex AI User** (`roles/aiplatform.user`,
   which includes `aiplatform.endpoints.predict`):

   ```bash
   gcloud projects add-iam-policy-binding "$GC_PROJECT_ID" \
     --member="serviceAccount:<SERVICE_ACCOUNT_EMAIL>" \
     --role="roles/aiplatform.user"
   ```

   Missing this surfaces as `403 PERMISSION_DENIED` on
   `aiplatform.endpoints.predict` for the model resource.

2. **Reading the media** — when Gemini fetches a `gs://cofacts-media-collection`
   object, it uses the Vertex AI service agent
   (`service-<PROJECT_NUMBER>@gcp-sa-aiplatform.iam.gserviceaccount.com`), **not**
   the runtime service account. That agent needs read access to the bucket:

   ```bash
   gcloud storage buckets add-iam-policy-binding gs://cofacts-media-collection \
     --member="serviceAccount:service-<PROJECT_NUMBER>@gcp-sa-aiplatform.iam.gserviceaccount.com" \
     --role="roles/storage.objectViewer"
   ```

   Missing this surfaces as a `storage.objects.get` denial on the bucket object
   (note: it's a cross-project grant if the bucket lives in another project).

### Local Docker Testing

To build and test both Docker images locally (mirroring what the CI pipeline does):

1. Make sure `adk/cofacts_ai/.env` exists and is filled in (see [Getting Started](#getting-started) step 3).

2. Build and start the containers:

```bash
docker compose up --build
```

This will:
- Build the **frontend** image from the root `Dockerfile`
- Build the **backend** image from `adk/Dockerfile`
- Start both containers, with the frontend waiting for the backend to be healthy

3. Open http://localhost:3000 to test the application.

To stop:

```bash
docker compose down
```

### Staging Environment
- **Trigger**: Every push or merge to the `master` branch.
- **URL**: cofacts-ai-236494820908.asia-east1.run.app .
- **Traffic**: The `master` version always receives 100% of the traffic.

### PR Previews
- **Trigger**: Every Pull Request (opened or updated).
- **Behavior**: A dedicated revision is created for each PR with a unique tag.
- **URL**: You can find the preview URL in the GitHub PR comments or the "Deployments" section of the PR sidebar.
- **Isolation**: Each PR has its own isolated preview environment, and deployments to `master` will not interrupt existing PR previews.

## Available Scripts

The following scripts can also be run using pnpm:

- `dev` - Starts both UI and agent servers in development mode
- `dev:ui` - Starts only the UI server (Vite)
- `dev:agent` - Starts only the ADK agent server
- `build` - Builds the application for production
- `preview` - Previews the production build
- `test` - Runs unit tests using Vitest
- `lint` - Runs ESLint for code linting
- `format` - Formats code using Prettier
- `check` - Runs both Prettier and ESLint (format and lint)
- `install:agent` - Installs Python dependencies for the agent using `uv`
- `codegen` - Regenerates `src/server/gql/` from the rumors-api GraphQL schema. Run after editing any `graphql(\`...\`)` document so the generated types stay in sync.

### GraphQL Codegen

Server-side GraphQL queries are typed via [`@graphql-codegen/client-preset`](https://the-guild.dev/graphql/codegen/docs/guides/react-vue#client-preset). Define queries inline with the `graphql` tag from `@/server/gql` and dispatch them through `cofactsExec` (see `src/lib/cofactsExec.ts`):

```ts
import { graphql } from '@/server/gql'
import { cofactsExec } from '@/lib/cofactsExec'

const GetSomethingDocument = graphql(`
  query GetSomething { ... }
`)

const data = await cofactsExec(GetSomethingDocument)
```

The schema source is `https://api.cofacts.tw/graphql` (see `codegen.ts`). The generated `src/server/gql/` directory is committed.

## 📚 Documentation

- [ADK Documentation](https://google.github.io/adk-docs/) - Learn more about the ADK and its features
- [TanStack Start Documentation](https://tanstack.com/start/latest) - Learn about TanStack Start features and API
- [TanStack Query Documentation](https://tanstack.com/query/latest) - Learn about TanStack Query for data fetching

## Contributing

Feel free to submit issues and enhancement requests!

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Troubleshooting

### Agent Connection Issues

If you see "I'm having trouble connecting to my tools", make sure:

1. The ADK agent is running on port 8000
2. Your Google API key is set correctly
3. Both servers started successfully

### Python Dependencies

If you encounter Python import errors:

```bash
cd adk
uv sync
```
