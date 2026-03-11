import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { root_agent } from './agent.js';
import express from 'express';
import { Request, Response } from 'express';

// Setup basic environment values required by ADK
if (!process.env.ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS) {
    process.env.ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS = 'true';
}

const traceExporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'https://langfuse.cofacts.tw/api/public/otel/v1/traces',
  headers: process.env.OTEL_EXPORTER_OTLP_HEADERS
    ? Object.fromEntries(
        process.env.OTEL_EXPORTER_OTLP_HEADERS.split(',').map((h: string) => h.split('='))
      )
    : undefined,
});

const sdk = new NodeSDK({
  traceExporter: traceExporter as any,
});

sdk.start();

const port = parseInt(process.env.PORT || '8000', 10);

async function main() {
  console.log(`Starting ADK server on port ${port}...`);
  try {
    const app = express();

    // For now, simple fallback route
    app.post('/api/chat', async (_req: Request, res: Response) => {
        // Log the root_agent to show it's "used" for TS
        console.log(`Using agent: ${root_agent.name}`);
        // Implement chat or use adk SDK when available
        res.json({ message: "ADK Server Running" });
    });

    app.listen(port, () => {
        console.log(`ADK Server is running on port ${port}.`);
    });

  } catch (err) {
    console.error('Failed to start ADK Server:', err);
    process.exit(1);
  }
}

main();

process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('Tracing terminated'))
    .catch((error: Error) => console.log('Error terminating tracing', error))
    .finally(() => process.exit(0));
});
