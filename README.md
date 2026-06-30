# OpenCode Rate Limiter Plugin

> **Experimental** — Proof of concept. No further development planned.  
> MIT licensed — feel free to fork, adapt, or use as reference.

A plugin for [OpenCode](https://opencode.ai) that adds **rate limiting** and a **concurrency semaphore** to LLM requests.

## Features

- **Rate limiting** — per-provider sliding window (e.g. max 1 request every 2s per provider)
- **Concurrency semaphore** — global cap on simultaneous LLM requests across all workspaces
- **Shared state** — survives module reloads via `globalThis`, consistent across all open workspaces

## How It Works

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
mkdir -p ~/.config/opencode/plugins
cp index.js ~/.config/opencode/plugins/rate-limiter.js
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

### Presets

**Conservative:**
```js
maxConcurrent: 5
maxRatePerWindow: 1
rateWindowMs: 3000
```

**Balanced (default):**
```js
maxConcurrent: 15
maxRatePerWindow: 1
rateWindowMs: 2000
```

**Aggressive:**
```js
maxConcurrent: 25
maxRatePerWindow: 2
rateWindowMs: 3000
```

## Monitoring

Logs are written to:

- **Windows:** `%TEMP%\opencode-rate-limiter\rate-limiter.log`
- **Linux/macOS:** `/tmp/opencode-rate-limiter/rate-limiter.log`

### Events

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

## License

MIT — see [LICENSE](LICENSE).

## Contributing

This is an experimental proof of concept with no active development planned. Feel free to fork or submit PRs if you find it useful.
