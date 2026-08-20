#include "ImapClient.h"

#include "Common.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <wincrypt.h>

#ifndef SECURITY_WIN32
#define SECURITY_WIN32
#endif
#include <security.h>
#include <schannel.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <sstream>
#include <vector>

#include <spdlog/spdlog.h>

#pragma comment(lib, "Secur32.lib")

namespace vrcsm::core
{

namespace
{

std::string ToLowerAscii(std::string host)
{
    std::transform(host.begin(), host.end(), host.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return host;
}

bool ParseIPv4(const std::string& host, std::array<int, 4>& ip)
{
    ip = {0, 0, 0, 0};
    std::size_t i = 0;
    for (int octet = 0; octet < 4; ++octet)
    {
        if (i >= host.size() || !std::isdigit(static_cast<unsigned char>(host[i])))
        {
            return false;
        }
        int v = 0;
        int digits = 0;
        while (i < host.size() && std::isdigit(static_cast<unsigned char>(host[i])))
        {
            v = v * 10 + (host[i] - '0');
            ++i;
            ++digits;
            if (digits > 3 || v > 255)
            {
                return false;
            }
        }
        ip[static_cast<std::size_t>(octet)] = v;
        if (octet < 3)
        {
            if (i >= host.size() || host[i] != '.')
            {
                return false;
            }
            ++i;
        }
    }
    return i == host.size();
}

std::string Base64Encode(const std::string& in)
{
    static constexpr char kTable[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((in.size() + 2) / 3) * 4);
    std::size_t i = 0;
    while (i + 2 < in.size())
    {
        const unsigned n = (static_cast<unsigned char>(in[i]) << 16)
            | (static_cast<unsigned char>(in[i + 1]) << 8)
            | static_cast<unsigned char>(in[i + 2]);
        out.push_back(kTable[(n >> 18) & 63]);
        out.push_back(kTable[(n >> 12) & 63]);
        out.push_back(kTable[(n >> 6) & 63]);
        out.push_back(kTable[n & 63]);
        i += 3;
    }
    if (i < in.size())
    {
        unsigned n = static_cast<unsigned char>(in[i]) << 16;
        out.push_back(kTable[(n >> 18) & 63]);
        if (i + 1 < in.size())
        {
            n |= static_cast<unsigned char>(in[i + 1]) << 8;
            out.push_back(kTable[(n >> 12) & 63]);
            out.push_back(kTable[(n >> 6) & 63]);
            out.push_back('=');
        }
        else
        {
            out.push_back(kTable[(n >> 12) & 63]);
            out.push_back('=');
            out.push_back('=');
        }
    }
    return out;
}

std::string ImapQuote(const std::string& s)
{
    std::string out = "\"";
    for (char c : s)
    {
        if (c == '\\' || c == '"')
        {
            out.push_back('\\');
        }
        out.push_back(c);
    }
    out.push_back('"');
    return out;
}

void EnsureWsa()
{
    static bool started = false;
    if (started)
    {
        return;
    }
    WSADATA data{};
    WSAStartup(MAKEWORD(2, 2), &data);
    started = true;
}

bool SetSocketTimeouts(SOCKET s, int ms)
{
    DWORD t = static_cast<DWORD>(ms);
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&t), sizeof(t));
    setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char*>(&t), sizeof(t));
    return true;
}

// Fail closed: inet_ntop failure or unknown family is blocked. Presentation
// goes through IsBlockedImapHost so connect and the DNS classifier share one rail.
bool AddrinfoEntryBlocked(const addrinfo* ai)
{
    if (ai == nullptr || ai->ai_addr == nullptr)
    {
        return true;
    }
    char buf[INET6_ADDRSTRLEN]{};
    if (ai->ai_family == AF_INET)
    {
        auto* sa = reinterpret_cast<sockaddr_in*>(ai->ai_addr);
        if (inet_ntop(AF_INET, &sa->sin_addr, buf, sizeof(buf)) == nullptr)
        {
            return true;
        }
        return IsBlockedImapHost(buf);
    }
    if (ai->ai_family == AF_INET6)
    {
        auto* sa = reinterpret_cast<sockaddr_in6*>(ai->ai_addr);
        if (inet_ntop(AF_INET6, &sa->sin6_addr, buf, sizeof(buf)) == nullptr)
        {
            return true;
        }
        return IsBlockedImapHost(buf);
    }
    return true;
}

