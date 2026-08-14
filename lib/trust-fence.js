function header(headers, name) {
    const value = headers[name];
    return typeof value === "string" ? value : undefined;
}
export function isLoopbackHostname(hostname) {
    if (hostname === "localhost" || hostname === "[::1]")
        return true;
    const parts = hostname.split(".");
    return (parts.length === 4 &&
        parts[0] === "127" &&
        parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255));
}
/** 仅本机 + 同源标记（无跨站 Origin / Sec-Fetch-Site）的请求可以通过。 */
export function isTrustedApiRequest(request) {
    const host = header(request.headers, "host");
    if (host === undefined)
        return false;
    let hostUrl;
    try {
        hostUrl = new URL(`http://${host}`);
    }
    catch {
        return false;
    }
    if (!isLoopbackHostname(hostUrl.hostname))
        return false;
    if (header(request.headers, "sec-fetch-site") === "cross-site")
        return false;
    const origin = header(request.headers, "origin");
    if (origin === undefined)
        return true;
    try {
        return new URL(origin).host === hostUrl.host;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=trust-fence.js.map