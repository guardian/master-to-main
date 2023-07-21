import { Octokit } from '@octokit/rest';
import chalk from 'chalk';
import prompts from 'prompts';
import Logger from './logger.js';
import * as emoji from 'node-emoji';

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
    },
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
            'only',
          )} for information\n`,
        ),
      );
    }

    return this.checkRepoExists()
      .then(() => this.checkOldBranchDoesExist())
      .then(() => this.checkNewBranchDoesNotExist())
      .then(() => this.checkAdmin())
      .then(() => this.checkWithUser())
      .then(() => this.renameBranch())
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
            true,
          );
        } else {
          this.logger.information('Dry run complete. Run again with the -x or --execute flag to execute.', true);
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
          error = new Error('You do not have permissions to view this repository');
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
      const permissions = await this.octokit.repos.getCollaboratorPermissionLevel({
        owner: this.owner,
        repo: this.repo,
        username: user.data.login,
      });

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

  async renameBranch(): Promise<void> {
    const msg = `Renaming the branch ${this.oldBranchName} to ${this.newBranchName}`;

    const spinner = this.logger.spin(msg);
    try {
      if (this.execute) {
        await this.octokit.repos.renameBranch({
          owner: this.owner,
          repo: this.repo,
          branch: this.oldBranchName,
          new_name: this.newBranchName,
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
        q: `repo:${this.owner}/${this.repo}+filename:*/riff-raff.yaml`,
      });

      if (!files.data.total_count) {
        this.logger.log('No riff-raff.yaml file found');
        spinner.succeed();
        return;
      }

      if (!this.issues) {
        this.logger.log(`${files.data.total_count} riff-raff.yaml file(s) found.`);
        spinner.succeed();
        return;
      }

      this.logger.log(`${files.data.total_count} riff-raff.yaml file(s) found. Opening an issue.`);
      if (this.execute) {
        await this.octokit.issues.create({
          owner: this.owner,
          repo: this.repo,
          title: 'Update Riff Raff configuration',
          labels: ['master-to-main'],
          body: `The ${this.oldBranchName} branch of this repository has been migrated to ${
            this.newBranchName
          } using the [master-to-main](https://github.com/guardian/master-to-main) tool.

  The following \`riff-raff.yaml\` file(s) have been found in the repostiory:

  ${files.data.items
    .map((item) => {
      return `- [ ] [${item.path}](${item.repository.html_url}/blob/${this.newBranchName}/${item.path})`;
    })
    .join('\n')}

For each deployment, you will need to complete the following steps:

1. Fix continuous deployments: https://riffraff.gutools.co.uk/deployment/continuous
1. Ensure blocked deployments are still blocked: https://riffraff.gutools.co.uk/deployment/restrictions
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
        this.logger.log(`${files.data.total_count} ${files.data.total_count === 1 ? 'file' : 'files'} found.`);
        spinner.succeed();
        return;
      }

      this.logger.log(
        `${files.data.total_count} ${files.data.total_count === 1 ? 'file' : 'files'} found. Opening an issue.`,
      );

      if (this.execute) {
        await this.octokit.issues.create({
          owner: this.owner,
          repo: this.repo,
          title: `Check references to ${this.oldBranchName}`,
          labels: ['master-to-main'],
          body: `The ${this.oldBranchName} branch of this repository has been migrated to ${
            this.newBranchName
          } using the [master-to-main](https://github.com/guardian/master-to-main) tool.

  Some files in the repository contain the word ${
    this.oldBranchName
  }. Please check the following files and update where required:

  ${files.data.items
    .map((item) => {
      return `- [ ] [${item.path}](${item.repository.html_url}/blob/${this.newBranchName}/${item.path})`;
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
          body: `The ${this.oldBranchName} branch of this repository has been migrated to ${
            this.newBranchName
          } using the [master-to-main](https://github.com/guardian/master-to-main) tool.

  Please check any build related configuration and update as required${this.guardian ? ':' : '.'}
          ${
            this.guardian
              ? `
  - [ ] TeamCity - See the required steps in the [migrating.md](https://github.com/guardian/master-to-main/blob/main/migrating.md#update-ci-typically-teamcity) document
  - [ ] Change snyk github integration(s) - it uses the default branch, but you will need to delete and reimport the project+file as this is the only way to refresh the default branch at present.
  - [ ] Any other externally configured analysis tooling your team is using e.g. travis CI
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
