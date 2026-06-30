# ⚠️ Experimental — OpenCode Rate Limiter Plugin

> **Proof of concept. No further development planned.**  
> Use at your own risk. MIT licensed — feel free to fork, adapt, or use as reference.

A plugin for [OpenCode](https://opencode.ai) that prevents the `ResourceExhausted: Worker local total request limit reached (X/32)` error by adding:

- **Rate limiting** (sliding window per provider)
- **Concurrency semaphore** (global, shared across all workspaces)

## The Problem

OpenCode v1.17.11 (and possibly other versions) has an internal fixed limit of 32 concurrent Effect fibers. This limit is **shared across all open workspaces** — each workspace consumes fibers even when inactive.

The error `ResourceExhausted: Worker local total request limit reached (X/32)` fires when total fibers across all workspaces exceed 32.

OpenCode's built-in `maxConcurrency` provider option (introduced in [PR #27938](https://github.com/opencode-ai/opencode/pull/27938)) is **not available in v1.17.11**, so this plugin fills the gap.

## How It Works

### Architecture

```
                  chat.params hook
                ┌─────────────────────┐
   Request ──→  │  1. Rate check      │
                │  2. Acquire slot     │
                │  3. Mark window      │
                └─────────┬───────────┘
                          │ (waits if rate-limited
                          │  or concurrency full)
                          ▼
                    ┌─────────────┐
                    │  LLM Call   │
                    └─────────────┘
                          │
                    (slot auto-releases
                     after timeout)
```

### Rate Limiter (per-provider sliding window)

- Each provider (nvidia, opencode, etc.) has its own rate window
- Maximum `maxRatePerWindow` requests per `rateWindowMs` milliseconds
- Excessive requests **wait** (sleep) until the window expires
- Uses a **sliding window**: old timestamps are pruned automatically

### Concurrency Semaphore (global)

- Global `Set` of active request IDs, shared across all workspaces
- If `activeRequests.size >= maxConcurrent`, new requests **wait** with polling
- Each acquired slot has a **safety timeout** (`requestTimeoutMs`) that auto-releases if the request never completes
- Polling interval (`checkIntervalMs`) controls responsiveness

## Installation

### 1. Copy the plugin

```bash
# Create the plugins directory if it doesn't exist
mkdir -p ~/.config/opencode/plugins

# Copy the plugin file
cp opencode-rate-limiter-plugin/index.js ~/.config/opencode/plugins/rate-limiter.js
```

Or clone directly:

```bash
git clone https://github.com/tmogeid/opencode-rate-limiter-plugin.git
cp opencode-rate-limiter-plugin/index.js ~/.config/opencode/plugins/rate-limiter.js
```

### 2. Ensure `package.json` exists in plugins

```bash
echo '{"type":"module"}' > ~/.config/opencode/plugins/package.json
```

> OpenCode scans `{plugin,plugins}/*.{js,ts}` and loads compatible modules.

### 3. Restart OpenCode

The plugin auto-loads on next start. Check the log file to confirm.

## Configuration

All settings are at the top of `index.js` inside the `CONFIG` object:

| Variable | Default | Description |
|----------|---------|-------------|
| `maxConcurrent` | `15` | Max simultaneous requests across all providers/workspaces |
| `maxRatePerWindow` | `1` | Max requests per provider within the time window |
| `rateWindowMs` | `2000` | Time window for rate limiting (milliseconds) |
| `requestTimeoutMs` | `15000` | Safety timeout: auto-release concurrency slot after this time |
| `checkIntervalMs` | `200` | Polling interval for concurrency semaphore (milliseconds) |

### Recommended presets

**Conservative (safe, no errors expected):**
```
maxConcurrent: 5
maxRatePerWindow: 1
rateWindowMs: 3000
```

**Balanced (default):**
```
maxConcurrent: 15
maxRatePerWindow: 1
rateWindowMs: 2000
```

**Aggressive (when you trust the LLM response times):**
```
maxConcurrent: 25
maxRatePerWindow: 2
rateWindowMs: 3000
```

## Monitoring

Logs are written to:

- **Windows:** `%TEMP%\opencode-rate-limiter\rate-limiter.log`
- **Linux/macOS:** `/tmp/opencode-rate-limiter/rate-limiter.log`

### Log events

| Event | Meaning |
|-------|---------|
| `CONCURRENCY_ACQUIRED` | A concurrency slot was granted |
| `CONCURRENCY_BLOCKED` | Request is waiting for a free slot |
| `CONCURRENCY_TIMEOUT_RELEASE` | Slot auto-released by safety timeout |
| `CONCURRENCY_RELEASE` | Slot explicitly released |
| `RATE_LIMIT` | Request is rate-limited (sleeping) |
| `PASS` | Request passed through |

### Live monitoring (PowerShell)

```powershell
Get-Content "$env:TEMP\opencode-rate-limiter\rate-limiter.log" -Wait
```

## Compatibility

- Tested with **OpenCode v1.17.11**
- Works with any provider (nvidia, opencode, etc.)
- Shared state across all open workspaces (via `globalThis`)
- Module ESM format (`type: module`)

## The Error This Fixes

```
ResourceExhausted: Worker local total request limit reached (X/32)
```

This is an **internal OpenCode Effect fiber limit**, not an API rate limit. It occurs when too many workspaces are open or concurrent requests exceed OpenCode's internal capacity. This plugin limits the number of concurrent LLM requests, preventing the fiber pool from exhausting.

### Additional mitigation

If the error persists even with the plugin, **close unused workspaces** in OpenCode Desktop. Each open workspace consumes fibers even when inactive. Keeping 4-5 workspaces instead of 8-9 often resolves the issue on its own.

## Why a Plugin?

OpenCode's [PR #27938](https://github.com/opencode-ai/opencode/pull/27938) added `maxConcurrency` as a native provider config option to fix exactly this error. However, the feature is not available in OpenCode v1.17.11. This plugin provides the same functionality in userland until a native solution arrives.

## License

MIT — see [LICENSE](LICENSE).

## Contributing

This is an experimental proof of concept with no active development planned. Feel free to fork or submit PRs if you find it useful.
