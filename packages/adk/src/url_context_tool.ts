import { BaseTool, ToolProcessLlmRequest } from '@google/adk';

export class UrlContextTool extends BaseTool {
  constructor() {
    super({
      name: 'url_context',
      description: 'Retrieve and understand the content of a provided URL.',
    });
  }

  override async processLlmRequest({ llmRequest }: ToolProcessLlmRequest): Promise<void> {
    if (!llmRequest.config) llmRequest.config = {};
    if (!llmRequest.config.tools) llmRequest.config.tools = [];
    llmRequest.config.tools.push({ urlContext: {} } as any);
  }

  runAsync(): Promise<unknown> {
    return Promise.resolve();
  }
}

export const urlContext = new UrlContextTool();
