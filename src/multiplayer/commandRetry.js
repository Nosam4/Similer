const GAME_COMMAND_MAX_ATTEMPTS = 3
const SAFE_VERSION_CONFLICT_COMMANDS = new Set(['markArgumentComplete'])

export function shouldRetryGameCommand({ command, errorDetails, attempt }) {
  if (attempt >= GAME_COMMAND_MAX_ATTEMPTS) {
    return false
  }

  if (
    SAFE_VERSION_CONFLICT_COMMANDS.has(command) &&
    /Room state changed on another device/i.test(errorDetails.message)
  ) {
    return true
  }

  return (
    errorDetails.name === 'FunctionsFetchError' ||
    errorDetails.name === 'FunctionsRelayError' ||
    errorDetails.status >= 500 ||
    /Failed to send|Relay Error|network|aborted|timeout|timed out|fetch failed/i.test(
      errorDetails.message,
    )
  )
}
