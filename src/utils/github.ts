import { Octokit } from '@octokit/rest';
import chalk from 'chalk';
import {
  ReposGetBranchProtectionResponseData,
  PullsListResponseData,
  OctokitResponse,
} from '@octokit/types';
import prompts from 'prompts';
import Logger from './logger';
import emoji from 'node-emoji';

class GitHub {
  owner: string;
  repo: string;

  newBranchName: string;
  oldBranchName: string;
  force: boolean;
  dryRun: boolean;

  octokit: Octokit;
  logger: Logger;

  constructor(
    owner: string,
    repo: string,
    token: string,
    logger: Logger,
    flags: {
      from: string;
      to: string;
      force: boolean;
      'dry-run': boolean;
    }
  ) {
    this.owner = owner;
    this.repo = repo;
    this.logger = logger;

    this.oldBranchName = flags.from;
    this.newBranchName = flags.to;
    this.force = flags.force;
    this.dryRun = flags['dry-run'];

    this.octokit = new Octokit({
      auth: token,
      previews: ['luke-cage-preview', 'zzzax-preview'],
    });
  }

  // TODO: Add verbose logging
  async run(): Promise<void> {
    if (this.dryRun) {
      this.logger.info(
        `Runing in dry-run mode. The following steps will be printed ${chalk.underline(
          'only'
        )} for information\n`
      );
    }

    return this.checkRepoExists()
      .then(() => this.checkOldBranchDoesExist())
      .then(() => this.checkNewBranchDoesNotExist())
      .then(() => this.checkAdmin())
      .then(() => this.checkWithUser())
      .then(() => this.createNewBranch())
      .then(() => this.updateDefaultBranch())
      .then(() => this.updateBranchProtection())
      .then(() => this.updatePullRequests())
      .then(() => this.deleteOldBranch())
      .then(() => {
        if (this.dryRun) {
          this.logger.info(
            'Dry run complete. Run again without the --dry-run flag to execute.',
            true
          );
        } else {
          this.logger.log(emoji.emojify(`\n:tada: Success! :tada:`));
        }
      })
      .catch((err: Error) => {
        this.logger.error(err.message);
      });
  }

  async checkRepoExists(): Promise<void> {
    const msg = 'Checking that the repository exists';

    // TODO: Can we do this better? Maybe with decorators
    if (this.dryRun) {
      return this.logger.success(msg);
    }

    // TODO: Can we do this better? Maybe with decorators
    const spinner = this.logger.spin(msg);
    try {
      await this.octokit.repos.get({
        owner: this.owner,
        repo: this.repo,
      });

      spinner.succeed();
    } catch (err) {
      let error: Error;
      switch (err.status) {
        case 404:
          error = new Error('Repository not found');
          break;
        case 401:
          error = new Error(
            'You do not have permissions to view this repository'
          );
          break;
        default:
          error = new Error(`An unknown error occurred - ${err.message}`);
      }
      spinner.fail(error.message);
      throw error;
    }
  }

  async checkOldBranchDoesExist(): Promise<void> {
    const msg = `Checking that the ${this.oldBranchName} branch exists`;

    if (this.dryRun) {
      return this.logger.success(msg);
    }

    const spinner = this.logger.spin(msg);
    try {
      await this.octokit.repos.getBranch({
        owner: this.owner,
        repo: this.repo,
        branch: this.oldBranchName,
      });

      spinner.succeed();
    } catch (err) {
      spinner.fail();
      throw err;
    }
  }

  async checkNewBranchDoesNotExist(): Promise<void> {
    const msg = `Checking that the ${this.newBranchName} branch does not exist`;

    if (this.dryRun) {
      return this.logger.success(msg);
    }

    const spinner = this.logger.spin(msg);
    try {
      const branch = await this.octokit.repos.getBranch({
        owner: this.owner,
        repo: this.repo,
        branch: this.newBranchName,
      });

      if (branch.status === 200) {
        throw new Error(`The ${this.newBranchName} branch already exists`);
      }
      spinner.succeed();
    } catch (err) {
      if (err.status === 404) {
        spinner.succeed();
        return;
      } else {
        spinner.fail(err.message);
        throw err;
      }
    }
  }

  // TODO: Verify this actually ensures the required permission levels
  async checkAdmin(): Promise<void> {
    const msg = `Checking that you have the required permissions ${chalk.italic(
      `(by checking if you can get the ${this.newBranchName} branch protection)`
    )}`;

    if (this.dryRun) {
      return this.logger.success(msg);
    }

    const spinner = this.logger.spin(msg);
    try {
      await this.octokit.repos.getBranchProtection({
        owner: this.owner,
        repo: this.repo,
        branch: this.oldBranchName,
      });
      spinner.succeed();
    } catch (err) {
      let error: Error;
      if (err.status === 401) {
        error = new Error(
          'You must be a repo admin to complete this migration'
        );
      } else if (err.status === 404 && err.message === 'Branch not protected') {
        spinner.succeed();
        return;
      } else {
        error = err;
      }
      spinner.fail();
      throw error;
    }
  }