class TlsSocket
{
public:
    TlsSocket() = default;
    ~TlsSocket() { close(); }

    TlsSocket(const TlsSocket&) = delete;
    TlsSocket& operator=(const TlsSocket&) = delete;

    Result<std::monostate> connectPlain(const std::string& host, int port, int timeoutMs)
    {
        EnsureWsa();
        addrinfo hints{};
        hints.ai_family = AF_UNSPEC;
        hints.ai_socktype = SOCK_STREAM;
        addrinfo* res = nullptr;
        const auto portStr = std::to_string(port);
        if (getaddrinfo(host.c_str(), portStr.c_str(), &hints, &res) != 0 || res == nullptr)
        {
            return Error{"imap_host_unresolved", "IMAP host could not be resolved", 0};
        }
        bool sawAddress = false;
        bool blocked = false;
        for (auto* ai = res; ai != nullptr; ai = ai->ai_next)
        {
            if (AddrinfoEntryBlocked(ai))
            {
                blocked = true;
            }
            else
            {
                sawAddress = true;
            }
        }
        if (blocked || !sawAddress)
        {
            freeaddrinfo(res);
            return Error{"imap_host_blocked", "IMAP host resolved to a blocked address", 0};
        }
        SOCKET s = INVALID_SOCKET;
        for (auto* ai = res; ai != nullptr; ai = ai->ai_next)
        {
            if (AddrinfoEntryBlocked(ai))
            {
                continue;
            }
            s = socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
            if (s == INVALID_SOCKET)
            {
                continue;
            }
            SetSocketTimeouts(s, timeoutMs);
            u_long nonblock = 1;
            ioctlsocket(s, FIONBIO, &nonblock);
            const int cr = ::connect(s, ai->ai_addr, static_cast<int>(ai->ai_addrlen));
            if (cr == 0 || WSAGetLastError() == WSAEWOULDBLOCK)
            {
                fd_set w{};
                FD_ZERO(&w);
                FD_SET(s, &w);
                timeval tv{};
                tv.tv_sec = timeoutMs / 1000;
                tv.tv_usec = (timeoutMs % 1000) * 1000;
                if (select(0, nullptr, &w, nullptr, &tv) > 0)
                {
                    u_long block = 0;
                    ioctlsocket(s, FIONBIO, &block);
                    m_sock = s;
                    s = INVALID_SOCKET;
                    break;
                }
            }
            closesocket(s);
            s = INVALID_SOCKET;
        }
        freeaddrinfo(res);
        if (m_sock == INVALID_SOCKET)
        {
            return Error{"io_error", "IMAP connect timed out", 0};
        }
        SetSocketTimeouts(m_sock, timeoutMs);
        return std::monostate{};
    }

