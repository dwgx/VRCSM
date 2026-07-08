#pragma once

#include <string>

namespace vrcsm::core
{

// Result of a single lyrics HTTP GET performed by the host proxy.
//   status  — HTTP status code (0 when the request never completed).
//   body    — full response body as bytes (UTF-8 text for the lyric APIs).
//   error   — non-empty on any WinHTTP failure or SSRF-rail rejection.
struct LyricsFetchResult
{
    long status{0};
    std::string body;
    std::string error;
};

// Perform a plain HTTPS GET against `url`, optionally sending a `Referer`
// request header (skipped when empty). Follows redirects, sends a normal
// User-Agent, and bounds itself with ~8s WinHTTP timeouts so a slow host can
// never hang the calling worker thread. Never throws — every failure is
// reported through `LyricsFetchResult::error` with status 0.
//
// SSRF safety rail (NOT a domain allowlist): the request is refused with an
// error when the scheme is not https, or the host is a loopback / link-local /
// private-range literal (localhost, 127.*, ::1, 10.*, 192.168.*, 172.16-31.*,
// 169.254.*). Every other https host is allowed.
LyricsFetchResult LyricsFetch(const std::string& url, const std::string& referer);

// Exposed for unit testing the SSRF rail without touching the network.
// Returns true when `host` is a loopback / link-local / private-range literal
// that the proxy must refuse. Host is compared case-insensitively; IPv6
// bracket wrappers (e.g. "[::1]") are tolerated.
bool IsBlockedProxyHost(const std::string& host);

} // namespace vrcsm::core
