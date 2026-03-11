import { LlmAgent, AgentTool } from '@google/adk';
import { search_cofacts_database, get_single_cofacts_article } from './tools.js';
import { urlContext } from './url_context_tool.js';

const ai_investigator = new LlmAgent({
  name: 'investigator',
  model: 'gemini-2.5-flash',
  description: 'AI research assistant that specializes in finding information online using Google Search.',
  instruction: `
    You are an AI research assistant for the Cofacts fact-checking system.
    Your specialized role is to search the web and find credible information related to suspicious messages.

    CRITICAL CONSTRAINT: You ONLY have access to the Google Search tool. You DO NOT have the ability to read the content of URLs.

    Your workflow:
    1. Understand the claim or topic that needs investigating from the orchestrator.
    2. Formulate effective search queries.
    3. Use the google_search tool to find relevant information.
    4. Review the search results (snippets).
    5. Report back the findings AND provide the URLs that contain relevant information.

    IMPORTANT: Provide the URLs you found to the orchestrator so it can pass them to the verifier agent.
    NEVER hallucinate or guess URLs. Only provide URLs that appear in your search results.
  `,
  tools: [{ googleSearch: {} } as any]
});

const ai_verifier = new LlmAgent({
  name: 'verifier',
  model: 'gemini-2.5-flash',
  description: 'AI verification assistant that reads the content of specific URLs provided to it.',
  instruction: `
    You are an AI verification assistant for the Cofacts fact-checking system.
    Your specialized role is to read the content of specific URLs and verify claims based on that content.

    CRITICAL CONSTRAINT: You ONLY have access to the url_context tool. You DO NOT have the ability to search the web.

    Your workflow:
    1. Receive specific URLs and questions/claims from the orchestrator.
    2. Use the url_context tool to read the content of the provided URLs.
    3. Analyze the content to answer the specific questions or verify the claims.
    4. Report back whether the URL content supports or refutes the claims, with specific quotes/evidence.

    IMPORTANT: ONLY use URLs that have been explicitly provided to you. NEVER hallucinate or invent URLs.
  `,
  tools: [urlContext]
});

const ai_proofreader_minor_parties = new LlmAgent({
    name: "proofreader_minor_parties",
    model: "gemini-2.5-flash",
    description: "Political analyst providing perspectives from minor political parties and civic activists in Taiwan (e.g., NPP, TSP, Green Party, independent activists).",
    instruction: "You provide political perspective.",
    tools: []
});

const ai_proofreader_kmt = new LlmAgent({
    name: "proofreader_kmt",
    model: "gemini-2.5-flash",
    description: "Political analyst providing perspectives from the Kuomintang (KMT) and its supporters (Pan-Blue coalition).",
    instruction: "You provide political perspective.",
    tools: []
});

const ai_proofreader_dpp = new LlmAgent({
    name: "proofreader_dpp",
    model: "gemini-2.5-flash",
    description: "Political analyst providing perspectives from the Democratic Progressive Party (DPP) and its supporters (Pan-Green coalition).",
    instruction: "You provide political perspective.",
    tools: []
});

const ai_proofreader_tpp = new LlmAgent({
    name: "proofreader_tpp",
    model: "gemini-2.5-flash",
    description: "Political analyst providing perspectives from the Taiwan People's Party (TPP) and its supporters (White force).",
    instruction: "You provide political perspective.",
    tools: []
});

export const ai_writer = new LlmAgent({
  name: 'writer',
  model: 'gemini-2.5-pro',
  description: 'AI agent that orchestrates fact-checking process and composes final fact-check replies for Cofacts.',
  instruction: `
    You are an AI Writer and orchestrator for the Cofacts fact-checking system.
    Your primary role is to SUPPORT and EMPOWER human fact-checkers.
    Users should ALWAYS provide a Cofacts suspicious message URL to start.

    You can use tools to fetch Cofacts articles, search the database, and delegate research to sub-agents.
  `,
  tools: [
    search_cofacts_database,
    get_single_cofacts_article,
    new AgentTool({ agent: ai_investigator }),
    new AgentTool({ agent: ai_verifier }),
    new AgentTool({ agent: ai_proofreader_minor_parties }),
    new AgentTool({ agent: ai_proofreader_kmt }),
    new AgentTool({ agent: ai_proofreader_dpp }),
    new AgentTool({ agent: ai_proofreader_tpp })
  ]
});

export const root_agent = ai_writer;
