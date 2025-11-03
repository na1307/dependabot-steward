import type { Probot } from 'probot'

export const dependabotUserId = 49699333
export const stewardUserId = 241759641

/**
 * The main function for the Probot app.
 * It registers event handlers for GitHub webhooks.
 * @param app The Probot application instance.
 */
export function appFn(app: Probot): void {
    // Listen for 'check_suite.completed' events
    // This event is triggered when a check suite (collection of check runs) has completed
    app.on('check_suite.completed', async context => {
        const payload = context.payload
        const owner = payload.repository.owner.login
        const repo = payload.repository.name
        context.log.info(`Received check_suite.completed event for ${owner}/${repo}`)
        const octokit = context.octokit.rest // Octokit instance for making GitHub API calls
        let pull_number: number | undefined // Variable to store the PR number

        // Fetch repository metadata to determine allowed merge methods
        const repoMetadata = (await octokit.repos.get({ owner, repo })).data
        let merge_method: 'merge' | 'squash' | 'rebase'

        // Determine the preferred merge method based on repository settings
        if (repoMetadata.allow_merge_commit) {
            merge_method = 'merge'
        } else if (repoMetadata.allow_squash_merge) {
            merge_method = 'squash'
        } else if (repoMetadata.allow_rebase_merge) {
            merge_method = 'rebase'
        } else {
            // If no merge method is allowed, something is wrong with repo settings
            throw new Error('No allowed merge method found for the repository.')
        }

        // Asynchronously process the merge logic
        const processMerge = await (async () => {
            const suite = payload.check_suite // The completed check suite
            const pr = suite.pull_requests.pop() // Get the associated Pull Request

            // If no PR is associated with the check suite, exit
            if (!pr) {
                context.log.warn('No pull request found in the check suite.')
                return false
            }

            // Ensure the head and base repositories are the same (i.e., not a fork)
            if (pr.base.repo.id !== pr.head.repo.id) {
                context.log.warn(`Pull request #${pull_number} is from a fork, skipping auto-merge.`)
                return false
            }

            pull_number = pr.number // Store the PR number

            const prReviewsData = (await octokit.pulls.listReviews({ owner, repo, pull_number })).data

            // Check if the PR was reviewed
            if (prReviewsData.some(r => r.user?.id === stewardUserId)) {
                context.log.warn(`Pull request #${pull_number} is already reviewed by steward, skipping auto-merge.`)
                return false
            }

            const prData = (await octokit.pulls.get({ owner, repo, pull_number })).data

            // Check if the PR was merged
            if (prData.merged) {
                context.log.warn(`Pull request #${pull_number} is already merged, skipping auto-merge.`)
                return false
            }

            // Check if the PR was created by Dependabot (user ID 49699333 is Dependabot's ID)
            if (prData.user.id !== dependabotUserId) {
                context.log.warn(`Pull request #${pull_number} is not from Dependabot, skipping auto-merge.`)
                return false
            }

            const headBranch = pr.head.ref // Head branch of the PR
            // Get all check suites for the head branch
            const headSuitesData = (await octokit.checks.listSuitesForRef({ owner, repo, ref: headBranch })).data

            // If there are no check suites, consider it passed (no checks to fail)
            if (headSuitesData.total_count === 0) {
                return true
            }

            // Filter for valid check suites that have check runs
            const validSuites = headSuitesData.check_suites.filter(cs => cs.latest_check_runs_count > 0)

            // If no valid check suites, consider it passed
            if (validSuites.length === 0) {
                return true
            }

            // Check if any valid check suite is not completed
            if (validSuites.some(cs => cs.status !== 'completed')) {
                context.log.warn(`Pull request #${pull_number}: Some check suites are not yet completed, skipping auto-merge.`)
                return false
            }

            const baseBranch = pr.base.ref // Base branch of the PR
            // Get required status checks from branch protection rules
            const requiredChecks = (await octokit.repos.getBranchRules({ owner, repo, branch: baseBranch })).data
                .filter(r => r.type === 'required_status_checks')
                .flatMap(r => {
                    if (!r.parameters) {
                        return []
                    }
                    return r.parameters.required_status_checks.map(rsc => rsc.context)
                })

            // If no required checks are configured, consider it passed
            if (requiredChecks.length === 0) {
                return true
            }

            // Fetch all check runs for valid suites and filter for successful/skipped/neutral ones
            const passedChecks = (
                await Promise.all(
                    validSuites.map(async vs => {
                        const p = await context.octokit.request({ url: vs.check_runs_url, method: 'GET' })
                        const checkRuns = p.data.check_runs as {
                            name: string
                            conclusion:
                                | 'cancelled'
                                | 'success'
                                | 'failure'
                                | 'neutral'
                                | 'skipped'
                                | 'timed_out'
                                | 'action_required'
                                | 'startup_failure'
                                | 'stale'
                                | null
                        }[]

                        return checkRuns
                            .filter(cr => cr.conclusion === 'success' || cr.conclusion === 'skipped' || cr.conclusion === 'neutral')
                            .map(cr => cr.name)
                    })
                )
            ).flat()

            const passedChecksSet = new Set(passedChecks)
            // Check if all required checks have passed
            const allRequiredChecksPassed = requiredChecks.every(rc => passedChecksSet.has(rc))

            if (!allRequiredChecksPassed) {
                context.log.warn(`Pull request #${pull_number}: Not all required checks have passed, skipping auto-merge.`)
                return false
            }

            return true // All conditions met for merging
        })()

        // If all merge conditions are met, approve and merge the PR
        if (processMerge) {
            if (!pull_number) {
                // This should ideally not happen if processMerge is true, but for type safety
                throw new Error('Pull request number is undefined after successful processing.')
            }

            // Approve the pull request
            await octokit.pulls.createReview({ owner, repo, pull_number, event: 'APPROVE' })
            // Merge the pull request using the determined merge method
            try {
                await octokit.pulls.merge({ owner, repo, pull_number, merge_method })
                context.log.info(`Successfully merged pull request #${pull_number} using ${merge_method} method.`)
            } catch (e: unknown) {
                console.error(e)
            }
        }
    })
}