    Result<std::monostate> handshake(const std::string& host, int timeoutMs)
    {
        SCHANNEL_CRED cred{};
        cred.dwVersion = SCHANNEL_CRED_VERSION;
        cred.grbitEnabledProtocols = SP_PROT_TLS1_2
#ifdef SP_PROT_TLS1_3
            | SP_PROT_TLS1_3
#endif
            ;
        cred.dwFlags = SCH_CRED_AUTO_CRED_VALIDATION | SCH_CRED_NO_DEFAULT_CREDS;

        TimeStamp ts{};
        SECURITY_STATUS st = AcquireCredentialsHandleA(
            nullptr, const_cast<SEC_CHAR*>(UNISP_NAME_A), SECPKG_CRED_OUTBOUND,
            nullptr, &cred, nullptr, nullptr, &m_cred, &ts);
        if (st != SEC_E_OK)
        {
            return Error{"io_error", "IMAP TLS credentials failed", 0};
        }
        m_haveCred = true;

        SecBuffer outBuf{};
        outBuf.BufferType = SECBUFFER_TOKEN;
        SecBufferDesc outDesc{};
        outDesc.ulVersion = SECBUFFER_VERSION;
        outDesc.cBuffers = 1;
        outDesc.pBuffers = &outBuf;

        DWORD flags = ISC_REQ_SEQUENCE_DETECT | ISC_REQ_REPLAY_DETECT
            | ISC_REQ_CONFIDENTIALITY | ISC_REQ_ALLOCATE_MEMORY | ISC_REQ_STREAM;

        st = InitializeSecurityContextA(
            &m_cred, nullptr, const_cast<SEC_CHAR*>(host.c_str()), flags, 0, 0,
            nullptr, 0, &m_ctx, &outDesc, &m_ctxFlags, &ts);
        m_haveCtx = true;
        if (st != SEC_I_CONTINUE_NEEDED && st != SEC_E_OK)
        {
            return Error{"io_error", "IMAP TLS handshake failed", 0};
        }
        if (outBuf.cbBuffer > 0 && outBuf.pvBuffer != nullptr)
        {
            auto wr = sendAll(static_cast<const char*>(outBuf.pvBuffer), outBuf.cbBuffer, timeoutMs);
            FreeContextBuffer(outBuf.pvBuffer);
            if (!isOk(wr))
            {
                return error(wr);
            }
        }

        std::vector<char> extra;
        while (st == SEC_I_CONTINUE_NEEDED)
        {
            auto rd = recvSome(timeoutMs);
            if (!isOk(rd))
            {
                return error(rd);
            }
            extra.insert(extra.end(), value(rd).begin(), value(rd).end());

            SecBuffer inBufs[2]{};
            inBufs[0].BufferType = SECBUFFER_TOKEN;
            inBufs[0].pvBuffer = extra.data();
            inBufs[0].cbBuffer = static_cast<ULONG>(extra.size());
            inBufs[1].BufferType = SECBUFFER_EMPTY;
            SecBufferDesc inDesc{};
            inDesc.ulVersion = SECBUFFER_VERSION;
            inDesc.cBuffers = 2;
            inDesc.pBuffers = inBufs;

            outBuf = {};
            outBuf.BufferType = SECBUFFER_TOKEN;
            st = InitializeSecurityContextA(
                &m_cred, &m_ctx, nullptr, flags, 0, 0,
                &inDesc, 0, nullptr, &outDesc, &m_ctxFlags, &ts);
            if (outBuf.cbBuffer > 0 && outBuf.pvBuffer != nullptr)
            {
                auto wr = sendAll(static_cast<const char*>(outBuf.pvBuffer), outBuf.cbBuffer, timeoutMs);
                FreeContextBuffer(outBuf.pvBuffer);
                if (!isOk(wr))
                {
                    return error(wr);
                }
            }
            if (inBufs[1].BufferType == SECBUFFER_EXTRA && inBufs[1].cbBuffer > 0)
            {
                const auto leftover = extra.size() - inBufs[1].cbBuffer;
                extra.erase(extra.begin(), extra.begin() + static_cast<std::ptrdiff_t>(leftover));
            }
            else
            {
                extra.clear();
            }
            if (st == SEC_E_OK)
            {
                break;
            }
            if (st != SEC_I_CONTINUE_NEEDED)
            {
                return Error{"io_error", "IMAP TLS handshake failed", 0};
            }
        }

        SecPkgContext_StreamSizes sizes{};
        if (QueryContextAttributesA(&m_ctx, SECPKG_ATTR_STREAM_SIZES, &sizes) != SEC_E_OK)
        {
            return Error{"io_error", "IMAP TLS stream sizes failed", 0};
        }
        m_sizes = sizes;
        m_tls = true;
        if (!extra.empty())
        {
            m_pending.insert(m_pending.end(), extra.begin(), extra.end());
        }
        return std::monostate{};
    }

    Result<std::monostate> writeLine(const std::string& line, int timeoutMs)
    {
        std::string wire = line;
        if (wire.size() < 2 || wire.substr(wire.size() - 2) != "\r\n")
        {
            wire += "\r\n";
        }
        if (!m_tls)
        {
            return sendAll(wire.data(), static_cast<int>(wire.size()), timeoutMs);
        }
        return sendTls(wire, timeoutMs);
    }

