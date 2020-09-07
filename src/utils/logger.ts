import ora, { Ora } from 'ora';
import logSymbols from 'log-symbols';
import chalk from 'chalk';

class Logger {
  verbose: boolean;

  _log: (message: string) => void;
  _error: (message: string) => void;

  spinner?: Ora;

  constructor(
    verbose: boolean,
    log: (message: string) => void,
    error: (message: string) => void
  ) {
    this.verbose = verbose;
    this._log = log;
    this._error = error;
  }

  log(message: string): void {
    if (this.spinner && this.spinner.isSpinning) {
      this.spinner.text += `\n    ${chalk.blue('>')} ${chalk.italic(message)}`;
    } else {
      this._log(message);
    }
  }

  debug(message: string): void {
    if (this.verbose) {
      this.log(message);
    }
  }

  error(message: string): void {
    this._error(message);
  }

  spin(message: string): Ora {
    if (this.spinner) {
      this.spinner.stop();
    }
    this.spinner = ora(message);
    this.spinner.start();
    return this.spinner;
  }

  success(message: string, newLine = false): void {
    this.log(`${newLine ? '\n' : ''}${logSymbols.success} ${message}`);
  }

  info(message: string, newLine = false): void {
    this.log(`${newLine ? '\n' : ''}${logSymbols.info} ${message}`);
  }
}

export default Logger;
