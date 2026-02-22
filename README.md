# CopilotKit <> ADK Starter

This is a starter template for building AI agents using Google's [ADK](https://google.github.io/adk-docs/) and [CopilotKit](https://copilotkit.ai). It provides a modern TanStack Start application with an integrated investment analyst agent that can research stocks, analyze market data, and provide investment insights.

## Prerequisites

- Node.js 18+
- Python 3.12+
- Google Makersuite API Key (for the ADK agent) (see https://makersuite.google.com/app/apikey)
- pnpm

> **Note:** This repository includes a pnpm-lock.yaml file. Please ensure you have pnpm installed.

## Getting Started

1. Install dependencies:

```bash
pnpm install
```

2. Install Python dependencies for the ADK agent:

```bash
pnpm install:agent
```

> **Note:** This will automatically setup a `.venv` (virtual environment) inside the `agent` directory.
>
> To activate the virtual environment manually, you can run:
>
> ```bash
> source agent/.venv/bin/activate
> ```

3. Set up your Google API key:

```bash
export GOOGLE_API_KEY="your-google-api-key-here"
```

4. Start the development server:

```bash
pnpm dev
```

This will start both the UI and agent servers concurrently.

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

## Documentation

The main UI component is in `app/routes/index.tsx`. You can:

- Modify the theme colors and styling
- Add new frontend actions
- Customize the CopilotKit sidebar appearance

## 📚 Documentation

- [ADK Documentation](https://google.github.io/adk-docs/) - Learn more about the ADK and its features
- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [TanStack Start Documentation](https://tanstack.com/start/latest) - Learn about TanStack Start features and API

## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

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
cd agent
uv sync
```
