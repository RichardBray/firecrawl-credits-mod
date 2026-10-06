/* @jsxRuntime classic */
/* @jsx h */
import type { Register } from 'claude-code'

// Watches Claude's Bash calls. When one runs the firecrawl CLI, it shows what that
// command cost in a band above the prompt, with a bar for how much of the plan is gone.
//
// Cost comes from one of two places, in this order:
//   1. `creditsUsed` in the command's own JSON output — exact, and free to read
//   2. the drop in the account balance since we last looked — used when the command
//      printed no JSON, and shown with a ~ so it reads as an approximation

const ORANGE = '#fa5d19'
const BAR_WIDTH = 24

// What the bar treats as a full tank. 0 works it out instead: the plan's credits when the
// account has no more than its plan, otherwise the balance this session opened with.
// Set a number here to film the bar moving on an account too large to show a change.
const CREDIT_BUDGET = 0

type Balance = { remaining: number; plan: number }

let spentThisSession = 0
let callsThisSession = 0
let balance: Balance | undefined
let lastCall: string | undefined
let openingBalance: number | undefined
// How many priced firecrawl commands are running right now. A before/after pair only
// measures one command if it was the only one in flight for the whole call.
let inFlight = 0

// `firecrawl scrape …` yes; `… | grep firecrawl` no. Close enough for a command line.
const isFirecrawlCommand = (command: string) => /(^|[;&|]\s*)firecrawl\s+\S/.test(command)

// Commands that never spend credits, so pricing them is just noise. `search-feedback`
// actually refunds one, and the firecrawl skill sends it automatically after a search.
const SPENDS_NOTHING =
  /firecrawl\s+(credit-usage|search-feedback|feedback|config|view-config|login|logout|doctor|version|env|setup|make|init)\b/
const isFreeCommand = (command: string) => SPENDS_NOTHING.test(command)

const subcommandOf = (command: string) => command.match(/firecrawl\s+([a-z-]+)/)?.[1] ?? 'firecrawl'

const sumOfNestedCredits = (text: string): number | undefined => {
  const found = [...text.matchAll(/"creditsUsed"\s*:\s*(\d+)/g)].map(m => Number(m[1]))
  return found.length > 0 ? found.reduce((a, b) => a + b, 0) : undefined
}

// A search that scraped its results reports the total at the top AND a copy on every
// result, so adding up every `creditsUsed` bills the command about twice. The top-level
// figure wins where there is one; the sum is for a crawl, which reports one per page
// and no total, and for output we could not parse.
const creditsReportedIn = (stdout: string): number | undefined => {
  try {
    const parsed = JSON.parse(stdout)
    const total = Number(parsed?.creditsUsed ?? parsed?.data?.creditsUsed)
    if (Number.isFinite(total)) return total
  } catch {}
  return sumOfNestedCredits(stdout)
}

// Reads the account through the CLI, which already holds the credentials.
async function readBalance($: any): Promise<Balance | undefined> {
  try {
    const { stdout } = await $.process.run(['firecrawl', 'credit-usage', '--json'])
    const data = JSON.parse(stdout)?.data
    const remaining = Number(data?.remainingCredits)
    const plan = Number(data?.planCredits)
    return Number.isFinite(remaining) ? { remaining, plan } : undefined
  } catch {
    return undefined
  }
}

// An account topped up beyond its plan (or an internal one) reports more credits than
// its plan holds, so the plan is no denominator, and neither is the distance from it:
// the bar then measures what this session spent against the budget instead.
const tankFor = (b: Balance) => {
  const spentSinceOpening = Math.max(0, (openingBalance ?? b.remaining) - b.remaining)
  const budget = CREDIT_BUDGET > 0 ? CREDIT_BUDGET : b.plan > 0 ? b.plan : (openingBalance ?? b.remaining)
  // Credits in hand are the honest reading of how much of the tank is gone, but an account
  // holding more than the tank has none of it gone, so there the bar tracks this session.
  return b.remaining <= budget
    ? { budget, used: budget - b.remaining }
    : { budget, used: spentSinceOpening }
}

const barFor = (b: Balance) => {
  const { budget, used } = tankFor(b)
  const usedFraction = budget > 0 ? Math.min(1, Math.max(0, used / budget)) : 0
  const filled = Math.round(usedFraction * BAR_WIDTH)
  return {
    bar: '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled),
    percent: Math.round(usedFraction * 100),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    // A baseline, so the very first fallback measurement has something to subtract from.
    balance = await readBalance($)
    openingBalance = balance?.remaining

    await $.command.register({
      name: 'credits',
      description: 'Firecrawl credits spent in this session (firecrawl-credits)',
    })

    return result
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = String(e.command ?? '')

    // Let every other Bash command through untouched.
    if (!isFirecrawlCommand(command) || isFreeCommand(command)) return next(e)

    // A real reading before the command, so the fallback below is a true difference
    // rather than a guess against a number we have been adjusting ourselves.
    inFlight += 1
    const alone = inFlight === 1
    const before = await readBalance($)

    let result
    try {
      result = await next(e)
    } finally {
      inFlight -= 1
    }

    // The command's own output is exact and free to read, so prefer it.
    let spent = creditsReportedIn(String((result as any)?.result?.stdout ?? ''))
    let exact = spent !== undefined

    // Either way, end on a real reading: the band should never show arithmetic we did.
    const after = await readBalance($)
    balance = after ?? before ?? balance

    if (spent === undefined && before !== undefined && after !== undefined) {
      spent = Math.max(0, before.remaining - after.remaining)
      // Two overlapping commands share one difference, so neither can claim it.
      exact = alone && inFlight === 0
    }

    if (spent !== undefined) {
      spentThisSession += spent
      callsThisSession += 1
      lastCall = `${subcommandOf(command)} — ${exact ? '' : '~'}${spent} credit${spent === 1 ? '' : 's'}`
      $.ui.invalidate('ui.render')
    }

    return result
  })

  on('command.run', { command: 'credits' }, async ($) => {
    balance = (await readBalance($)) ?? balance
    $.ui.invalidate('ui.render')
    return { text: `Firecrawl: ${spentThisSession} credits over ${callsThisSession} calls this session` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Nothing to say until the first firecrawl command has run.
    if (lastCall === undefined || e.surface !== 'terminal') return next(e)

    const { Box, Text } = await $.ui.resolve(e)

    const title = `Firecrawl credits · ${spentThisSession} this session`

    const middle = balance
      ? (() => {
          const { bar, percent } = barFor(balance)
          return `${bar}  ${percent}% · ${balance.remaining.toLocaleString()} left`
        })()
      : 'balance unknown'

    const footer = `${lastCall} · /credits`

    // Under three rows the band only gets the line that matters.
    const isTall = e.props.maxRows >= 3

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" width={e.props.bodyColumns} paddingX={1}>
          {isTall ? <Text color={ORANGE} dimColor>{title}</Text> : null}
          <Text color={ORANGE} wrap="wrap">{middle}</Text>
          {isTall ? <Text color={ORANGE} dimColor>{footer}</Text> : null}
        </Box>
        {await next(e)}
      </Box>
    )
  })
}
