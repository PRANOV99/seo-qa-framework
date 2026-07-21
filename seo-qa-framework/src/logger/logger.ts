import { createLogger, format, transports } from 'winston';
import { testConfig } from '../config/test-config.js';

export const logger = createLogger({
  level: testConfig.logLevel,
  format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
  transports: [
    new transports.Console({
      format: format.combine(format.colorize(), format.simple())
    })
  ]
});
