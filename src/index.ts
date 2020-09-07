import { Command, flags } from '@oclif/command';
import GitHub from './utils/github';
import Logger from './utils/logger';

class MasterToMain extends Command {
  static description = 'Rename a GitHub repository branch';

  static args = [
    {
      name: 'repository',
      required: true,
      description:
        'The name of the repository to update in the form `owner/repo`',
    },
    {
      name: 'token',
      required: true,
      description:
        'A personal access token to authenticate against the GitHub API',
    },
  ];

  static flags = {
    version: flags.version({ char: 'v', hidden: true }),
    help: flags.help({ char: 'h', hidden: true }),

    force: flags.boolean({
      default: false,
      description: 'Disable any user prompts',
    }),
    'dry-run': flags.boolean({
      default: false,
      description: 'Log all of the steps but do not execute',
    }),
    verbose: flags.boolean({
      default: false,
      description: 'Output debug logs',
    }),

    from: flags.string({
      char: 'f',
      description: 'The current name of the branch',
      required: false,
      default: 'master',
    }),
    to: flags.string({
      char: 't',
      description: 'The new name of the branch',
      required: false,
      default: 'main',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = this.parse(MasterToMain);

    const [owner, repo] = args.repository.split('/');

    if (!repo) {
      return this.error(
        'The repository argument must be in the form `owner/repo`'
      );
    }

    const logger = new Logger(flags.verbose, this.debug, this.log, this.error);

    const gh = new GitHub(owner, repo, args.token, logger, flags);

    await gh.run();
  }
}

export = MasterToMain;
