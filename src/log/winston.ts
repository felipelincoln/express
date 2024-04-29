import winston from 'winston';

// export const logApi = logger('log/api.log');

export function createLogger(out: string) {
  return winston.createLogger({
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.colorize(),
      winston.format.printf(
        ({ level, message, timestamp, context }) =>
          `${timestamp} ${level} ${message} ${context ? JSON.stringify(context) : ''}`,
      ),
    ),
    transports: [new winston.transports.Console(), new winston.transports.File({ filename: out })],
  });
}
