import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appFn, dependabotUserId, stewardUserId } from '../src/app.ts'

// Main test suite for the Dependabot Steward Probot app
describe('Dependabot Steward', () => {
    let mockOctokit: any
    let eventHandler: any

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
                }
            },
            request: vi.fn().mockResolvedValue({ data: { check_runs: [] } }) // Mock check runs
        }
    })

    // Test suite for 'check_suite.completed' events
    describe('when a check suite has completed', () => {
        // Test case: PR should merge if all conditions are met
        it('should merge a pull request when all checks have passed', async () => {
            // Define a mock event payload
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
                                }
                            }
                        ]
                    }
                }
            }

            // Create a mock context object for the event handler
            const context = {
                payload: event.payload,
                octokit: mockOctokit,
                log: console
            }

            await eventHandler(context) // Invoke the event handler

            // Assertions: Expect PR to be approved and merged
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
            // Override mock to simulate a PR from a non-Dependabot user
            mockOctokit.rest.pulls.get.mockResolvedValue({
                data: {
                    merged: false,
                    user: {
                        id: 12345 // Non-Dependabot user ID
                    }
                }
            })

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
                                    ref: 'test-branch',
                                    sha: 'test-sha',
                                    repo: {
                                        id: 1
                                    }
                                }
                            }
                        ]
                    }
                }
            }

            const context = {
                payload: event.payload,
                octokit: mockOctokit,
                log: console
            }

            await eventHandler(context)

            // Assertions: Expect PR not to be approved or merged
            expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled()
            expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled()
        })

        // Test case: PR should not merge if it's from a forked repository
        it('should not merge a pull request if it is from a fork', async () => {
            // Define event payload simulating a PR from a fork
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
                                    ref: 'test-branch',
                                    sha: 'test-sha',
                                    repo: {
                                        id: 2 // Different repo ID for head, indicating a fork
                                    }
                                }
                            }
                        ]
                    }
                }
            }

            const context = {
                payload: event.payload,
                octokit: mockOctokit,
                log: console
            }

            await eventHandler(context)

            // Assertions: Expect PR not to be approved or merged
            expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled()
            expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled()
        })

        // Test case: PR should not merge if it's already merged
        it('should not merge a pull request if it is already merged', async () => {
            // Override mock to simulate an already merged PR
            mockOctokit.rest.pulls.get.mockResolvedValue({
                data: {
                    merged: true, // PR is already merged
                    user: {
                        id: dependabotUserId
                    }
                }
            })

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
                                }
                            }
                        ]
                    }
                }
            }

            const context = {
                payload: event.payload,
                octokit: mockOctokit,
                log: console
            }

            await eventHandler(context)

            // Assertions: Expect PR not to be approved or merged
            expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled()
            expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled()
        })

        // Test case: PR should not merge if it's already reviewed by the steward
        it('should not merge a pull request if it is already reviewed', async () => {
            // Override mock to simulate PR already reviewed by the steward
            mockOctokit.rest.pulls.listReviews.mockResolvedValue({
                data: [
                    {
                        user: {
                            id: stewardUserId // Steward user ID
                        }
                    }
                ]
            })

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
                                }
                            }
                        ]
                    }
                }
            }

            const context = {
                payload: event.payload,
                octokit: mockOctokit,
                log: console
            }

            await eventHandler(context)

            // Assertions: Expect PR not to be approved or merged
            expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled()
            expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled()
        })

        // Test case: PR should not merge if some check suites are still in progress
        it('should not merge a pull request if some checks are not completed', async () => {
            // Override mock to simulate an in-progress check suite
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
                                }
                            }
                        ]
                    }
                }
            }

            const context = {
                payload: event.payload,
                octokit: mockOctokit,
                log: console
            }

            await eventHandler(context)

            // Assertions: Expect PR not to be approved or merged
            expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled()
            expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled()
        })

        // Test case: PR should not merge if required checks have failed
        it('should not merge a pull request if required checks have not passed', async () => {
            // Override mock to simulate required status checks
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

            // Override mock to simulate a failed check suite
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
                                }
                            }
                        ]
                    }
                }
            }

            const context = {
                payload: event.payload,
                octokit: mockOctokit,
                log: console
            }

            await eventHandler(context)

            // Assertions: Expect PR not to be approved or merged
            expect(mockOctokit.rest.pulls.createReview).not.toHaveBeenCalled()
            expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled()
        })

        // Test case: PR should merge if there are no check suites configured
        it('should merge a pull request if there are no check suites', async () => {
            // Override mock to simulate no check suites
            mockOctokit.rest.checks.listSuitesForRef.mockResolvedValue({
                data: {
                    total_count: 0, // No check suites
                    check_suites: []
                }
            })

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
                                }
                            }
                        ]
                    }
                }
            }

            const context = {
                payload: event.payload,
                octokit: mockOctokit,
                log: console
            }

            await eventHandler(context)

            // Assertions: Expect PR to be approved and merged
            expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalled()
            expect(mockOctokit.rest.pulls.merge).toHaveBeenCalled()
        })

        // Test case: PR should merge if there are check suites but none have check runs
        it('should merge a pull request if there are no valid check suites', async () => {
            // Override mock to simulate check suites with no check runs
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
                                }
                            }
                        ]
                    }
                }
            }

            const context = {
                payload: event.payload,
                octokit: mockOctokit,
                log: console
            }

            await eventHandler(context)

            // Assertions: Expect PR to be approved and merged
            expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalled()
            expect(mockOctokit.rest.pulls.merge).toHaveBeenCalled()
        })
    })
})
