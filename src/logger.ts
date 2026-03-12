type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function log(level: LogLevel, module: string, message: string, data?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    module,
    message,
    ...(data ? { data } : {}),
  };
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(JSON.stringify(entry));
}

export const logger = {
  info: (module: string, message: string, data?: Record<string, unknown>) => log('info', module, message, data),
  warn: (module: string, message: string, data?: Record<string, unknown>) => log('warn', module, message, data),
  error: (module: string, message: string, data?: Record<string, unknown>) => log('error', module, message, data),
  debug: (module: string, message: string, data?: Record<string, unknown>) => log('debug', module, message, data),
};
