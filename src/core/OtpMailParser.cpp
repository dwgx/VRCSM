#include "OtpMailParser.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <ctime>
#include <regex>
#include <sstream>
#include <unordered_map>

namespace vrcsm::core
{

namespace
{

std::string ToLower(std::string s)
{
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return s;
}

std::string Trim(std::string_view s)
{
    std::size_t b = 0;
    while (b < s.size() && std::isspace(static_cast<unsigned char>(s[b])))
    {
        ++b;
    }
    std::size_t e = s.size();
    while (e > b && std::isspace(static_cast<unsigned char>(s[e - 1])))
    {
        --e;
    }
    return std::string(s.substr(b, e - b));
}

bool HostMatchesAllow(std::string_view host, const std::vector<std::string>& fromAllow)
{
    if (fromAllow.empty())
    {
        return true;
    }
    const auto h = ToLower(std::string(host));
    for (const auto& rule : fromAllow)
    {
        auto r = ToLower(Trim(rule));
        if (r.empty())
        {
            continue;
        }
        if (r.front() == '@')
        {
            const auto domain = r.substr(1);
            if (h == domain || (h.size() > domain.size() && h.rfind("." + domain) == h.size() - domain.size() - 1))
            {
                return true;
            }
        }
        else
        {
            const auto at = r.find('@');
            if (at != std::string::npos)
            {
                const auto domain = r.substr(at + 1);
                if (h == domain)
                {
                    return true;
                }
            }
        }
    }
    return false;
}

int MonthIndex(std::string mon)
{
    mon = ToLower(std::move(mon));
    static const std::unordered_map<std::string, int> kMonths = {
        {"jan", 1}, {"feb", 2}, {"mar", 3}, {"apr", 4}, {"may", 5}, {"jun", 6},
        {"jul", 7}, {"aug", 8}, {"sep", 9}, {"oct", 10}, {"nov", 11}, {"dec", 12},
    };
    const auto it = kMonths.find(mon.substr(0, 3));
    return it == kMonths.end() ? 0 : it->second;
}

std::optional<std::chrono::system_clock::time_point> FromTmUtc(std::tm tm)
{
    const auto y = tm.tm_year + 1900;
    if (y < 1970 || tm.tm_mon < 0 || tm.tm_mon > 11)
    {
        return std::nullopt;
    }
    using namespace std::chrono;
    const year_month_day ymd{year{y}, month{static_cast<unsigned>(tm.tm_mon + 1)}, day{static_cast<unsigned>(tm.tm_mday)}};
    if (!ymd.ok())
    {
        return std::nullopt;
    }
    const auto dp = sys_days{ymd};
    const auto tod = hours{tm.tm_hour} + minutes{tm.tm_min} + seconds{tm.tm_sec};
    return dp + tod;
}

bool MentionsVrchat(std::string_view subject, std::string_view body)
{
    auto hay = ToLower(std::string(subject) + " " + std::string(body));
    return hay.find("vrchat") != std::string::npos;
}

} // namespace

std::string StripHtmlTags(std::string_view html)
{
    std::string out;
    out.reserve(html.size());
    bool inTag = false;
    for (char c : html)
    {
        if (c == '<')
        {
            inTag = true;
            continue;
        }
        if (c == '>')
        {
            inTag = false;
            out.push_back(' ');
            continue;
        }
        if (!inTag)
        {
            out.push_back(c);
        }
    }
    return out;
}

std::optional<std::string> ExtractEmailHost(std::string_view from)
{
    auto s = Trim(from);
    const auto lt = s.find('<');
    const auto gt = s.find('>');
    if (lt != std::string::npos && gt != std::string::npos && gt > lt)
    {
        s = Trim(s.substr(lt + 1, gt - lt - 1));
    }
    const auto at = s.find('@');
    if (at == std::string::npos || at + 1 >= s.size())
    {
        return std::nullopt;
    }
    auto host = Trim(s.substr(at + 1));
    if (!host.empty() && host.back() == '>')
    {
        host.pop_back();
    }
    host = ToLower(host);
    if (host.empty() || host.find('.') == std::string::npos)
    {
        return std::nullopt;
    }
    return host;
}

bool IsVrchatMailHost(std::string_view host)
{
    const auto h = ToLower(std::string(host));
    if (h == "vrchat.com")
    {
        return true;
    }
    constexpr std::string_view suffix = ".vrchat.com";
    if (h.size() > suffix.size() && h.compare(h.size() - suffix.size(), suffix.size(), suffix.data()) == 0)
    {
        return true;
    }
    return false;
}

std::optional<std::chrono::system_clock::time_point> ParseMailDate(std::string_view date)
{
    auto s = Trim(date);
    if (s.empty())
    {
        return std::nullopt;
    }

    int y = 0, mo = 0, d = 0, h = 0, mi = 0, se = 0;
    if (std::sscanf(s.c_str(), "%d-%d-%dT%d:%d:%d", &y, &mo, &d, &h, &mi, &se) >= 3
        || std::sscanf(s.c_str(), "%d-%d-%d %d:%d:%d", &y, &mo, &d, &h, &mi, &se) >= 3)
    {
        std::tm tm{};
        tm.tm_year = y - 1900;
        tm.tm_mon = mo - 1;
        tm.tm_mday = d;
        tm.tm_hour = h;
        tm.tm_min = mi;
        tm.tm_sec = se;
        return FromTmUtc(tm);
    }

    // RFC 2822: "Wed, 20 Aug 2026 12:34:56 +0000" or "20 Aug 2026 12:34:56 +0000"
    std::string dayTok, monTok, rest;
    {
        std::istringstream iss{s};
        std::string t1, t2, t3, t4, t5;
        iss >> t1 >> t2 >> t3 >> t4 >> t5;
        if (!t1.empty() && t1.back() == ',')
        {
            dayTok = t2;
            monTok = t3;
            rest = t4 + " " + t5;
            if (std::sscanf(t4.c_str(), "%d", &y) == 1)
            {
                d = 0;
                std::sscanf(t2.c_str(), "%d", &d);
                mo = MonthIndex(t3);
                std::sscanf(t5.c_str(), "%d:%d:%d", &h, &mi, &se);
            }
        }
        else
        {
            std::sscanf(t1.c_str(), "%d", &d);
            monTok = t2;
            std::sscanf(t3.c_str(), "%d", &y);
            mo = MonthIndex(t2);
            std::sscanf(t4.c_str(), "%d:%d:%d", &h, &mi, &se);
        }
    }
    if (y > 1970 && mo >= 1 && d >= 1)
    {
        std::tm tm{};
        tm.tm_year = y - 1900;
        tm.tm_mon = mo - 1;
        tm.tm_mday = d;
        tm.tm_hour = h;
        tm.tm_min = mi;
        tm.tm_sec = se;
        return FromTmUtc(tm);
    }
    return std::nullopt;
}

OtpMailHeaders ParseRfc822(std::string_view raw)
{
    OtpMailHeaders out;
    std::string text(raw);
    // Unfold header lines.
    std::string unfolded;
    unfolded.reserve(text.size());
    for (std::size_t i = 0; i < text.size(); ++i)
    {
        if (text[i] == '\r')
        {
            continue;
        }
        if (text[i] == '\n' && i + 1 < text.size() && (text[i + 1] == ' ' || text[i + 1] == '\t'))
        {
            unfolded.push_back(' ');
            ++i;
            continue;
        }
        unfolded.push_back(text[i]);
    }

    const auto blank = unfolded.find("\n\n");
    std::string headerPart = blank == std::string::npos ? unfolded : unfolded.substr(0, blank);
    std::string bodyPart = blank == std::string::npos ? std::string{} : unfolded.substr(blank + 2);
    out.body = bodyPart;

    std::istringstream hs(headerPart);
    std::string line;
    while (std::getline(hs, line))
    {
        if (!line.empty() && line.back() == '\r')
        {
            line.pop_back();
        }
        const auto colon = line.find(':');
        if (colon == std::string::npos)
        {
            continue;
        }
        auto name = ToLower(Trim(line.substr(0, colon)));
        auto value = Trim(line.substr(colon + 1));
        if (name == "from")
        {
            out.from = value;
        }
        else if (name == "subject")
        {
            out.subject = value;
        }
        else if (name == "date")
        {
            out.date = value;
        }
    }
    return out;
}

std::optional<OtpParseResult> ParseOtpMail(
    const OtpMailHeaders& mail,
    std::chrono::system_clock::time_point now,
    const std::vector<std::string>& fromAllow)
{
    const auto host = ExtractEmailHost(mail.from);
    if (!host || !IsVrchatMailHost(*host))
    {
        return std::nullopt;
    }
    if (!HostMatchesAllow(*host, fromAllow))
    {
        return std::nullopt;
    }

    const auto date = ParseMailDate(mail.date);
    if (!date)
    {
        return std::nullopt;
    }
    const auto age = now - *date;
    if (age < std::chrono::seconds{0} || age > std::chrono::minutes{15})
    {
        return std::nullopt;
    }

    const auto bodyPlain = StripHtmlTags(mail.body);
    if (!MentionsVrchat(mail.subject, bodyPlain))
    {
        return std::nullopt;
    }

    const std::regex six(R"(\b(\d{6})\b)");
    const std::regex yearLike(R"(^20\d{4}$)");
    const std::regex prefer(R"(code|otp|verif)", std::regex::icase);

    auto pick = [&](const std::string& text, bool requireHint) -> std::optional<std::string> {
        auto begin = std::sregex_iterator(text.begin(), text.end(), six);
        auto end = std::sregex_iterator();
        for (auto it = begin; it != end; ++it)
        {
            const auto code = (*it)[1].str();
            if (std::regex_match(code, yearLike))
            {
                continue;
            }
            if (requireHint)
            {
                const auto pos = static_cast<std::size_t>((*it).position());
                const auto start = pos > 40 ? pos - 40 : 0;
                const auto len = std::min<std::size_t>(text.size() - start, 80);
                const auto window = text.substr(start, len);
                if (!std::regex_search(window, prefer))
                {
                    continue;
                }
            }
            return code;
        }
        return std::nullopt;
    };

    auto code = pick(mail.subject + "\n" + bodyPlain, true);
    if (!code)
    {
        code = pick(mail.subject + "\n" + bodyPlain, false);
    }
    if (!code)
    {
        return std::nullopt;
    }

    OtpParseResult result;
    result.code = *code;
    result.fromHost = *host;
    result.date = *date;
    const auto left = std::chrono::minutes{15} - age;
    result.remainingTtlSec = static_cast<int>(
        std::max<std::int64_t>(0, std::chrono::duration_cast<std::chrono::seconds>(left).count()));
    return result;
}

} // namespace vrcsm::core
