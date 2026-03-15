/**
 * Utility functions for server functions.
 */

const IS_DEV = process.env.NODE_ENV === 'development';

/**
 * Shared error handling for ADK API responses.
 *
 * - In development: throws a detailed error message for better debugging.
 * - In production: logs the full error to the server console but throws a generic message to the client.
 */
export function handleAdkError(error: unknown): never {
  if (IS_DEV) {
    // Attempt to extract detail from FastAPI validation errors
    const detail = (error as any)?.detail?.[0]?.msg;
    if (detail) {
      throw new Error(`ADK Error: ${detail}`);
    }

    // Fallback to stringified error in dev
    throw new Error(`ADK Error: ${JSON.stringify(error)}`);
  }

  // Production: Log the full error to the server console
  console.error('[ADK Error]', error);

  // Throw a generic error to the client
  throw new Error('An error occurred while communicating with the ADK service.');
}

/**
 * Shared error handling for ADK Response objects (e.g. from stream requests).
 */
export function handleAdkResponseError(response: Response): never {
  if (IS_DEV) {
    throw new Error(`ADK returned ${response.status}: ${response.statusText}`);
  }

  // Production: Log the full response details
  console.error('[ADK Response Error]', {
    status: response.status,
    statusText: response.statusText,
    url: response.url,
  });

  throw new Error('An error occurred while communicating with the ADK service.');
}

