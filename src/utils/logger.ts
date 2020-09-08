import ora, { Ora } from 'ora';
import logSymbols from 'log-symbols';
import chalk from 'chalk';

class Logger {
  verbose: boolean;

  level: string;

  _log: (message: string) => void;
  _warn: (message: string) => void;
  _error: (message: string) => void;

  spinner?: Ora;

  constructor(
    verbose: boolean,
    log: (message: string) => void,
    warn: (message: string) => void,
    error: (message: string) => void
  ) {
    this.verbose = verbose;
    this.level = 'debug';
    this._log = log;
    this._warn = warn;
    this._error = error;
  }

  /* Standard log levels */

  log(message: string): void {
    if (this.spinner && this.spinner.isSpinning) {
      this.spinner.text += `\n    ${chalk.blue('>')} ${chalk.italic(message)}`;
    } else {
      this._log(message);
    }
  }

  info(message: string): void {
    this.log(message);
  }

  debug(message: string): void {
    if (this.verbose) {
      this.log(message);
    }
  }

  warn(message: string): void {
    this._warn(message);
  }

  error(message: string): void;
  error(err: Error): void;

  error(errOrMessage: Error | string): void {
    if (errOrMessage instanceof Error) {
      if (this.verbose) {
        let msg = errOrMessage.message;
        msg += errOrMessage.stack;
        this._error(msg);
      } else {
        this._error(errOrMessage.message);
      }
    } else {
      this._error(errOrMessage);
    }
  }

  /* Log a spinner */

  spin(message: string): Ora {
    if (this.spinner) {
      this.spinner.stop();
    }
    this.spinner = ora(message);
    this.spinner.start();
    return this.spinner;
  }

  /* Log with a symbol at the start */

  success(message: string, newLine = false): void {
    this.log(`${newLine ? '\n' : ''}${logSymbols.success} ${message}`);
  }

  information(message: string, newLine = false): void {
    this.log(`${newLine ? '\n' : ''}${logSymbols.info} ${message}`);
  }
}

export default Logger;
