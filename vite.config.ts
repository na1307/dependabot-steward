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
    ]
})