    Result<std::string> readLine(int timeoutMs)
    {
        while (true)
        {
            auto it = std::search(m_plain.begin(), m_plain.end(),
                reinterpret_cast<const char*>("\n"),
                reinterpret_cast<const char*>("\n") + 1);
            if (it != m_plain.end())
            {
                std::string line(m_plain.begin(), it);
                m_plain.erase(m_plain.begin(), it + 1);
                if (!line.empty() && line.back() == '\r')
                {
                    line.pop_back();
                }
                return line;
            }
            auto more = m_tls ? recvTls(timeoutMs) : recvSome(timeoutMs);
            if (!isOk(more))
            {
                return error(more);
            }
            if (value(more).empty())
            {
                return Error{"io_error", "IMAP connection closed", 0};
            }
            if (m_tls)
            {
                m_plain.insert(m_plain.end(), value(more).begin(), value(more).end());
            }
            else
            {
                m_plain.insert(m_plain.end(), value(more).begin(), value(more).end());
            }
        }
    }

    Result<std::string> readBytes(std::size_t n, int timeoutMs)
    {
        while (m_plain.size() < n)
        {
            auto more = m_tls ? recvTls(timeoutMs) : recvSome(timeoutMs);
            if (!isOk(more))
            {
                return error(more);
            }
            if (value(more).empty())
            {
                return Error{"io_error", "IMAP connection closed", 0};
            }
            m_plain.insert(m_plain.end(), value(more).begin(), value(more).end());
        }
        std::string out(m_plain.begin(), m_plain.begin() + static_cast<std::ptrdiff_t>(n));
        m_plain.erase(m_plain.begin(), m_plain.begin() + static_cast<std::ptrdiff_t>(n));
        return out;
    }

    void close()
    {
        if (m_haveCtx)
        {
            DeleteSecurityContext(&m_ctx);
            m_haveCtx = false;
        }
        if (m_haveCred)
        {
            FreeCredentialsHandle(&m_cred);
            m_haveCred = false;
        }
        if (m_sock != INVALID_SOCKET)
        {
            closesocket(m_sock);
            m_sock = INVALID_SOCKET;
        }
        m_tls = false;
        m_plain.clear();
        m_pending.clear();
    }

private:
    Result<std::monostate> sendAll(const char* data, int len, int timeoutMs)
    {
        int sent = 0;
        while (sent < len)
        {
            const int n = send(m_sock, data + sent, len - sent, 0);
            if (n <= 0)
            {
                (void)timeoutMs;
                return Error{"io_error", "IMAP send failed", 0};
            }
            sent += n;
        }
        return std::monostate{};
    }

    Result<std::vector<char>> recvSome(int timeoutMs)
    {
        if (!m_pending.empty())
        {
            auto out = std::move(m_pending);
            m_pending.clear();
            return out;
        }
        std::vector<char> buf(16 * 1024);
        const int n = recv(m_sock, buf.data(), static_cast<int>(buf.size()), 0);
        if (n <= 0)
        {
            (void)timeoutMs;
            return Error{"io_error", "IMAP recv failed", 0};
        }
        buf.resize(static_cast<std::size_t>(n));
        return buf;
    }

    Result<std::monostate> sendTls(const std::string& plain, int timeoutMs)
    {
        std::size_t offset = 0;
        while (offset < plain.size())
        {
            const std::size_t chunk = std::min<std::size_t>(plain.size() - offset, m_sizes.cbMaximumMessage);
            std::vector<char> packet(m_sizes.cbHeader + chunk + m_sizes.cbTrailer);
            std::memcpy(packet.data() + m_sizes.cbHeader, plain.data() + offset, chunk);
            SecBuffer bufs[4]{};
            bufs[0].BufferType = SECBUFFER_STREAM_HEADER;
            bufs[0].pvBuffer = packet.data();
            bufs[0].cbBuffer = m_sizes.cbHeader;
            bufs[1].BufferType = SECBUFFER_DATA;
            bufs[1].pvBuffer = packet.data() + m_sizes.cbHeader;
            bufs[1].cbBuffer = static_cast<ULONG>(chunk);
            bufs[2].BufferType = SECBUFFER_STREAM_TRAILER;
            bufs[2].pvBuffer = packet.data() + m_sizes.cbHeader + chunk;
            bufs[2].cbBuffer = m_sizes.cbTrailer;
            bufs[3].BufferType = SECBUFFER_EMPTY;
            SecBufferDesc desc{SECBUFFER_VERSION, 4, bufs};
            const SECURITY_STATUS st = EncryptMessage(&m_ctx, 0, &desc, 0);
            if (st != SEC_E_OK)
            {
                return Error{"io_error", "IMAP TLS encrypt failed", 0};
            }
            const int total = static_cast<int>(bufs[0].cbBuffer + bufs[1].cbBuffer + bufs[2].cbBuffer);
            auto wr = sendAll(packet.data(), total, timeoutMs);
            if (!isOk(wr))
            {
                return error(wr);
            }
            offset += chunk;
        }
        return std::monostate{};
    }

