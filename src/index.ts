import { Command, flags } from '@oclif/command';
import GitHub from './utils/github';

class MasterToMain extends Command {
  static description = 'Rename master branch of a GitHub repository to main';

  static flags = {
    version: flags.version({ char: 'v' }),
    help: flags.help({ char: 'h' }),

    accessToken: flags.string({
      char: 't',
      description:
        'A personal access token to authenticate against the GitHub API',
      required: true,
    }),
    repoName: flags.string({
      char: 'n',
      description:
        'The name of the repository to update in the form `owner/repo`',
      required: true,
    }),
    newBranchName: flags.string({
      char: 'b',
      description: 'The name to give the new branch',
      required: false,
      default: 'main',
    }),
  };

  async run(): Promise<void> {
    const { flags } = this.parse(MasterToMain);

    const [owner, repo] = flags.repoName.split('/');

    if (!repo) {
      return this.error(
        'The repoName (-n) value must be in the form `owner/repo`'
      );
    }

    const logger = {
      debug: this.debug,
      log: this.log,
      warn: this.warn,
      error: this.error,
    };

    const gh = new GitHub(
      owner,
      repo,
      flags.accessToken,
      flags.newBranchName,
      logger
    );

    const err = await gh.run();

    if (err instanceof Error) {
      return this.error(err.message);
    }

    return this.log('Success!');
  }
}

export = MasterToMain;
