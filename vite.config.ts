/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { VitePluginNode } from 'vite-plugin-node'

export default defineConfig({
    server: {
        allowedHosts: true
    },
    plugins: [
        ...VitePluginNode({
            adapter({ app, req, res, next }) {
                app(req, res, next)
            },
            appPath: 'src/index.ts',
            outputFormat: 'es'
        })
    ],
    test: {
        globals: true,
        setupFiles: '__tests__/setupTests.ts',
        coverage: {
            include: ['src/*.ts'],
            provider: 'v8',
            reporter: ['lcovonly']
        }
    }
})
