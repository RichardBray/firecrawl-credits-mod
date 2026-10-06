# firecrawl-credits

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods) that shows what each Firecrawl CLI command cost, right above the prompt, while Claude is still working.

```
Firecrawl credits · 10 this session
░░░░░░░░░░░░░░░░░░░░░░░░  0% · 1,203 left
developer — 8 credits · /credits
```

It watches Claude's Bash calls. When one runs the `firecrawl` CLI, the mod reads the cost from the command's own JSON output (`creditsUsed`). If the command printed no JSON, it falls back to the drop in your account balance and marks the figure with `~`. Drawing the band is local, so it uses no tokens.

Written up in [Claude Mods: What They Are and How to Build One in TypeScript](https://www.firecrawl.dev/blog/claude-mods).

## Requirements

- Claude Code v2.1.287 or later (mods are on by default from that version)
- The [Firecrawl CLI](https://docs.firecrawl.dev/sdks/cli), logged in. The mod reads your balance with `firecrawl credit-usage --json`, so it never needs your API key itself.

## Use it

```bash
git clone https://github.com/RichardBray/firecrawl-credits-mod
claude --plugin-dir ./firecrawl-credits-mod
```

Run `/credits` any time for the session total.

## Configure

`CREDIT_BUDGET` in `hooks/register.tsx` sets what the bar treats as a full tank. Leave it at `0` to use your plan's credits, or set a number to measure against your own budget.

## Files

- `.claude-plugin/plugin.json`: the plugin manifest
- `hooks/hooks.json`: points Claude Code at the hooks module
- `hooks/register.tsx`: the mod
