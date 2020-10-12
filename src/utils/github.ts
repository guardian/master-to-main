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
  execute: boolean;
  guardian: boolean;
  issues: boolean;

  octokit: Octokit;
  logger: Logger;

  defaultBranch = '';

  constructor(
    owner: string,
    repo: string,
    token: string,
    logger: Logger,
    flags: {
      from: string;
      to: string;
      force: boolean;
      execute: boolean;
      guardian: boolean;
      issues: boolean;
    }
  ) {
    this.owner = owner;
    this.repo = repo;
    this.logger = logger;

    this.oldBranchName = flags.from;
    this.newBranchName = flags.to;
    this.force = flags.force;
    this.execute = flags.execute;
    this.guardian = flags.guardian;
    this.issues = flags.issues;

    this.octokit = new Octokit({
      auth: token,
      previews: ['luke-cage-preview', 'zzzax-preview'],
      log: {
        debug: (message: string, ...args): void => {
          this.logger.debug(`${message} ${JSON.stringify(args)}`);
        },
        info: (message: string): void => {
          this.logger.debug(message);
        },
        warn: (message: string): void => {
          this.logger.warn(message);
        },
        error: (message: string): void => {
          this.logger.error(message);
        },
      },
    });
  }

  async run(): Promise<void> {
    if (!this.execute) {
      this.logger.information(
        chalk.bgBlue.white(
          `Running in dry-run mode. No changes will be made - steps that produce changes will be printed ${chalk.underline(
            'only'
          )} for information\n`
        )
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
      .then(() => this.checkRiffRaffFile())
      .then(() => this.checkReferencesToOldBranch())
      .then(() => this.openOtherConfigurationIssue())
      .then(() => {
        if (this.execute) {
          this.logger.log(emoji.emojify(`\n:tada: Success! :tada:`));
          this.logger.information(
            `Local copies of the repository can be updated by running the following commands:

$ git fetch --all
$ git remote set-head origin -a
$ git branch --set-upstream-to origin/${this.newBranchName}
$ git branch -m ${this.oldBranchName} ${this.newBranchName}
             `,
            true
          );
        } else {
          this.logger.information(
            'Dry run complete. Run again without the -x or --execute flag to execute.',
            true
          );
        }
      })
      .catch((err: Error) => {
        this.logger.error(err);
      });
  }

  /* Steps */

  async checkRepoExists(): Promise<void> {
    const msg = 'Checking that the repository exists';

    const spinner = this.logger.spin(msg);
    try {
      const repo = await this.octokit.repos.get({
        owner: this.owner,
        repo: this.repo,
      });

      // Store default branch so we can use it later
      this.defaultBranch = repo.data.default_branch;

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

  async checkAdmin(): Promise<void> {
    const msg = `Checking that you have the required permissions`;

    const spinner = this.logger.spin(msg);
    try {
      this.logger.log('Getting username from access token');
      const user = await this.octokit.users.getAuthenticated();

      this.logger.log('Getting repositoring permissions for user');
      const permissions = await this.octokit.repos.getCollaboratorPermissionLevel(
        {
          owner: this.owner,
          repo: this.repo,
          username: user.data.login,
        }
      );

      if (permissions.data.permission === 'admin') {
        spinner.succeed();
      } else {
        throw new Error('You must be a repo admin to complete this migration');
      }
    } catch (err) {
      spinner.fail();
      throw err;
    }
  }

  async checkWithUser(): Promise<void> {
    const msg = `Checking the number of open pull requests to ${this.oldBranchName} and confirming actions with user`;

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

    const verb = this.execute ? 'will' : 'would';
    let prompt = `This script ${verb} now update the ${this.oldBranchName} branch to ${this.newBranchName} on the ${this.owner}/${this.repo} repository. `;
    const prPrompt = `${numberOfTotalOpenPullRequests} open pull requests ${verb} be updated.`;
    if (numberOfTotalOpenPullRequests > 30) {
      prompt += chalk.bgYellow.black(prPrompt);
    } else if (numberOfTotalOpenPullRequests > 50) {
      prompt += chalk.bgRed.white(prPrompt);
    } else {
      prompt += prPrompt;
    }

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

    const spinner = this.logger.spin(msg);
    try {
      this.logger.log(`Getting the sha of the heads/${this.oldBranchName} ref`);
      const refs = await this.octokit.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${this.oldBranchName}`,
      });

      this.logger.log(
        `Creating the heads/${this.newBranchName} ref with the sha ${refs.data.object.sha}`
      );

      if (this.execute) {
        await this.octokit.git.createRef({
          owner: this.owner,
          repo: this.repo,
          ref: `refs/heads/${this.newBranchName}`,
          sha: refs.data.object.sha,
        });
      }

      spinner.succeed();
    } catch (err) {
      spinner.fail();
      throw err;
    }
  }

  async updateDefaultBranch(): Promise<void> {
    if (this.oldBranchName !== this.defaultBranch) {
      this.logger.success(
        `Updating the default branch - The old branch ${this.oldBranchName} was not the default ${this.defaultBranch}. Skipping this step.`
      );
      return;
    }

    const spinner = this.logger.spin(
      `Updating the default branch to be the new branch (${this.newBranchName})`
    );

    try {
      if (this.execute) {
        await this.octokit.repos.update({
          owner: this.owner,
          repo: this.repo,
          default_branch: this.newBranchName,
        });
      }
      spinner.succeed();
    } catch (err) {
      spinner.fail();
      throw err;
    }
  }

  async updateBranchProtection(): Promise<void> {
    const msg = `Moving branch protection from ${this.oldBranchName} to ${this.newBranchName}`;

    const spinner = this.logger.spin(msg);
    try {
      this.logger.log(
        `Getting the branch protection settings for ${this.oldBranchName}`
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
      if (!p.required_pull_request_reviews?.dismissal_restrictions) {
        delete newProtection.required_pull_request_reviews
          ?.dismissal_restrictions;
      }

      this.logger.debug(
        `New branch protection settings ${JSON.stringify(newProtection)}`
      );

      this.logger.log(
        `Updating the branch proction settings for ${this.newBranchName}`
      );
      if (this.execute) {
        await this.octokit.repos.updateBranchProtection({
          owner: this.owner,
          repo: this.repo,
          branch: this.newBranchName,
          ...newProtection,
        });
      }

      // We need to delete the branch protection of the old branch
      // so that we can delete the branch later
      this.logger.log(
        `Removing branch protection on ${this.oldBranchName} ${chalk.italic(
          `(so that we can delete it later)`
        )}`
      );
      if (this.execute) {
        await this.octokit.repos.deleteBranchProtection({
          owner: this.owner,
          repo: this.repo,
          branch: this.oldBranchName,
        });
      }

      spinner.succeed();
    } catch (err) {
      if (err.status === 404 && err.message === 'Branch not protected') {
        this.logger.log(
          `No branch protection on ${this.oldBranchName} so skipping remaining steps`
        );
        spinner.succeed();
        return;
      } else if (
        err.status === 403 &&
        err.message ===
          'Upgrade to GitHub Pro or make this repository public to enable this feature.'
      ) {
        this.logger.log(
          'No branch proection (as not available on your tier) so skipping remaining steps'
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

    // We can't get the pull requests and only log them in dry run mode
    // due to the way the pagination works
    if (!this.execute) {
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

    const spinner = this.logger.spin(msg);
    try {
      if (this.execute) {
        await this.octokit.git.deleteRef({
          owner: this.owner,
          repo: this.repo,
          ref: `heads/${this.oldBranchName}`,
        });
      }
      spinner.succeed();
    } catch (err) {
      spinner.fail();
      throw err;
    }
  }

  async checkRiffRaffFile(): Promise<void> {
    if (!this.guardian) return;
    const msg = `Checking to see if a riff-raff.yaml file exists`;

    const spinner = this.logger.spin(msg);
    try {
      const files = await this.octokit.search.code({
        q: `repo:${this.owner}/${this.repo}+filename:riff-raff.yaml`,
      });

      if (!files.data.total_count) {
        this.logger.log('No riff-raff.yaml file found');
        spinner.succeed();
        return;
      }

      if (!this.issues) {
        this.logger.log('riff-raff.yaml file found.');
        spinner.succeed();
        return;
      }

      this.logger.log('riff-raff.yaml file found. Opening an issue.');
      if (this.execute) {
        await this.octokit.issues.create({
          owner: this.owner,
          repo: this.repo,
          title: 'Update Riff Raff configuration',
          labels: ['master-to-main'],
          body: `The ${this.oldBranchName} branch of this repository has been migrated to ${this.newBranchName} using the [master-to-main](https://github.com/guardian/master-to-main) tool.

  A \`riff-raff.yaml\` file has been found in the repostiory meaning that you may need to update you riff-raff configuration in both of the following places:
  - https://riffraff.gutools.co.uk/deployment/continuous
  - https://riffraff.gutools.co.uk/deployment/restrictions
          `,
        });
      }

      spinner.succeed();
    } catch (err) {
      spinner.fail();
      throw err;
    }
  }

  async checkReferencesToOldBranch(): Promise<void> {
    const msg = `Checking to see if any files reference ${this.oldBranchName}`;

    const spinner = this.logger.spin(msg);
    try {
      const files = await this.octokit.search.code({
        q: `repo:${this.owner}/${this.repo}+${this.oldBranchName}`,
      });

      if (!files.data.total_count) {
        this.logger.log('No references found');
        spinner.succeed();
        return;
      }

      if (!this.issues) {
        this.logger.log(
          `${files.data.total_count} ${
            files.data.total_count === 1 ? 'file' : 'files'
          } found.`
        );
        spinner.succeed();
        return;
      }

      this.logger.log(
        `${files.data.total_count} ${
          files.data.total_count === 1 ? 'file' : 'files'
        } found. Opening an issue.`
      );

      if (this.execute) {
        await this.octokit.issues.create({
          owner: this.owner,
          repo: this.repo,
          title: `Check references to ${this.oldBranchName}`,
          labels: ['master-to-main'],
          body: `The ${
            this.oldBranchName
          } branch of this repository has been migrated to ${
            this.newBranchName
          } using the [master-to-main](https://github.com/guardian/master-to-main) tool.

  Some files in the repository contain the word ${
    this.oldBranchName
  }. Please check the following files and update where required:

  ${files.data.items
    .map((item) => {
      return `- [${item.path}](${item.repository.html_url}/blob/${this.newBranchName}/${item.path})`;
    })
    .join('\n')}
          `,
        });
      }

      spinner.succeed();
    } catch (err) {
      spinner.fail();
      throw err;
    }
  }

  async openOtherConfigurationIssue(): Promise<void> {
    if (!this.issues) {
      return;
    }

    const msg = `Opening issue regarding other configuration`;

    const spinner = this.logger.spin(msg);
    try {
      if (this.execute) {
        await this.octokit.issues.create({
          owner: this.owner,
          repo: this.repo,
          title: `Update ${this.guardian ? 'other' : ''} build configuration`,
          labels: ['master-to-main'],
          body: `The ${
            this.oldBranchName
          } branch of this repository has been migrated to ${
            this.newBranchName
          } using the [master-to-main](https://github.com/guardian/master-to-main) tool.

  Please check any build related configuration and update as required${
    this.guardian ? ':' : '.'
  }
          ${
            this.guardian
              ? `
  - TeamCity
  - Change snyk github integration(s) - it uses the default branch, but you will need to delete and reimport the project+file as this is the only way to refresh the default branch at present.
  - Any other externally configured analysis tooling your team is using e.g. travis CI
          `
              : ''
          }

  It's probably a good idea to merge test PR to ${
    this.newBranchName
  } once this is complete, to make sure that everything is working as expected. :slightly_smiling_face:
          `,
        });
      }

      spinner.succeed();
    } catch (err) {
      spinner.fail();
      throw err;
    }
  }
}

export default GitHub;
