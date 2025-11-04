import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appFn, dependabotUserId, stewardUserId } from '../src/app.ts'

// Main test suite for the Dependabot Steward Probot app
describe('Dependabot Steward', () => {
    let mockOctokit: any
    let eventHandler: any

    const createMockContext = (
        pullRequestOverrides?: any,
        repoContentOverrides?: any,
        checkSuitesOverrides?: any,
        issueCommentsOverrides?: any,
        branchRulesOverrides?: any
    ) => {
        const event = {
            name: 'check_suite.completed',
            id: '123',
            payload: {
                repository: {
                    owner: {
                        login: 'test-owner'
                    },
                    name: 'test-repo'
                },
                check_suite: {
                    conclusion: 'success',
                    pull_requests: [
                        {
                            number: 1,
                            base: {
                                ref: 'main',
                                repo: {
                                    id: 1
                                }
                            },
                            head: {
                                ref: 'dependabot/npm_and_yarn/test/test-package-1.0.0',
                                sha: 'test-sha',
                                repo: {
                                    id: 1
                                }
                            },
                            ...pullRequestOverrides // Apply PR specific overrides
                        }
                    ]
                },
                ...checkSuitesOverrides // Apply check suite specific overrides
            }
        }

        // Apply specific mocks based on overrides
        if (repoContentOverrides) {
            mockOctokit.rest.repos.getContent.mockResolvedValue(repoContentOverrides)
        }
        if (issueCommentsOverrides) {
            mockOctokit.rest.issues.listComments.mockResolvedValue(issueCommentsOverrides)
        }
        if (branchRulesOverrides) {
            mockOctokit.rest.repos.getBranchRules.mockResolvedValue(branchRulesOverrides)
        }

        const context = {
            payload: event.payload,
            octokit: mockOctokit,
            log: console
        }

        return { event, context }
    }

    // Setup before each test case
    beforeEach(() => {
        // Mock the Probot app instance
        const app = {
            on: vi.fn(), // Mock the 'on' method to capture event handlers
            log: console // Use console for logging in tests
        }
        appFn(app as any) // Initialize the app with the mocked Probot instance
        eventHandler = app.on.mock.calls[0][1] // Extract the event handler for 'check_suite.completed'

        // Mock the Octokit instance to control GitHub API responses
        mockOctokit = {
            rest: {
                repos: {
                    // Mock repository settings, allowing merge commits by default
                    get: vi.fn().mockResolvedValue({
                        data: {
                            allow_merge_commit: true
                        }
                    }),
                    // Mock getContent to return a default valid .steward.yml
                    getContent: vi.fn().mockResolvedValue({
                        data: {
                            type: 'file',
                            content: Buffer.from('enable: true').toString('base64'),
                            encoding: 'base64'
                        }
                    }),
                    // Mock branch protection rules, no required checks by default
                    getBranchRules: vi.fn().mockResolvedValue({ data: [] })
                },
                pulls: {
                    // Mock pull request reviews, no reviews by default
                    listReviews: vi.fn().mockResolvedValue({ data: [] }),
                    // Mock pull request details, not merged and from Dependabot by default
                    get: vi.fn().mockResolvedValue({
                        data: {
                            merged: false,
                            user: {
                                id: dependabotUserId
                            }
                        }
                    }),
                    createReview: vi.fn().mockResolvedValue({}), // Mock PR approval
                    merge: vi.fn().mockResolvedValue({}) // Mock PR merge
                },
                checks: {
                    // Mock check suites, no check suites by default
                    listSuitesForRef: vi.fn().mockResolvedValue({
                        data: {
                            total_count: 0,
                            check_suites: []
                        }
                    })
                },
                issues: {
                    createComment: vi.fn().mockResolvedValue({}),
                    listComments: vi.fn().mockResolvedValue({ data: [] })
                }
            },
            request: vi.fn().mockResolvedValue({ data: { check_runs: [] } }) // Mock check runs
        }
    })

    // Test suite for 'check_suite.completed' events
    describe('when a check suite has completed', () => {
        // Test case: PR should merge if all conditions are met
        it('should merge a pull request when all checks have passed', async () => {
            mockOctokit.rest.pulls.createReview.mockResolvedValue({})
            mockOctokit.rest.pulls.merge.mockResolvedValue({})

            const { context } = createMockContext()
            await eventHandler(context)

            expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalledWith({
                owner: 'test-owner',
                repo: 'test-repo',
                pull_number: 1,
                event: 'APPROVE'
            })

            expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith({
                owner: 'test-owner',
                repo: 'test-repo',
                pull_number: 1,
                merge_method: 'merge'
            })
        })

        // Test case: PR should not merge if not from Dependabot
        it('should not merge a pull request if it is not from Dependabot', async () => {
            mockOctokit.rest.pulls.get.mockResolvedValue({
                data: {
                    merged: false,
                    user: {
                        id: 12345 // Non-Dependabot user ID
                    }
                }
            })

            const { context } = createMockContext()
            await eventHandler(context)

            expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled()
            expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled()
        })

        // Test case: PR should not merge if it's from a forked repository
        it('should not merge a pull request if it is from a fork', async () => {
            const { context } = createMockContext({
                head: {
                    repo: {
                        id: 2 // Different repo ID for head, indicating a fork
                    }
                }
            })
            await eventHandler(context)

            expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled()
            expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled()
        })

        // Test case: PR should not merge if it's already merged
        it('should not merge a pull request if it is already merged', async () => {
            mockOctokit.rest.pulls.get.mockResolvedValue({
                data: {
                    merged: true, // PR is already merged
                    user: {
                        id: dependabotUserId
                    }
                }
            })

            const { context } = createMockContext()
            await eventHandler(context)

            expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled()
            expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled()
        })

        // Test case: PR should not merge if it's already reviewed by the steward
        it('should not merge a pull request if it is already reviewed', async () => {
            mockOctokit.rest.pulls.listReviews.mockResolvedValue({
                data: [
                    {
                        user: {
                            id: stewardUserId // Steward user ID
                        }
                    }
                ]
            })

            const { context } = createMockContext()
            await eventHandler(context)

            expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled()
            expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled()
        })

        // Test case: PR should not merge if some check suites are still in progress
        it('should not merge a pull request if some checks are not completed', async () => {
            mockOctokit.rest.checks.listSuitesForRef.mockResolvedValue({
                data: {
                    total_count: 1,
                    check_suites: [
                        {
                            status: 'in_progress', // Check suite is not completed
                            latest_check_runs_count: 1
                        }
                    ]
                }
            })

            const { context } = createMockContext()
            await eventHandler(context)

            expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled()
            expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled()
        })

        // Test case: PR should not merge if required checks have failed
        it('should not merge a pull request if required checks have not passed', async () => {
            mockOctokit.rest.repos.getBranchRules.mockResolvedValue({
                data: [
                    {
                        type: 'required_status_checks',
                        parameters: {
                            required_status_checks: [
                                {
                                    context: 'test-check' // A required check
                                }
                            ]
                        }
                    }
                ]
            })

            mockOctokit.rest.checks.listSuitesForRef.mockResolvedValue({
                data: {
                    total_count: 1,
                    check_suites: [
                        {
                            status: 'completed',
                            conclusion: 'failure', // Check suite failed
                            latest_check_runs_count: 1
                        }
                    ]
                }
            })

            const { context } = createMockContext()
            await eventHandler(context)

            expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled()
            expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled()
        })

        // Test case: PR should merge if there are no check suites configured
        it('should merge a pull request if there are no check suites', async () => {
            mockOctokit.rest.pulls.createReview.mockResolvedValue({})
            mockOctokit.rest.pulls.merge.mockResolvedValue({})
            mockOctokit.rest.checks.listSuitesForRef.mockResolvedValue({
                data: {
                    total_count: 0, // No check suites
                    check_suites: []
                }
            })

            const { context } = createMockContext()
            await eventHandler(context)

            expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalled()
            expect(mockOctokit.rest.pulls.merge).toHaveBeenCalled()
        })

        // Test case: PR should merge if there are check suites but none have check runs
        it('should merge a pull request if there are no valid check suites', async () => {
            mockOctokit.rest.pulls.createReview.mockResolvedValue({})
            mockOctokit.rest.pulls.merge.mockResolvedValue({})
            mockOctokit.rest.checks.listSuitesForRef.mockResolvedValue({
                data: {
                    total_count: 1,
                    check_suites: [
                        {
                            latest_check_runs_count: 0 // No check runs in the suite
                        }
                    ]
                }
            })

            const { context } = createMockContext()
            await eventHandler(context)

            expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalled()
            expect(mockOctokit.rest.pulls.merge).toHaveBeenCalled()
        })
    })

    // Test suite for .steward.yml configuration
    describe('with .steward.yml configuration', () => {
        it('should not merge a pull request if .steward.yml has enable: false', async () => {
            const { context } = createMockContext(undefined, {
                data: {
                    type: 'file',
                    content: Buffer.from('enable: false').toString('base64'),
                    encoding: 'base64'
                }
            })
            await eventHandler(context)

            expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled()
        })

        it('should not merge a pull request if the ecosystem is disabled in .steward.yml', async () => {
            const { context } = createMockContext(undefined, {
                data: {
                    type: 'file',
                    content: Buffer.from('npm_and_yarn:\n  enable: false').toString('base64'),
                    encoding: 'base64'
                }
            })
            await eventHandler(context)

            expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled()
        })

        it('should create a comment if .steward.yml is not a file', async () => {
            const { context } = createMockContext(undefined, {
                data: {
                    type: 'dir',
                    content: '',
                    encoding: 'base64'
                }
            })
            await eventHandler(context)

            expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
                owner: 'test-owner',
                repo: 'test-repo',
                issue_number: 1,
                body: 'Configuration invalid: `.steward.yml` must be a file.'
            })
            expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled()
        })

        it('should create a comment if .steward.yml is invalid', async () => {
            const { context } = createMockContext(undefined, {
                data: {
                    type: 'file',
                    content: Buffer.from('enable: "true"').toString('base64'),
                    encoding: 'base64'
                }
            })
            await eventHandler(context)

            expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
                owner: 'test-owner',
                repo: 'test-repo',
                issue_number: 1,
                body: 'Configuration invalid. Please check `.steward.yml`.'
            })
            expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled()
        })

        it('should merge a pull request if .steward.yml is not found', async () => {
            mockOctokit.rest.pulls.createReview.mockResolvedValue({})
            mockOctokit.rest.pulls.merge.mockResolvedValue({})
            mockOctokit.rest.repos.getContent.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }))

            const { context } = createMockContext()
            await eventHandler(context)

            expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalled()
            expect(mockOctokit.rest.pulls.merge).toHaveBeenCalled()
        })
    })

    describe('with ecosystem-specific .steward.yml configuration', () => {
        it('should merge a pull request if the ecosystem is explicitly enabled', async () => {
            mockOctokit.rest.pulls.createReview.mockResolvedValue({})
            mockOctokit.rest.pulls.merge.mockResolvedValue({})
            const { context } = createMockContext(undefined, {
                data: {
                    type: 'file',
                    content: Buffer.from('npm_and_yarn:\n  enable: true').toString('base64'),
                    encoding: 'base64'
                }
            })
            await eventHandler(context)

            expect(mockOctokit.rest.pulls.merge).toHaveBeenCalled()
        })

        it('should merge a pull request if the ecosystem config is an empty object', async () => {
            mockOctokit.rest.pulls.createReview.mockResolvedValue({})
            mockOctokit.rest.pulls.merge.mockResolvedValue({})
            const { context } = createMockContext(undefined, {
                data: {
                    type: 'file',
                    content: Buffer.from('npm_and_yarn: {}').toString('base64'),
                    encoding: 'base64'
                }
            })
            await eventHandler(context)

            expect(mockOctokit.rest.pulls.merge).toHaveBeenCalled()
        })

        it('should merge a pull request if a different ecosystem is disabled', async () => {
            mockOctokit.rest.pulls.createReview.mockResolvedValue({})
            mockOctokit.rest.pulls.merge.mockResolvedValue({})
            const { context } = createMockContext(undefined, {
                data: {
                    type: 'file',
                    content: Buffer.from('composer:\n  enable: false').toString('base64'),
                    encoding: 'base64'
                }
            })
            await eventHandler(context)

            expect(mockOctokit.rest.pulls.merge).toHaveBeenCalled()
        })
    })
})
