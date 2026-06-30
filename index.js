import { appendFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const LOG_DIR = join(tmpdir(), "opencode-rate-limiter")
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })

function log(...args) {
    const line = `[${Date.now()}] ${args.join(" ")}\n`
    appendFileSync(join(LOG_DIR, "rate-limiter.log"), line)
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

// ===== GLOBAL STATE (persists across module reloads via globalThis) =====

const g = globalThis
const state = g.__opencodeRateLimiter || (g.__opencodeRateLimiter = {
    activeRequests: new Set(),
    rateWindows: {},
    totalServed: 0,
    totalThrottled: 0,
    totalConcurrencyBlocked: 0,
    startTime: Date.now(),
})

const CONFIG = {
    maxConcurrent: 15,
    maxRatePerWindow: 1,
    rateWindowMs: 2000,
    requestTimeoutMs: 15000,
    checkIntervalMs: 200,
}

// ===== Rate Limiter (per-provider sliding window) =====

function pruneRateWindow(provider) {
    const now = Date.now()
    const cutoff = now - CONFIG.rateWindowMs
    const timestamps = state.rateWindows[provider] || []
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
        timestamps.shift()
    }
    return timestamps
}

function checkRateLimit(provider) {
    const timestamps = pruneRateWindow(provider)
    if (timestamps.length >= CONFIG.maxRatePerWindow) {
        const waitMs = timestamps[0] + CONFIG.rateWindowMs - Date.now() + 1
        return { limited: true, waitMs: Math.max(waitMs, 0) }
    }
    return { limited: false, waitMs: 0 }
}

function markRequest(provider) {
    if (!state.rateWindows[provider]) {
        state.rateWindows[provider] = []
    }
    state.rateWindows[provider].push(Date.now())
}

// ===== Concurrency Semaphore (global, survives reloads) =====

function releaseSlot(reqId) {
    if (state.activeRequests.has(reqId)) {
        state.activeRequests.delete(reqId)
        log(`CONCURRENCY_RELEASE id=${reqId} active=${state.activeRequests.size}`)
    }
}

async function acquireConcurrency(reqId) {
    while (state.activeRequests.size >= CONFIG.maxConcurrent) {
        state.totalConcurrencyBlocked++
        log(`CONCURRENCY_BLOCKED id=${reqId} active=${state.activeRequests.size}`)
        await sleep(CONFIG.checkIntervalMs)
    }
    state.activeRequests.add(reqId)
    state.totalServed++
    log(`CONCURRENCY_ACQUIRED id=${reqId} active=${state.activeRequests.size}`)

    setTimeout(() => {
        if (state.activeRequests.has(reqId)) {
            state.activeRequests.delete(reqId)
            log(`CONCURRENCY_TIMEOUT_RELEASE id=${reqId} active=${state.activeRequests.size}`)
        }
    }, CONFIG.requestTimeoutMs)
}

// ===== Plugin Hooks =====

async function rateLimiterPlugin(input, options) {
    log(`Plugin loaded ` +
        `maxConcurrent=${CONFIG.maxConcurrent} ` +
        `maxRatePerWindow=${CONFIG.maxRatePerWindow}/${CONFIG.rateWindowMs}ms ` +
        `timeout=${CONFIG.requestTimeoutMs}ms ` +
        `active=${state.activeRequests.size} totalServed=${state.totalServed}`)

    return {
        config(cfg) {
            log("CONFIG_HOOK_FIRED")
        },
        "chat.params": async (hookInput, output) => {
            let providerID = "unknown"
            try {
                providerID =
                    hookInput?.provider?.info?.id ??
                    hookInput?.model?.providerID ??
                    "unknown"

                const reqId = `${providerID}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

                log(`REQUEST provider=${providerID} id=${reqId} ` +
                    `active=${state.activeRequests.size} ` +
                    `total=${state.totalServed} throttled=${state.totalThrottled} ` +
                    `concurrencyBlocked=${state.totalConcurrencyBlocked}`)

                const rateCheck = checkRateLimit(providerID)
                if (rateCheck.limited) {
                    state.totalThrottled++
                    log(`RATE_LIMIT provider=${providerID} wait=${rateCheck.waitMs}ms`)
                    await sleep(rateCheck.waitMs)
                }

                await acquireConcurrency(reqId)
                markRequest(providerID)

                log(`PASS provider=${providerID} id=${reqId} ` +
                    `active=${state.activeRequests.size}`)
            } catch (err) {
                log(`ERROR provider=${providerID}: ${err.message}`)
            }
        },
    }
}

export default rateLimiterPlugin
export { rateLimiterPlugin as server }
