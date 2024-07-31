import winston from 'winston';

export function createLogger() {
  return winston.createLogger({
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.colorize(),
      winston.format.printf(
        ({ level, message, timestamp, context }) =>
          `${timestamp} ${level} ${message} ${context ? JSON.stringify(context) : ''}`,
      ),
    ),
    transports: [new winston.transports.Console()],
  });
}
