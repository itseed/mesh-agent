import pino from 'pino';
import { env, isProd, isTest } from '../env.js';

export const loggerOptions: pino.LoggerOptions = {
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-hub-signature-256"]',
      'res.headers["set-cookie"]',
      '*.token',
      '*.password',
      '*.access_token',
      '*.client_secret',
    ],
    censor: '[REDACTED]',
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
        },
      }),
};

export const logger = pino(loggerOptions);
