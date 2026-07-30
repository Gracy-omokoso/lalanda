// Logger structuré JSON — Pino. Brief §4 (Logs Pino).
// En dev on utilise pino-pretty pour la lisibilité, en prod on garde JSON brut.

import { pino, type Logger, type LoggerOptions } from 'pino';

export interface CreateLoggerOptions {
  name: string;
  level?: string;
  pretty?: boolean;
}

export function createLogger(opts: CreateLoggerOptions): Logger {
  const level = opts.level ?? process.env['LOG_LEVEL'] ?? 'info';
  const isDev = process.env['NODE_ENV'] !== 'production';
  const pretty = opts.pretty ?? isDev;

  const config: LoggerOptions = {
    name: opts.name,
    level,
    redact: {
      // Ne jamais logguer de credentials — docs/17-SECURITE.md:60
      paths: [
        'password',
        '*.password',
        'token',
        '*.token',
        'authorization',
        '*.authorization',
        'apiKey',
        '*.apiKey',
        'OPENAI_API_KEY',
        'S3_SECRET_KEY',
        'AUTH_SECRET',
      ],
      censor: '[REDACTED]',
    },
  };

  if (pretty) {
    config.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    };
  }

  return pino(config);
}

export type { Logger } from 'pino';