    Result<std::vector<char>> recvTls(int timeoutMs)
    {
        while (true)
        {
            auto raw = recvSome(timeoutMs);
            if (!isOk(raw))
            {
                return error(raw);
            }
            m_cipher.insert(m_cipher.end(), value(raw).begin(), value(raw).end());

            SecBuffer bufs[4]{};
            bufs[0].BufferType = SECBUFFER_DATA;
            bufs[0].pvBuffer = m_cipher.data();
            bufs[0].cbBuffer = static_cast<ULONG>(m_cipher.size());
            bufs[1].BufferType = SECBUFFER_EMPTY;
            bufs[2].BufferType = SECBUFFER_EMPTY;
            bufs[3].BufferType = SECBUFFER_EMPTY;
            SecBufferDesc desc{SECBUFFER_VERSION, 4, bufs};
            const SECURITY_STATUS st = DecryptMessage(&m_ctx, &desc, 0, nullptr);
            if (st == SEC_E_INCOMPLETE_MESSAGE)
            {
                continue;
            }
            if (st != SEC_E_OK && st != SEC_I_CONTEXT_EXPIRED)
            {
                return Error{"io_error", "IMAP TLS decrypt failed", 0};
            }
            std::vector<char> plain;
            for (int i = 0; i < 4; ++i)
            {
                if (bufs[i].BufferType == SECBUFFER_DATA && bufs[i].pvBuffer != nullptr)
                {
                    auto* p = static_cast<char*>(bufs[i].pvBuffer);
                    plain.insert(plain.end(), p, p + bufs[i].cbBuffer);
                }
            }
            std::vector<char> extra;
            for (int i = 0; i < 4; ++i)
            {
                if (bufs[i].BufferType == SECBUFFER_EXTRA && bufs[i].pvBuffer != nullptr)
                {
                    auto* p = static_cast<char*>(bufs[i].pvBuffer);
                    extra.insert(extra.end(), p, p + bufs[i].cbBuffer);
                }
            }
            m_cipher = std::move(extra);
            return plain;
        }
    }

    SOCKET m_sock{INVALID_SOCKET};
    CredHandle m_cred{};
    CtxtHandle m_ctx{};
    ULONG m_ctxFlags{0};
    SecPkgContext_StreamSizes m_sizes{};
    bool m_haveCred{false};
    bool m_haveCtx{false};
    bool m_tls{false};
    std::vector<char> m_plain;
    std::vector<char> m_pending;
    std::vector<char> m_cipher;
};

class ImapSession
{
public:
    explicit ImapSession(const ImapOtpConfig& cfg)
        : m_cfg(cfg)
    {
    }

    Result<std::monostate> connect()
    {
        auto gate = ValidateImapEndpoint(m_cfg.host, m_cfg.port, m_cfg.tls);
        if (!isOk(gate))
        {
            return error(gate);
        }
        // One getaddrinfo inside connectPlain: each sockaddr is checked with
        // IsBlockedImapHost before TCP. A second lookup would re-open DNS rebinding.

        auto cr = m_sock.connectPlain(m_cfg.host, m_cfg.port, 8000);
        if (!isOk(cr))
        {
            return error(cr);
        }
        if (m_cfg.tls == "imaps")
        {
            auto hs = m_sock.handshake(m_cfg.host, 8000);
            if (!isOk(hs))
            {
                return error(hs);
            }
        }

        auto greet = m_sock.readLine(10000);
        if (!isOk(greet))
        {
            return error(greet);
        }

        auto cap = command("CAPABILITY");
        if (!isOk(cap))
        {
            return error(cap);
        }

        if (m_cfg.tls == "starttls")
        {
            auto st = command("STARTTLS");
            if (!isOk(st))
            {
                return error(st);
            }
            auto hs = m_sock.handshake(m_cfg.host, 8000);
            if (!isOk(hs))
            {
                return error(hs);
            }
        }

        auto login = command("LOGIN " + ImapQuote(m_cfg.username) + " " + ImapQuote(m_cfg.password));
        if (!isOk(login))
        {
            std::string plain;
            plain.push_back('\0');
            plain += m_cfg.username;
            plain.push_back('\0');
            plain += m_cfg.password;
            auto auth = command("AUTHENTICATE PLAIN " + Base64Encode(plain));
            secureClearString(plain);
            if (!isOk(auth))
            {
                return error(login);
            }
        }
        return std::monostate{};
    }

