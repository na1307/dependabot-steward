// Import necessary modules for Google Cloud Functions, Secret Manager, and Probot
import { http } from '@google-cloud/functions-framework'
import { SecretManagerServiceClient } from '@google-cloud/secret-manager'
import { createNodeMiddleware, Probot } from 'probot'
import { appFn } from './app.ts'

// Initialize Google Secret Manager client to access secrets securely
const smsc = new SecretManagerServiceClient()

// Retrieve GitHub App credentials from Google Secret Manager
// These secrets are essential for the Probot app to authenticate with GitHub
const [APP_ID] = await smsc.accessSecretVersion({ name: 'projects/197584535171/secrets/DEPBOT_APP_ID/versions/latest' })
const [PRIVATE_KEY] = await smsc.accessSecretVersion({ name: 'projects/197584535171/secrets/DEPBOT_PRIVATE_KEY/versions/latest' })
const [WEBHOOK_SECRET] = await smsc.accessSecretVersion({ name: 'projects/197584535171/secrets/DEPBOT_WEBHOOK_SECRET/versions/latest' })

// Initialize Probot with the retrieved credentials
// Probot is a framework for building GitHub Apps
const probot = new Probot({
    appId: APP_ID.payload?.data?.toString(),
    privateKey: PRIVATE_KEY.payload?.data?.toString(),
    secret: WEBHOOK_SECRET.payload?.data?.toString()
})

// Create a Node.js middleware from the Probot app
const middleware = await createNodeMiddleware(appFn, { probot })

// Register the Probot app as an HTTP function for Google Cloud Functions
http('probotApp', middleware)

// Export the middleware for local development or other environments
export const viteNodeApp = middleware
