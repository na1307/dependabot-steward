# Dependabot Steward

Dependabot Steward is a GitHub App built with [Probot](https://probot.github.io/) that automatically merges Dependabot pull requests when all status checks have passed.

## How It Works

1.  The app listens for the `check_suite.completed` webhook event.
2.  When a check suite completes, it verifies the following conditions for the associated pull request:
    *   The pull request was created by Dependabot.
    *   The pull request is not from a forked repository.
    *   All required status checks and branch protection rules have passed.
3.  If all conditions are met, the app will:
    *   Approve the pull request.
    *   Merge the pull request using the repository's default merge method (merge, squash, or rebase).

This helps maintain dependencies by ensuring that updates are automatically merged only when they are safe to do so, without manual intervention.

## License

[MIT](./LICENSE)
