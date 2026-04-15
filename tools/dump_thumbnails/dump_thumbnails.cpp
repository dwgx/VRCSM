// Standalone harness that drives VrcApi::fetchThumbnails() against the
// real VRChat public API. Used as an end-to-end smoke test for the WinHTTP
// + disk-cache path without having to launch the full WebView2 GUI.
//
// Usage:
//   dump_thumbnails [id1 id2 ...]
//
// When no ids are supplied, defaults to a well-known public world
// ("The Black Cat" — the sample shipped with VRChat since 2018) so the test
// is still runnable on a machine that has never loaded VRChat.

#include <cstdio>
#include <iostream>
#include <string>
#include <vector>

#include "core/VrcApi.h"

int main(int argc, char** argv)
{
    std::vector<std::string> ids;
    if (argc > 1)
    {
        for (int i = 1; i < argc; ++i)
        {
            ids.emplace_back(argv[i]);
        }
    }
    else
    {
        // Well-known public worlds from VRChat's own sample set. Both are
        // indexed on vrchat.com so the API should always return them.
        ids.emplace_back("wrld_ba913a96-fac4-4048-a062-9aa5db092812"); // The Black Cat
        ids.emplace_back("wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b"); // The Great Pug
    }

    std::cout << "=== VrcApi::fetchThumbnails smoke test ===\n";
    std::cout << "requesting " << ids.size() << " id(s):\n";
    for (const auto& id : ids)
    {
        std::cout << "  " << id << "\n";
    }
    std::cout << "\n";

    const auto results = vrcsm::core::VrcApi::fetchThumbnails(ids);

    std::cout << "results:\n";
    int ok = 0;
    int miss = 0;
    int err = 0;
    for (const auto& r : results)
    {
        std::cout << "  " << r.id << "\n";
        std::cout << "    cached : " << (r.cached ? "yes" : "no") << "\n";
        if (r.error.has_value())
        {
            std::cout << "    error  : " << *r.error << "\n";
            ++err;
        }
        else if (r.url.has_value())
        {
            std::cout << "    url    : " << *r.url << "\n";
            ++ok;
        }
        else
        {
            std::cout << "    url    : <none>\n";
            ++miss;
        }
        std::cout << "\n";
    }

    std::cout << "summary: " << ok << " resolved, " << miss << " not-found, " << err << " error\n";
    return err > 0 ? 1 : 0;
}