    Result<bool> selectInbox()
    {
        auto r = command("SELECT INBOX");
        if (!isOk(r))
        {
            return error(r);
        }
        return value(r).find("NO") == std::string::npos && value(r).find("BAD") == std::string::npos;
    }

    Result<std::vector<int>> searchUnseenToday()
    {
        const auto now = std::chrono::system_clock::now();
        const auto t = std::chrono::system_clock::to_time_t(now);
        std::tm utc{};
        gmtime_s(&utc, &t);
        static const char* kMon[] = {
            "Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
        char date[32]{};
        std::snprintf(date, sizeof(date), "%02d-%s-%04d", utc.tm_mday, kMon[utc.tm_mon], utc.tm_year + 1900);
        auto r = command(std::string("SEARCH UNSEEN SINCE ") + date);
        if (!isOk(r))
        {
            return error(r);
        }
        std::vector<int> ids;
        const auto& text = value(r);
        const auto star = text.find("* SEARCH");
        if (star != std::string::npos)
        {
            std::istringstream iss(text.substr(star + 8));
            int n = 0;
            while (iss >> n)
            {
                ids.push_back(n);
            }
        }
        return ids;
    }

    Result<OtpMailHeaders> fetchPeek(int seq)
    {
        auto r = command(
            "FETCH " + std::to_string(seq)
            + " (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] BODY.PEEK[TEXT])");
        if (!isOk(r))
        {
            return error(r);
        }
        return ParseRfc822(value(r));
    }

    void logout()
    {
        (void)command("LOGOUT");
        m_sock.close();
    }

private:
    Result<std::string> command(const std::string& cmd)
    {
        ++m_tag;
        char tag[16];
        std::snprintf(tag, sizeof(tag), "A%03d", m_tag);
        const std::string wire = std::string(tag) + " " + cmd;
        auto wr = m_sock.writeLine(wire, 10000);
        if (!isOk(wr))
        {
            return error(wr);
        }
        std::string acc;
        while (true)
        {
            auto line = m_sock.readLine(10000);
            if (!isOk(line))
            {
                return error(line);
            }
            auto s = value(line);
            // IMAP literal {n}
            if (!s.empty() && s.back() == '}' )
            {
                const auto brace = s.find_last_of('{');
                if (brace != std::string::npos)
                {
                    int n = 0;
                    if (std::sscanf(s.c_str() + brace, "{%d}", &n) == 1 && n > 0 && n < 1'000'000)
                    {
                        auto lit = m_sock.readBytes(static_cast<std::size_t>(n), 10000);
                        if (!isOk(lit))
                        {
                            return error(lit);
                        }
                        acc += s + "\n" + value(lit) + "\n";
                        continue;
                    }
                }
            }
            acc += s + "\n";
            if (s.rfind(tag, 0) == 0)
            {
                if (s.find(" NO") != std::string::npos || s.find(" BAD") != std::string::npos)
                {
                    return Error{"io_error", "IMAP command failed", 0};
                }
                return acc;
            }
        }
    }

    ImapOtpConfig m_cfg;
    TlsSocket m_sock;
    int m_tag{0};
};

} // namespace

bool IsBlockedImapHost(const std::string& hostRaw)
{
    if (hostRaw.empty())
    {
        return true;
    }
    std::string host = hostRaw;
    if (host.size() >= 2 && host.front() == '[' && host.back() == ']')
    {
        host = host.substr(1, host.size() - 2);
    }
    host = ToLowerAscii(host);
    if (host == "localhost" || host == "metadata.google.internal")
    {
        return true;
    }
    if (host == "::1" || host == "::" || host == "0.0.0.0")
    {
        return true;
    }
    if (host.rfind("::ffff:", 0) == 0)
    {
        return IsBlockedImapHost(host.substr(7));
    }
    if (host.rfind("fe80:", 0) == 0)
    {
        return true;
    }
    std::array<int, 4> ip{};
    if (ParseIPv4(host, ip))
    {
        if (ip[0] == 127) return true;
        if (ip[0] == 10) return true;
        if (ip[0] == 192 && ip[1] == 168) return true;
        if (ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31) return true;
        if (ip[0] == 169 && ip[1] == 254) return true;
        if (ip[0] == 0) return true;
    }
    return false;
}

