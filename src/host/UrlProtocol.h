#pragma once

#include <string>

namespace vrcsm::host
{

// Register `vrcsm://` and `vrcx://` URL schemes in
// HKCU\Software\Classes so the shell launches VRCSM.exe when a user
// clicks a link like `vrcsm://user/usr_abc123`. User-scope (no admin
// prompt) and idempotent — calling this every app start is fine.
//
// The `vrcx://` alias exists so users migrating from VRCX keep their
// existing clickable links working without re-sharing.
void RegisterProtocolHandlers();

// Parse the process command line for a protocol-launched URI. Windows
// invokes the handler as `VRCSM.exe "<url>"` so the URI appears as the
// last argv element (or with a `--uri` flag for our own bookmarklets).
// Returns the route portion of the URI translated into a React-router
// path (e.g. "vrcsm://user/usr_abc" → "/user/usr_abc"), or empty if no
// URI was supplied or it didn't match a known scheme.
std::string GetInitialRouteFromArgs();

} // namespace vrcsm::host
