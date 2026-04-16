#pragma once

#include <chrono>
#include <mutex>

namespace vrcsm::core
{

/// Token-bucket rate limiter for VRChat API requests.
///
/// VRChat enforces ~15 requests per 60 seconds. This class hands out
/// tokens at that rate and blocks callers when the bucket is empty,
/// preventing 429 storms before they start.
///
/// Thread-safe — multiple IPC worker threads may call Acquire()
/// concurrently.
class RateLimiter
{
public:
    /// Returns the process-wide singleton.
    static RateLimiter& Instance();

    /// Blocks the calling thread until a token is available.
    void Acquire();

    // Non-copyable, non-movable.
    RateLimiter(const RateLimiter&) = delete;
    RateLimiter& operator=(const RateLimiter&) = delete;

private:
    RateLimiter();

    /// Refills the bucket based on elapsed time. Must be called with
    /// mutex_ held.
    void refill();

    std::mutex mutex_;

    double tokens_;
    double maxTokens_;
    double refillRate_;  // tokens per second
    std::chrono::steady_clock::time_point lastRefill_;
};

} // namespace vrcsm::core