namespace
{

enum class ImapResolveStatus
{
    Allowed,
    Blocked,
    Unresolved,
};

// Fail closed: DNS failure is blocked. Every resolved address is checked;
// a later public A/AAAA must not un-block a private one.
ImapResolveStatus ClassifyImapHostResolution(const std::string& host)
{
    EnsureWsa();
    addrinfo hints{};
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    addrinfo* results = nullptr;
    const int rc = getaddrinfo(host.c_str(), nullptr, &hints, &results);
    if (rc != 0 || results == nullptr)
    {
        return ImapResolveStatus::Unresolved;
    }
    bool blocked = false;
    bool sawAddress = false;
    for (addrinfo* ai = results; ai != nullptr; ai = ai->ai_next)
    {
        sawAddress = true;
        if (AddrinfoEntryBlocked(ai))
        {
            blocked = true;
        }
    }
    freeaddrinfo(results);
    if (!sawAddress)
    {
        return ImapResolveStatus::Unresolved;
    }
    return blocked ? ImapResolveStatus::Blocked : ImapResolveStatus::Allowed;
}

} // namespace

bool ImapHostResolvesToBlocked(const std::string& host)
{
    return ClassifyImapHostResolution(host) != ImapResolveStatus::Allowed;
}

Result<std::monostate> ValidateImapEndpoint(
    const std::string& host,
    int port,
    const std::string& tls)
{
    if (host.find("://") != std::string::npos)
    {
        return Error{"invalid_params", "IMAP host must not include a URL scheme", 0};
    }
    if (host.empty())
    {
        return Error{"invalid_params", "IMAP host is required", 0};
    }
    if (port == 995)
    {
        return Error{"invalid_params", "POP3 port 995 is not supported; IMAP only", 0};
    }
    const bool portOk = port == 993 || port == 587 || port == 143 || port == 465;
    if (!portOk)
    {
        return Error{"invalid_params", "IMAP port is not allowed", 0};
    }
    if (tls != "imaps" && tls != "starttls")
    {
        return Error{"invalid_params", "tls must be imaps or starttls", 0};
    }
    if (IsBlockedImapHost(host))
    {
        spdlog::warn("imap_host_blocked");
        return Error{"imap_host_blocked", "IMAP host is blocked", 0};
    }
    // DNS is only done in connectPlain so the TCP peer is the same lookup
    // that passed IsBlockedImapHost. setConfig uses this literal/port rail only.
    return std::monostate{};
}

Result<ImapTestResult> ImapClient::TestInbox(const ImapOtpConfig& cfg)
{
    ImapSession session(cfg);
    auto cr = session.connect();
    if (!isOk(cr))
    {
        return error(cr);
    }
    auto sel = session.selectInbox();
    session.logout();
    if (!isOk(sel))
    {
        return error(sel);
    }
    return ImapTestResult{true, value(sel)};
}

Result<std::vector<OtpMailHeaders>> ImapClient::FetchUnseenToday(const ImapOtpConfig& cfg)
{
    ImapSession session(cfg);
    auto cr = session.connect();
    if (!isOk(cr))
    {
        return error(cr);
    }
    auto sel = session.selectInbox();
    if (!isOk(sel) || !value(sel))
    {
        session.logout();
        return Error{"io_error", "INBOX could not be selected", 0};
    }
    auto ids = session.searchUnseenToday();
    if (!isOk(ids))
    {
        session.logout();
        return error(ids);
    }
    std::vector<OtpMailHeaders> out;
    for (int id : value(ids))
    {
        auto msg = session.fetchPeek(id);
        if (isOk(msg))
        {
            out.push_back(value(msg));
        }
    }
    session.logout();
    return out;
}

} // namespace vrcsm::core
