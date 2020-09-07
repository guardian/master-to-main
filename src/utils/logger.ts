import ora, { Ora } from 'ora';
import logSymbols from 'log-symbols';

class Logger {
  verbose: boolean;

  _debug: (message: string) => void;
  _log: (message: string) => void;
  _error: (message: string) => void;

  constructor(
    verbose: boolean,
    debug: (message: string) => void,
    log: (message: string) => void,
    error: (message: string) => void
  ) {
    this.verbose = verbose;
    this._debug = debug;
    this._log = log;
    this._error = error;
  }

  debug(message: string): void {
    this._debug(message);
  }

  log(message: string): void {
    this._log(message);
  }

  error(message: string): void {
    this._error(message);
  }

  spinner(message: string): Ora {
    return ora(message).start();
  }

  success(message: string, newLine = false): void {
    this._log(`${newLine ? '\n' : ''}${logSymbols.success} ${message}`);
  }

  info(message: string, newLine = false): void {
    this._log(`${newLine ? '\n' : ''}${logSymbols.info} ${message}`);
  }
}

export default Logger;
