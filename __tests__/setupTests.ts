import { afterAll, afterEach, beforeAll } from 'vitest'
import { setupServer } from 'msw/node'
import { handlers } from './mocks/handlers.ts'

// Setup the Mock Service Worker (MSW) server with the defined request handlers.
// This server will intercept outgoing network requests during tests.
export const server = setupServer(...handlers)

// Start the MSW server before all tests run.
beforeAll(() => server.listen())

// Reset any request handlers that are declared in the tests themselves (as opposed to the handlers file).
// This ensures that tests are isolated and do not affect each other's network mocks.
afterEach(() => server.resetHandlers())

// Close the MSW server after all tests are finished.
afterAll(() => server.close())
