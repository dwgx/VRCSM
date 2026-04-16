#include "RateLimiter.h"

#include <thread>

#include <spdlog/spdlog.h>

namespace vrcsm::core
{

// ─────────────────────────────────────────────────────────────────────────
// VRChat documents a rate limit of 15 requests per 60 seconds.
// We model this as a token bucket that refills at 15/60 = 0.25 tokens/s,
// bursting up to 15 tokens.
// ─────────────────────────────────────────────────────────────────────────

static constexpr double kMaxTokens = 15.0;
static constexpr double kRefillRate = 15.0 / 60.0; // 0.25 tokens/s

RateLimiter& RateLimiter::Instance()
{
    static RateLimiter instance;
    return instance;
}

RateLimiter::RateLimiter()
    : tokens_(kMaxTokens)
    , maxTokens_(kMaxTokens)
    , refillRate_(kRefillRate)
    , lastRefill_(std::chrono::steady_clock::now())
{
}

void RateLimiter::refill()
{
    auto now = std::chrono::steady_clock::now();
    double elapsed =
        std::chrono::duration<double>(now - lastRefill_).count();
    tokens_ = std::min(maxTokens_, tokens_ + elapsed * refillRate_);
    lastRefill_ = now;
}

void RateLimiter::Acquire()
{
    std::unique_lock lock(mutex_);

    refill();

    if (tokens_ >= 1.0)
    {
        tokens_ -= 1.0;
        return;
    }

    // Not enough tokens — calculate how long we need to wait for one.
    double deficit = 1.0 - tokens_;
    auto waitMs = static_cast<long long>(
        std::ceil(deficit / refillRate_ * 1000.0));

    spdlog::debug("RateLimiter: bucket empty, sleeping {}ms", waitMs);

    // Release the lock while sleeping so other threads can queue up
    // behind us rather than all piling onto the mutex.
    lock.unlock();
    std::this_thread::sleep_for(std::chrono::milliseconds(waitMs));
    lock.lock();

    refill();
    tokens_ = std::max(0.0, tokens_ - 1.0);
}

} // namespace vrcsm::core
