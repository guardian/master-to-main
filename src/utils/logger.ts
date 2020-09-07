import ora, { Ora } from 'ora';

class Logger {
  verbose: boolean;
  _log: (message: string) => void;
  _debug: (message: string) => void;

  constructor(
    verbose: boolean,
    log: (message: string) => void,
    debug: (message: string) => void
  ) {
    this.verbose = verbose;
    this._log = log;
    this._debug = debug;
  }

  debug(message: string): void {
    this._debug(message);
  }

  log(message: string): void {
    this._log(message);
  }

  spinner(message: string): Ora {
    return ora(message).start();
  }
}

export default Logger;
