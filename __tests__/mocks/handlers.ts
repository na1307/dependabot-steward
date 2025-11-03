import { http, HttpResponse } from 'msw'

// Define mock request handlers for various GitHub API endpoints.
// These handlers are used by Mock Service Worker (MSW) to intercept and respond to network requests
// during tests, preventing actual API calls and providing predictable data.
export const handlers = [
    // Mock GET request for repository details.
    // By default, it allows merge commits.
    http.get('https://api.github.com/repos/test-owner/test-repo', () => {
        return HttpResponse.json({
            allow_merge_commit: true
        })
    }),
    // Mock GET request for pull request reviews.
    // By default, it returns an empty array, meaning no reviews.
    http.get('https://api.github.com/repos/test-owner/test-repo/pulls/1/reviews', () => {
        return HttpResponse.json([])
    }),
    // Mock GET request for a specific pull request.
    // By default, it indicates the PR is not merged and is from Dependabot (user ID 49699333).
    http.get('https://api.github.com/repos/test-owner/test-repo/pulls/1', () => {
        return HttpResponse.json({
            merged: false,
            user: {
                id: 49699333 // Dependabot's user ID
            }
        })
    }),
    // Mock GET request for check suites associated with a commit SHA.
    // By default, it returns no check suites.
    http.get('https://api.github.com/repos/test-owner/test-repo/commits/test-sha/check-suites', () => {
        return HttpResponse.json({
            total_count: 0
        })
    })
]
