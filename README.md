# Master to Main

A CLI tool to rename master branch to main for GitHub repos.

- [Quick Start](#quick-start)
- [Running](#running)
- [Details](#details)
- [Developing](#developing)

# Quick Start

master-to-main can be installed using either npm or yarn

```
npm install -g @guardian/master-to-main
```

```
yarn global add @guardian/master-to-main
```

It can then be run as follows

```sh-session
$ m2m [OWNER/REPO] [TOKEN]
running command...
```

View all options and help information

```
$ m2m --help
...
```

View installed version

```sh-session
$ m2m (-v|--version)
master-to-main/0.0.0 darwin-x64 node-v14.9.0
```

It can also be used directly via npx

```
npx @guardian/master-to-main --help
```

# Running

This tool requires two arguments.

| Argument    | Description                                                                      |
| ----------- | -------------------------------------------------------------------------------- |
| accessToken | A GitHub personal access token. See the [auth](###auth) section for more details |
| repoName    | The name of the repository to migrate in the form `owner/repository`             |

This tool can also be run with a number of options. The following table lists them all.

| Option   | Short | Description                                                                               | Default |
| -------- | ----- | ----------------------------------------------------------------------------------------- | ------- |
| from     | -f    | The current name of the branch                                                            | master  |
| to       | -t    | The new name of the branch                                                                | main    |
| force    | -     | Disable any user prompts                                                                  | false   |
| execute  | -x    | Execute the migration                                                                     | false   |
| verbose  | -     | Output debug logs                                                                         | false   |
| guardian | -     | Run the guardian specific steps around build configuration. Disable using `--no-guardian` | true    |
| issues   | -     | Open issues for any further changes required. Disable using `--no-guardian`               | true    |

As well as this, the `--version` option can be used to display the current version install and the `--help` option can be used to display the help information.

# Details

This tool is built on top of the [oclif](https://oclif.io/) library to provide CLI functionality.

It interfaces with the GitHub API to carry out the necessary [steps](###steps) for the migration (more information below). It makes use of the [octokit](https://github.com/octokit/rest.js/) library.

### Execution

By default, the app runs in dry run mode. This will perform GET requests and log all steps as if they were to be executed. This can be useful both to see how the process works without making changes and to run checks to reduce the chance of encountering an error partway through the process. To execute the change, pass the `-x` or `--execute` flag.

### Auth

Authentication and authorisation is handled using GitHub Personal Access Tokens (PATs). You will need to provide this as the second argument (after the repo name) when you run the tool.

**N.B. Treat your tokens like passwords and keep them secret. Consider using environment variables to store tokens during use and remove any tokens that are not in use.**

You can create a token from the [`Developer settings` tab](https://github.com/settings/tokens/new) within GitHub settings. For public repos, the `public_repo` scope will suffice. For private repos, the `repo` scope is needed.

It is recommended that a new token is created specifically for the purpose of running this tool, so that the token can be removed from your account immediately after the process is complete.

### Steps

The process carries out the following steps in order:

1. Check if the repository exists (by getting the repo object)
1. Check that the old branch name exists
1. Check if the new branch name already exists
1. Check if the user is an admin (by getting the username from the access token and then calling the get repository permissions for user endpoint)
1. Get the number of open PRs and check with that user that they're happy to proceed
1. Rename the branch using the new [rename a branch](https://docs.github.com/en/rest/reference/repos#rename-a-branch) API
1. Check if a `riff-raff.yaml` file is present and open an issue if it is (unless the `--no-guardian` option is passed)
1. Check for any files that reference the old branch name and open an issue if any exist
1. Open an issue to cover any (other) build configuration that may need updating

# Developing

We follow the [`script/task`](https://github.com/github/scripts-to-rule-them-all) pattern,
find useful scripts within the [`script`](./script) directory for common tasks.

- `./script/setup` to install dependencies
- `./script/start` to run the Jest unit tests in watch mode
- `./script/lint` to lint the code using ESLint
- `./script/test` to run the Jest unit tests
- `./script/build` to compile TypeScript to JS

There are also some other commands defined in `package.json`:

- `yarn lint --fix` attempt to autofix any linter errors
- `yarn format` format the code using Prettier

However, it's advised you configure your IDE to format on save to avoid horrible "correct linting" commits.

# Testing 

The [master-to-main-demo](https://github.com/guardian/master-to-main-demo) repository can be used to test this tool. It includes a number of elements to allow the key functionality to be validated. 
