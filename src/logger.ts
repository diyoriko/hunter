type LogLevel = 'info' | 'warn' | 'error';

function log(level: LogLevel, module: string, message: string, data?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    module,
    message,
    ...(data ? { data } : {}),
  };
  console.log(JSON.stringify(entry));
}

export const logger = {
  info: (module: string, message: string, data?: Record<string, unknown>) => log('info', module, message, data),
  warn: (module: string, message: string, data?: Record<string, unknown>) => log('warn', module, message, data),
  error: (module: string, message: string, data?: Record<string, unknown>) => log('error', module, message, data),
};
