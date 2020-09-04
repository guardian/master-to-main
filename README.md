Master to Main
==============

A CLI tool to rename master branch to main for GitHub repos

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/master-to-main.svg)](https://npmjs.org/package/master-to-main)
[![Downloads/week](https://img.shields.io/npm/dw/master-to-main.svg)](https://npmjs.org/package/master-to-main)
[![License](https://img.shields.io/npm/l/master-to-main.svg)](https://github.com/guardian/master-to-main/blob/master/package.json)

<!-- toc -->
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
# Usage
<!-- usage -->
```sh-session
$ npm install -g master-to-main
$ m2m COMMAND
running command...
$ m2m (-v|--version|version)
master-to-main/0.0.0 darwin-x64 node-v14.9.0
$ m2m --help [COMMAND]
USAGE
  $ m2m COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->

<!-- commandsstop -->

# Steps

1. Check if the repository exists (by getting the repo object)
2. Check if the user is an admin (by getting the branch protection for the master branch)
3. Check if the new branch name already exists
4. Get the most recent commit sha from the master branch
5. Create the new branch
6. Update the default branch
7. Update branch permissions
8. Update all outstanding PRs
9. Delete the master branch