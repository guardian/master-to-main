import { Logger } from '../types/Logger';
import { Octokit } from '@octokit/rest';
import {
  ReposGetBranchProtectionResponseData,
  PullsListResponseData,
  OctokitResponse,
} from '@octokit/types';
import prompts from 'prompts';

class GitHub {
  owner: string;
  repo: string;
  newBranchName: string;

  octokit: Octokit;

  logger: Logger;

  constructor(
    owner: string,
    repo: string,
    token: string,
    newBranchName: string,
    logger: Logger
  ) {
    this.owner = owner;
    this.repo = repo;
    this.newBranchName = newBranchName;
    this.logger = logger;

    this.octokit = new Octokit({
      auth: token,
      previews: ['luke-cage-preview', 'zzzax-preview'],
    });
  }

  // TODO: Add proper logging and test
  // TODO: Test verbose
  // TODO: Add a dry run option to log debug steps but not execute
  // TODO: Add a force options to disable user prompts
  // TODO: Make old branch configurable
  async run(): Promise<Error | void> {
    return this.checkRepoExists()
      .then(() => this.checkAdmin())
      .then(() => this.checkNewBranchDoesNotExist())
      .then(() => this.checkNumberOfOpenPullRequests())
      .then(() => this.getMasterCommitSha())
      .then((sha) => this.createNewBranch(sha))
      .then(() => this.updateDefaultBranch())
      .then(() => this.updateBranchProtection())
      .then(() => this.updatePullRequests())
      .then(() => this.deleteMaster())
      .catch((err: Error) => err);
  }

  async checkRepoExists(): Promise<void> {
    try {
      await this.octokit.repos.get({
        owner: this.owner,
        repo: this.repo,
      });

      this.logger.debug('Confirmed repo exists');
    } catch (err) {
      switch (err.status) {
        case 404:
          throw new Error('Repository not found');
        case 401:
          throw new Error(
            'You do not have permissions to view this repository'
          );
        default:
          throw new Error(`An unknown error occurred - ${err.message}`);
      }
    }
  }

  // TODO: Verify this actually ensures the required permission levels
  async checkAdmin(): Promise<void> {
    try {
      await this.octokit.repos.getBranchProtection({
        owner: this.owner,
        repo: this.repo,
        branch: 'master',
      });
    } catch (err) {
      if (err.status === 401) {
        throw new Error('You must be a repo admin to complete this migration');
      } else if (err.status === 404 && err.message === 'Branch not protected') {
        return;
      } else {
        throw err;
      }
    }
  }

  async checkNewBranchDoesNotExist(): Promise<void> {
    try {
      const branch = await this.octokit.repos.getBranch({
        owner: this.owner,
        repo: this.repo,
        branch: this.newBranchName,
      });

      if (branch.status === 200) {
        throw new Error(`The ${this.newBranchName} branch already exists`);
      }
    } catch (err) {
      if (err.status === 404) {
        return;
      } else {
        throw err;
      }
    }
  }

  async checkNumberOfOpenPullRequests(): Promise<void> {
    const prs = await this.octokit.search.issuesAndPullRequests({
      q: `type:pr+state:open+base:master+repo:${this.owner}/${this.repo}`,
    });
    const numberOfTotalOpenPullRequests = prs.data.total_count;
    const response = await prompts({
      type: 'confirm',
      name: 'value',
      message: `This script will now change ${numberOfTotalOpenPullRequests} open pull requests from master to ${this.newBranchName}. Are you happy to proceed?`,
      initial: true,
    });
    if (!response.value) throw new Error(`Process aborted`);
  }

  async getMasterCommitSha(): Promise<string> {
    const refs = await this.octokit.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: 'heads/master',
    });

    return refs.data.object.sha;
  }

  async createNewBranch(sha: string): Promise<void> {
    await this.octokit.git.createRef({
      owner: this.owner,
      repo: this.repo,
      ref: `refs/heads/${this.newBranchName}`,
      sha,
    });
  }

  async updateDefaultBranch(): Promise<void> {
    await this.octokit.repos.update({
      owner: this.owner,
      repo: this.repo,
      default_branch: this.newBranchName,
    });
  }

  async updateBranchProtection(): Promise<void> {
    try {
      const protection = await this.octokit.repos.getBranchProtection({
        owner: this.owner,
        repo: this.repo,
        branch: 'master',
      });

      // The required_signatures properties isn't in the type yet
      // as it's still a preview feature
      const p: ReposGetBranchProtectionResponseData & {
        required_signatures?: { enabled: boolean };
      } = protection.data;

      // Generate the new permissions object from the response
      // This mainly involves stripping out lots of extra information
      // but also some restructuring
      const newProtection = {
        required_status_checks: p.required_status_checks
          ? {
              strict: p.required_status_checks.strict,
              contexts: p.required_status_checks.contexts,
            }
          : null,
        enforce_admins: p.enforce_admins.enabled ? true : null,
        required_pull_request_reviews: p.required_pull_request_reviews
          ? {
              dismissal_restrictions: p.required_pull_request_reviews
                .dismissal_restrictions
                ? {
                    users: p.required_pull_request_reviews.dismissal_restrictions.users.map(
                      (user) => user.login
                    ),
                    teams: p.required_pull_request_reviews.dismissal_restrictions.teams.map(
                      (team) => team.slug
                    ),
                  }
                : undefined,
              dismiss_stale_reviews:
                p.required_pull_request_reviews.dismiss_stale_reviews,
              require_code_owner_reviews:
                p.required_pull_request_reviews.require_code_owner_reviews,
              required_approving_review_count:
                p.required_pull_request_reviews
                  .required_approving_review_count || 1,
            }
          : null,
        restrictions: p.restrictions
          ? {
              users: p.restrictions.users.map((user) => user.login),
              teams: p.restrictions.teams.map((team) => team.slug),
              apps: p.restrictions.apps.map((app) => app.slug),
            }
          : null,
        required_signatures: p.required_signatures?.enabled,
        required_linear_history: p.required_linear_history.enabled,
        allow_force_pushes: p.allow_force_pushes.enabled,
        allow_deletions: p.allow_deletions.enabled,
      };

      // This key needs to not be in the object at all if not required
      if (!p.required_pull_request_reviews.dismissal_restrictions) {
        delete newProtection.required_pull_request_reviews
          ?.dismissal_restrictions;
      }

      await this.octokit.repos.updateBranchProtection({
        owner: this.owner,
        repo: this.repo,
        branch: this.newBranchName,
        ...newProtection,
      });

      // We need to delete the branch protection of master
      // so that we can delete the branch later
      await this.octokit.repos.deleteBranchProtection({
        owner: this.owner,
        repo: this.repo,
        branch: 'master',
      });
    } catch (err) {
      if (err.status === 404 && err.message === 'Branch not protected') {
        return;
      } else {
        throw err;
      }
    }
  }

  async updatePullRequests(): Promise<void> {
    // We can't do normal paginate as we're modifying the PRs
    // so when we query the next page it looks like we've got
    // everything. Instead, we just query for the first page
    // each time until it's empty
    let response: OctokitResponse<PullsListResponseData>;
    do {
      response = await this.octokit.pulls.list({
        owner: this.owner,
        repo: this.repo,
        state: `open`,
        base: `master`,
      });

      for await (const pr of response.data as PullsListResponseData) {
        await this.octokit.pulls.update({
          owner: this.owner,
          repo: this.repo,
          pull_number: pr.number,
          base: this.newBranchName,
        });
      }
    } while (response.data.length);
  }

  async deleteMaster(): Promise<void> {
    await this.octokit.git.deleteRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/master`,
    });
  }
}

export default GitHub;