  async checkWithUser(): Promise<void> {
    const msg = `Checking the number of open pull requests to ${this.oldBranchName} and confirming actions with user`;
    if (this.dryRun) {
      return this.logger.success(msg);
    }

    const spinner = this.logger.spin(msg);

    let numberOfTotalOpenPullRequests: number;

    try {
      const prs = await this.octokit.search.issuesAndPullRequests({
        q: `type:pr+state:open+base:${this.oldBranchName}+repo:${this.owner}/${this.repo}`,
      });
      numberOfTotalOpenPullRequests = prs.data.total_count;
      spinner.succeed();
    } catch (err) {
      spinner.fail();
      throw err;
    }

    const prompt = `This script will now update the ${this.oldBranchName} branch to ${this.newBranchName} on the ${this.owner}/${this.repo} repository. ${numberOfTotalOpenPullRequests} open pull requests will be updated.`;

    if (this.force) {
      this.logger.log(chalk.bold(prompt));
    } else {
      const response = await prompts({
        type: 'confirm',
        name: 'value',
        message: `${prompt}\n  Are you happy to proceed?`,
        initial: true,
      });
      if (!response.value) throw new Error(`Process aborted`);
    }
  }

  async createNewBranch(): Promise<void> {
    const msg = `Creating the new branch (${this.newBranchName})`;
    if (this.dryRun) {
      return this.logger.success(msg);
    }

    const spinner = this.logger.spin(msg);
    try {
      this.logger.log(`Getting the sha of the heads/${this.oldBranchName} ref`);
      const refs = await this.octokit.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${this.oldBranchName}`,
      });

      this.logger.log(
        `Creating the heads/${this.newBranchName} ref with the same sha`
      );
      await this.octokit.git.createRef({
        owner: this.owner,
        repo: this.repo,
        ref: `refs/heads/${this.newBranchName}`,
        sha: refs.data.object.sha,
      });
      spinner.succeed();
    } catch (err) {
      spinner.fail();
      throw err;
    }
  }

  // TODO: Check that the old branch was default before doing this
  async updateDefaultBranch(): Promise<void> {
    const msg = `Updating the default branch to be the new branch (${this.newBranchName})`;

    if (this.dryRun) {
      return this.logger.success(msg);
    }

    const spinner = this.logger.spin(msg);
    try {
      await this.octokit.repos.update({
        owner: this.owner,
        repo: this.repo,
        default_branch: this.newBranchName,
      });
      spinner.succeed();
    } catch (err) {
      spinner.fail();
      throw err;
    }
  }

  async updateBranchProtection(): Promise<void> {
    const msg = `Moving branch protection from ${this.oldBranchName} to ${this.newBranchName}`;

    if (this.dryRun) {
      return this.logger.success(msg);
    }

    const spinner = this.logger.spin(msg);
    try {
      this.logger.log(
        `Geting the branch protection settings for ${this.oldBranchName}`
      );
      const protection = await this.octokit.repos.getBranchProtection({
        owner: this.owner,
        repo: this.repo,
        branch: this.oldBranchName,
      });

      // The required_signatures properties isn't in the type yet
      // as it's still a preview feature
      const p: ReposGetBranchProtectionResponseData & {
        required_signatures?: { enabled: boolean };
      } = protection.data;

      // Generate the new permissions object from the response
      // This mainly involves stripping out lots of extra information
      // but also some restructuring
      this.logger.log(
        `Creating the branch protection options object for ${this.newBranchName}`
      );
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

      this.logger.log(
        `Updating the branch proction settings for ${this.newBranchName}`
      );
      await this.octokit.repos.updateBranchProtection({
        owner: this.owner,
        repo: this.repo,
        branch: this.newBranchName,
        ...newProtection,
      });

      // We need to delete the branch protection of the old branch
      // so that we can delete the branch later
      this.logger.log(
        `Removing branch protection on ${this.oldBranchName} ${chalk.italic(
          `(so that we can delete it later)`
        )}`
      );
      await this.octokit.repos.deleteBranchProtection({
        owner: this.owner,
        repo: this.repo,
        branch: this.oldBranchName,
      });

      spinner.succeed();
    } catch (err) {
      if (err.status === 404 && err.message === 'Branch not protected') {
        this.logger.log(
          `No branch protection on ${this.oldBranchName} so skipping remaining steps`
        );
        spinner.succeed();
        return;
      } else {
        spinner.fail();
        throw err;
      }
    }
  }

  async updatePullRequests(): Promise<void> {
    const msg = `Updating all pull requests to have ${this.newBranchName} as a base`;

    if (this.dryRun) {
      return this.logger.success(msg);
    }

    const spinner = this.logger.spin(msg);
    try {
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
          base: this.oldBranchName,
        });

        for await (const pr of response.data as PullsListResponseData) {
          this.logger.log(`Updating pull request ${pr.number}`);
          await this.octokit.pulls.update({
            owner: this.owner,
            repo: this.repo,
            pull_number: pr.number,
            base: this.newBranchName,
          });
        }
      } while (response.data.length);

      spinner.succeed();
    } catch (err) {
      spinner.fail();
      throw err;
    }
  }

  async deleteOldBranch(): Promise<void> {
    const msg = `Deleting the ${this.oldBranchName} branch`;

    if (this.dryRun) {
      return this.logger.success(msg);
    }

    const spinner = this.logger.spin(msg);
    try {
      await this.octokit.git.deleteRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${this.oldBranchName}`,
      });
      spinner.succeed();
    } catch (err) {
      spinner.fail();
      throw err;
    }
  }
}

export default GitHub;
