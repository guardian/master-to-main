#!/usr/bin/env node

import MasterToMain from '../lib/index.js';
import oclif from '@oclif/core';
import process from 'node:process';

MasterToMain.run(process.argv.slice(2), import.meta.url)
.then(oclif.flush)
.catch(oclif.Errors.handle);
