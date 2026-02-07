// lib/logger.ts
// Structured logging utility with optional external service integration

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: unknown
}

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  context?: LogContext
  error?: {
    name: string
    message: string
    stack?: string
  }
}

// Environment detection
const isDev = process.env.NODE_ENV === 'development'
const isProduction = process.env.NODE_ENV === 'production'

// Sentry integration is optional - install @sentry/nextjs to enable
// Set SENTRY_DSN environment variable to activate

function formatLogEntry(entry: LogEntry): string {
  if (isDev) {
    // Pretty format for development
    const prefix = {
      debug: '🔍',
      info: 'ℹ️ ',
      warn: '⚠️ ',
      error: '❌',
    }[entry.level]

    let output = `${prefix} [${entry.level.toUpperCase()}] ${entry.message}`

    if (entry.context && Object.keys(entry.context).length > 0) {
      output += ` ${JSON.stringify(entry.context)}`
    }

    if (entry.error) {
      output += `\n   Error: ${entry.error.message}`
      if (entry.error.stack) {
        output += `\n   ${entry.error.stack.split('\n').slice(1, 4).join('\n   ')}`
      }
    }

    return output
  }

  // JSON format for production (Logtail/Datadog compatible)
  return JSON.stringify(entry)
}

function createLogEntry(
  level: LogLevel,
  message: string,
  context?: LogContext,
  error?: Error
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  }

  if (context && Object.keys(context).length > 0) {
    entry.context = context
  }

  if (error) {
    entry.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }

  return entry
}

async function sendToExternalService(entry: LogEntry) {
  // Logtail/Better Stack integration
  if (process.env.LOGTAIL_SOURCE_TOKEN) {
    try {
      await fetch('https://in.logtail.com', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.LOGTAIL_SOURCE_TOKEN}`,
        },
        body: JSON.stringify(entry),
      })
    } catch {
      // Logtail send failed - don't break the app
    }
  }

  // For Sentry integration, install @sentry/nextjs and set SENTRY_DSN
  // Then uncomment the following:
  // if (entry.level === 'error' && entry.error && process.env.SENTRY_DSN) {
  //   const Sentry = await import('@sentry/nextjs')
  //   Sentry.captureException(new Error(entry.error.message), { extra: entry.context })
  // }
}

export const logger = {
  debug(message: string, context?: LogContext) {
    if (!isDev) return // Skip debug logs in production
    const entry = createLogEntry('debug', message, context)
    console.debug(formatLogEntry(entry))
  },

  info(message: string, context?: LogContext) {
    const entry = createLogEntry('info', message, context)
    console.info(formatLogEntry(entry))
  },

  warn(message: string, context?: LogContext) {
    const entry = createLogEntry('warn', message, context)
    console.warn(formatLogEntry(entry))
    if (isProduction) {
      sendToExternalService(entry).catch(() => {})
    }
  },

  error(message: string, error?: Error | unknown, context?: LogContext) {
    const err = error instanceof Error ? error : undefined
    const entry = createLogEntry('error', message, context, err)
    console.error(formatLogEntry(entry))
    if (isProduction) {
      sendToExternalService(entry).catch(() => {})
    }
  },

  // Helper for API route error logging
  apiError(route: string, error: unknown, context?: LogContext) {
    this.error(`API error in ${route}`, error, {
      route,
      ...context,
    })
  },
}

export default logger
