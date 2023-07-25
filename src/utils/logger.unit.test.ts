import Logger from './logger';
import type { Ora } from 'ora';
import chalk from 'chalk';
import logSymbols from 'log-symbols';
import { jest } from '@jest/globals';

describe('The logger class', () => {
  let log: jest.Mock;
  let warn: jest.Mock;
  let error: jest.Mock;

  beforeAll(() => {
    log = jest.fn();
    warn = jest.fn();
    error = jest.fn();
  });

  beforeEach(() => {
    log.mockReset();
    warn.mockReset();
    error.mockReset();
  });

  describe('log function', () => {
    test('logs the message using the _log function if the spinner value is falsy', () => {
      const logger = new Logger(false, log, warn, error);

      logger.log('this is a test');

      expect(log).toHaveBeenCalledWith('this is a test');
    });

    test('logs the message using the _log function if the spinner value is truthy but the spinner.isSpinning value is falsy', () => {
      const logger = new Logger(false, log, warn, error);
      logger.spinner = {
        isSpinning: false,
      } as Ora;

      logger.log('this is another test');

      expect(log).toHaveBeenCalledWith('this is another test');
    });

    test('updates the spinner text correctly if the spinner value is defined and the spinner.isSpinning value is truthy', () => {
      const logger = new Logger(false, log, warn, error);
      logger.spinner = {
        isSpinning: true,
        text: 'This text was already here.',
      } as Ora;

      logger.log('And here is some more text.');

      expect(log).not.toHaveBeenCalled();
      expect(logger.spinner.text).toBe(
        `This text was already here.\n    ${chalk.blue('>')} ${chalk.italic('And here is some more text.')}`,
      );
    });
  });

  describe('debug function', () => {
    test('does not log if verbose is false', () => {
      const logger = new Logger(false, log, warn, error);

      logger.debug('this is a test');

      expect(log).not.toHaveBeenCalled();
    });

    test('logs if verbose is true', () => {
      const logger = new Logger(true, log, warn, error);

      logger.debug('this is another test');

      expect(log).toHaveBeenCalledWith('this is another test');
    });
  });

  describe('warn function', () => {
    test('calls the _warn function', () => {
      const logger = new Logger(false, log, warn, error);

      logger.warn('this is a test');

      expect(warn).toHaveBeenCalledWith('this is a test');
    });
  });

  describe('error function', () => {
    test('calls the _error function if passed a string', () => {
      const logger = new Logger(false, log, warn, error);

      logger.error('this is a test');

      expect(error).toHaveBeenCalledWith('this is a test');
    });

    test('calls the _error function with the error message if verbose is false', () => {
      const logger = new Logger(false, log, warn, error);

      logger.error(new Error('this is a test'));

      expect(error).toHaveBeenCalledWith('this is a test');
    });

    test('calls the _error function with the error message and stack if verbose is true', () => {
      const logger = new Logger(true, log, warn, error);

      const err = new Error('this is a test');
      err.stack = ' and this is the stack';

      logger.error(err);

      expect(error).toHaveBeenCalledWith('this is a test and this is the stack');
    });
  });

  describe('success function', () => {
    test('calls the log function with a success symfony appended at the start', () => {
      const logger = new Logger(false, log, warn, error);
      logger.success('this is a test');

      expect(log).toHaveBeenCalledWith(`${logSymbols.success} this is a test`);
    });

    test('adds a new line of the option is set to tru', () => {
      const logger = new Logger(false, log, warn, error);
      logger.success('this is a test', true);

      expect(log).toHaveBeenCalledWith(`\n${logSymbols.success} this is a test`);
    });
  });

  describe('information function', () => {
    test('calls the log function with an info symfony appended at the start', () => {
      const logger = new Logger(false, log, warn, error);
      logger.information('this is a test');

      expect(log).toHaveBeenCalledWith(`${logSymbols.info} this is a test`);
    });

    test('adds a new line of the option is set to tru', () => {
      const logger = new Logger(false, log, warn, error);
      logger.information('this is a test', true);

      expect(log).toHaveBeenCalledWith(`\n${logSymbols.info} this is a test`);
    });
  });
});
