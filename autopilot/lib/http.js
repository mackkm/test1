/* Tiny zero-dependency HTTP(S) client used by every autopilot module.
 *
 * Honors HTTPS_PROXY (CONNECT tunneling) so the pipeline also works from
 * behind corporate/agent proxies during development; on a plain cloud VM it
 * speaks TLS directly. */

"use strict";

const https = require("https");
const http = require("http");
const net = require("net");
const tls = require("tls");
const { URL } = require("url");

const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";

function connectThroughProxy(target, proxyUrl) {
  return new Promise((resolve, reject) => {
    const proxy = new URL(proxyUrl);
    const req = http.request({
      host: proxy.hostname,
      port: proxy.port || 80,
      method: "CONNECT",
      path: `${target.hostname}:${target.port || 443}`,
      headers: proxy.username
        ? {
            "Proxy-Authorization":
              "Basic " +
              Buffer.from(
                `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
              ).toString("base64"),
          }
        : {},
    });
    req.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return reject(new Error(`proxy CONNECT failed: ${res.statusCode}`));
      }
      resolve(socket);
    });
    req.on("error", reject);
    req.end();
  });
}

/* request(url, {method, headers, body, timeoutMs}) -> {status, headers, body:Buffer}
 * body may be a string, Buffer, or a function(write, end) for streaming. */
async function request(url, opts = {}) {
  const u = new URL(url);
  const timeoutMs = opts.timeoutMs || 60000;
  const options = {
    method: opts.method || "GET",
    host: u.hostname,
    port: u.port || (u.protocol === "http:" ? 80 : 443),
    path: u.pathname + u.search,
    headers: { "user-agent": "campaign-autopilot/1.0", ...(opts.headers || {}) },
  };
  const isHttps = u.protocol === "https:";
  let mod = isHttps ? https : http;
  if (isHttps && PROXY) {
    // TLS over the proxy's CONNECT tunnel; hand the finished TLS socket to the
    // plain http module (https.request would try to handshake a second time).
    const socket = await connectThroughProxy(u, PROXY);
    const tlsSocket = tls.connect({ socket, servername: u.hostname });
    // note: agent must stay unset — node only honors createConnection agentless
    options.createConnection = () => tlsSocket;
    mod = http;
  }

  return new Promise((resolve, reject) => {
    const req = mod.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
      );
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms: ${url}`)));
    req.on("error", reject);
    if (typeof opts.body === "function") opts.body(req);
    else req.end(opts.body || undefined);
  });
}

/* Follows up to 5 redirects (needed for RSS feeds and media downloads). */
async function requestFollow(url, opts = {}, hops = 5) {
  const res = await request(url, opts);
  if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location && hops > 0) {
    const next = new URL(res.headers.location, url).toString();
    const method = res.status === 303 ? "GET" : opts.method;
    return requestFollow(next, { ...opts, method }, hops - 1);
  }
  return res;
}

async function requestJSON(url, opts = {}) {
  const headers = { accept: "application/json", ...(opts.headers || {}) };
  let body = opts.body;
  if (body !== undefined && typeof body !== "string" && !Buffer.isBuffer(body)) {
    body = JSON.stringify(body);
    headers["content-type"] = headers["content-type"] || "application/json";
  }
  const res = await requestFollow(url, { ...opts, headers, body });
  const text = res.body.toString("utf8");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* leave json null; caller sees raw text */
  }
  if (res.status >= 400) {
    const err = new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 400)}`);
    err.status = res.status;
    err.json = json;
    throw err;
  }
  return json !== null ? json : text;
}

/* application/x-www-form-urlencoded POST (OAuth token endpoints). */
function form(fields) {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

module.exports = { request, requestFollow, requestJSON, form };
