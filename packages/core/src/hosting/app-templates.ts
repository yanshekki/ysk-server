/**
 * One Hello World demo template per hosting runtime.
 * Framework starters (WP / FastAPI / Axum…) are out of the create-project dropdown.
 * Legacy template ids remain accepted as aliases for CLI / old clients.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ErrorCodes, YskError, tl, type HostingRuntime } from 'ysk-server-shared';
import { defaultRuntimeVersion } from './runtime.js';

/** Canonical template ids (one per runtime). */
export type AppTemplateId =
  | 'node-hello'
  | 'bun-hello'
  | 'php-hello'
  | 'python-hello'
  | 'go-hello'
  | 'rust-hello'
  | 'java-hello'
  | 'kotlin-hello'
  | 'static-hello';

/** @deprecated Legacy ids still scaffold via alias map. */
export type LegacyAppTemplateId =
  | 'node-starter'
  | 'static-site'
  | 'wordpress-php'
  | 'python-fastapi'
  | 'python-flask'
  | 'python-django'
  | 'go-http'
  | 'rust-http'
  | 'rust-axum';

export interface AppTemplateMeta {
  id: AppTemplateId;
  name: string;
  description: string;
  runtime: HostingRuntime;
  runtimeVersion: string;
}

const HELLO = 'Hello World!';

/** Old id → canonical hello id (compat). */
const TEMPLATE_ALIASES: Record<string, AppTemplateId> = {
  'node-starter': 'node-hello',
  'static-site': 'static-hello',
  'wordpress-php': 'php-hello',
  'python-fastapi': 'python-hello',
  'python-flask': 'python-hello',
  'python-django': 'python-hello',
  'go-http': 'go-hello',
  'rust-http': 'rust-hello',
  'rust-axum': 'rust-hello',
};

export const APP_TEMPLATES: AppTemplateMeta[] = [
  {
    id: 'node-hello',
    name: 'Hello World!',
    description: 'Minimal Node HTTP demo',
    runtime: 'node',
    runtimeVersion: defaultRuntimeVersion('node') || '20',
  },
  {
    id: 'bun-hello',
    name: 'Hello World!',
    description: 'Minimal Bun HTTP demo',
    runtime: 'bun',
    runtimeVersion: defaultRuntimeVersion('bun') || 'latest',
  },
  {
    id: 'php-hello',
    name: 'Hello World!',
    description: 'Minimal PHP demo',
    runtime: 'php',
    runtimeVersion: defaultRuntimeVersion('php') || '8.2',
  },
  {
    id: 'python-hello',
    name: 'Hello World!',
    description: 'Minimal Python stdlib HTTP demo',
    runtime: 'python',
    runtimeVersion: defaultRuntimeVersion('python') || '3.12',
  },
  {
    id: 'go-hello',
    name: 'Hello World!',
    description: 'Minimal Go net/http demo',
    runtime: 'go',
    runtimeVersion: defaultRuntimeVersion('go') || '1.22',
  },
  {
    id: 'rust-hello',
    name: 'Hello World!',
    description: 'Minimal Rust TCP HTTP demo',
    runtime: 'rust',
    runtimeVersion: defaultRuntimeVersion('rust') || 'stable',
  },
  {
    id: 'java-hello',
    name: 'Hello World!',
    description: 'Minimal Java HTTP demo',
    runtime: 'java',
    runtimeVersion: defaultRuntimeVersion('java') || '21',
  },
  {
    id: 'kotlin-hello',
    name: 'Hello World!',
    description: 'Minimal Kotlin HTTP demo',
    runtime: 'kotlin',
    runtimeVersion: defaultRuntimeVersion('kotlin') || '2.1.0',
  },
  {
    id: 'static-hello',
    name: 'Hello World!',
    description: 'Minimal static HTML demo',
    runtime: 'static',
    runtimeVersion: '1',
  },
];

export function resolveAppTemplateId(id: string): AppTemplateId {
  const raw = String(id || '').trim();
  if (TEMPLATE_ALIASES[raw]) return TEMPLATE_ALIASES[raw];
  if (APP_TEMPLATES.some((t) => t.id === raw)) return raw as AppTemplateId;
  throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0131', { v0: id }), {
    httpStatus: 400,
    details: {
      known: [
        ...APP_TEMPLATES.map((t) => t.id),
        ...Object.keys(TEMPLATE_ALIASES),
      ],
    },
  });
}

export function listAppTemplates(): AppTemplateMeta[] {
  return APP_TEMPLATES.map((t) => ({ ...t }));
}

export function getAppTemplate(id: string): AppTemplateMeta {
  const canonical = resolveAppTemplateId(id);
  const t = APP_TEMPLATES.find((x) => x.id === canonical);
  if (!t) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0131', { v0: id }), {
      httpStatus: 400,
      details: { known: APP_TEMPLATES.map((x) => x.id) },
    });
  }
  return { ...t };
}

export interface ScaffoldResult {
  ok: boolean;
  templateId: AppTemplateId;
  written: string[];
  notes: string[];
  entry?: string;
  docRoot?: string;
}

/**
 * Write Hello World demo into project home (app/ or app/public).
 * Does not overwrite non-empty custom trees unless force.
 */
export function scaffoldAppTemplate(input: {
  templateId: string;
  homeDir: string;
  projectName: string;
  domain?: string;
  force?: boolean;
}): ScaffoldResult {
  const meta = getAppTemplate(input.templateId);
  const notes: string[] = [
    tl('notes.auto.t0132', { v0: meta.id, v1: meta.name }),
  ];
  if (TEMPLATE_ALIASES[input.templateId] && TEMPLATE_ALIASES[input.templateId] !== input.templateId) {
    notes.push(`legacy template id ${input.templateId} → ${meta.id}`);
  }
  const written: string[] = [];
  const appDir = join(input.homeDir, 'app');
  mkdirSync(appDir, { recursive: true });

  let result: ScaffoldResult;
  switch (meta.id) {
    case 'node-hello':
      result = scaffoldNodeHello(input, meta, appDir, notes, written);
      break;
    case 'bun-hello':
      result = scaffoldBunHello(input, meta, appDir, notes, written);
      break;
    case 'php-hello':
      result = scaffoldPhpHello(input, meta, appDir, notes, written);
      break;
    case 'python-hello':
      result = scaffoldPythonHello(input, meta, appDir, notes, written);
      break;
    case 'go-hello':
      result = scaffoldGoHello(input, meta, appDir, notes, written);
      break;
    case 'rust-hello':
      result = scaffoldRustHello(input, meta, appDir, notes, written);
      break;
    case 'java-hello':
      result = scaffoldJavaHello(input, meta, appDir, notes, written);
      break;
    case 'kotlin-hello':
      result = scaffoldKotlinHello(input, meta, appDir, notes, written);
      break;
    case 'static-hello':
    default:
      result = scaffoldStaticHello(input, meta, appDir, notes, written);
      break;
  }
  return attachScaffoldMarker(appDir, result);
}

export const YSK_SCAFFOLD_MARKER = '.ysk-scaffold';

function attachScaffoldMarker(appDir: string, result: ScaffoldResult): ScaffoldResult {
  if (!result.ok) return result;
  const marker = join(appDir, YSK_SCAFFOLD_MARKER);
  try {
    writeFileSync(
      marker,
      `${result.templateId}\n# YSK scaffold marker — safe to wipe on git clone\n`,
      'utf8',
    );
    if (!result.written.includes(marker)) result.written.push(marker);
  } catch {
    /* non-fatal */
  }
  return result;
}

function writeIfNeeded(
  path: string,
  content: string,
  force: boolean | undefined,
  written: string[],
  notes: string[],
  skipNote?: string,
): void {
  if (existsSync(path) && !force) {
    if (skipNote) notes.push(skipNote);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  written.push(path);
}

function scaffoldNodeHello(
  input: { projectName: string; force?: boolean },
  meta: AppTemplateMeta,
  appDir: string,
  notes: string[],
  written: string[],
): ScaffoldResult {
  const entry = 'server.js';
  writeIfNeeded(
    join(appDir, entry),
    `// YSK ${meta.id} — ${input.projectName}
const http = require('http');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const server = http.createServer((req, res) => {
  const url = req.url || '/';
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  if (url === '/health') {
    res.end('ok');
    return;
  }
  res.end(${JSON.stringify(HELLO)});
});
server.listen(port, host, () => {
  process.stdout.write('ysk hello on ' + host + ':' + port + '\\n');
});
`,
    input.force,
    written,
    notes,
    tl('notes.auto.t0133', { v0: entry }),
  );
  writeIfNeeded(
    join(appDir, 'package.json'),
    JSON.stringify(
      {
        name: slug(input.projectName),
        version: '1.0.0',
        private: true,
        main: entry,
        scripts: { start: 'node server.js' },
      },
      null,
      2,
    ) + '\n',
    input.force,
    written,
    notes,
  );
  notes.push('Node Hello World demo (server.js)');
  return { ok: true, templateId: meta.id, written, notes, entry };
}

function scaffoldBunHello(
  input: { projectName: string; force?: boolean },
  meta: AppTemplateMeta,
  appDir: string,
  notes: string[],
  written: string[],
): ScaffoldResult {
  const entry = 'server.js';
  writeIfNeeded(
    join(appDir, entry),
    `// YSK ${meta.id} — ${input.projectName}
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
Bun.serve({
  hostname: host,
  port,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response('ok');
    return new Response(${JSON.stringify(HELLO)});
  },
});
console.log('ysk hello on ' + host + ':' + port);
`,
    input.force,
    written,
    notes,
    tl('notes.auto.t0133', { v0: entry }),
  );
  writeIfNeeded(
    join(appDir, 'package.json'),
    JSON.stringify(
      {
        name: slug(input.projectName),
        version: '1.0.0',
        private: true,
        module: entry,
        scripts: { start: 'bun run server.js' },
      },
      null,
      2,
    ) + '\n',
    input.force,
    written,
    notes,
  );
  notes.push('Bun Hello World demo (server.js)');
  return { ok: true, templateId: meta.id, written, notes, entry };
}

function scaffoldPhpHello(
  input: { projectName: string; force?: boolean },
  meta: AppTemplateMeta,
  appDir: string,
  notes: string[],
  written: string[],
): ScaffoldResult {
  const docRoot = join(appDir, 'public');
  mkdirSync(docRoot, { recursive: true });
  writeIfNeeded(
    join(docRoot, 'index.php'),
    `<?php
// YSK ${meta.id} — ${escapePhp(input.projectName)}
header('Content-Type: text/plain; charset=utf-8');
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if ($path === '/health') {
  echo "ok";
  exit;
}
echo ${JSON.stringify(HELLO)};
`,
    input.force,
    written,
    notes,
  );
  notes.push('PHP Hello World demo (public/index.php)');
  return { ok: true, templateId: meta.id, written, notes, docRoot };
}

function scaffoldPythonHello(
  input: { projectName: string; force?: boolean },
  meta: AppTemplateMeta,
  appDir: string,
  notes: string[],
  written: string[],
): ScaffoldResult {
  const entry = 'app.py';
  writeIfNeeded(
    join(appDir, entry),
    `# YSK ${meta.id} — ${input.projectName}
# stdlib only — no pip packages required
from http.server import BaseHTTPRequestHandler, HTTPServer
import os

HELLO = ${JSON.stringify(HELLO)}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"ok" if self.path.startswith("/health") else HELLO.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3000"))
    host = os.environ.get("HOST", "127.0.0.1")
    print(f"ysk hello on {host}:{port}")
    HTTPServer((host, port), Handler).serve_forever()
`,
    input.force,
    written,
    notes,
    tl('notes.auto.t0133', { v0: entry }),
  );
  writeIfNeeded(join(appDir, 'requirements.txt'), '# no deps — stdlib Hello World\n', input.force, written, notes);
  notes.push('Python Hello World demo (app.py, stdlib)');
  return { ok: true, templateId: meta.id, written, notes, entry };
}

function scaffoldGoHello(
  input: { projectName: string; force?: boolean },
  meta: AppTemplateMeta,
  appDir: string,
  notes: string[],
  written: string[],
): ScaffoldResult {
  const modName = slug(input.projectName) || 'ysk-app';
  writeIfNeeded(
    join(appDir, 'main.go'),
    `// YSK ${meta.id} — ${input.projectName}
package main

import (
	"fmt"
	"net/http"
	"os"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprint(w, ${JSON.stringify(HELLO)})
	})
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})
	addr := "127.0.0.1:" + port
	fmt.Println("ysk hello on", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		panic(err)
	}
}
`,
    input.force,
    written,
    notes,
  );
  writeIfNeeded(
    join(appDir, 'go.mod'),
    `module ${modName}\n\ngo 1.22\n`,
    input.force,
    written,
    notes,
  );
  notes.push('Go Hello World demo (main.go)');
  return { ok: true, templateId: meta.id, written, notes, entry: './app' };
}

function scaffoldRustHello(
  input: { projectName: string; force?: boolean },
  meta: AppTemplateMeta,
  appDir: string,
  notes: string[],
  written: string[],
): ScaffoldResult {
  const crate = slug(input.projectName).replace(/-/g, '_') || 'ysk_app';
  mkdirSync(join(appDir, 'src'), { recursive: true });
  writeIfNeeded(
    join(appDir, 'Cargo.toml'),
    `[package]
name = "${crate}"
version = "0.1.0"
edition = "2021"

[dependencies]
`,
    input.force,
    written,
    notes,
  );
  writeIfNeeded(
    join(appDir, 'src', 'main.rs'),
    `// YSK ${meta.id} — ${input.projectName}
// std only
use std::env;
use std::io::{Read, Write};
use std::net::TcpListener;

fn main() {
    let port = env::var("PORT").unwrap_or_else(|_| "3000".into());
    let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let addr = format!("{}:{}", host, port);
    let listener = TcpListener::bind(&addr).expect("bind");
    eprintln!("ysk hello on {}", addr);
    for stream in listener.incoming() {
        if let Ok(mut s) = stream {
            let mut buf = [0u8; 1024];
            let _ = s.read(&mut buf);
            let req = String::from_utf8_lossy(&buf);
            let body = if req.contains(" /health") {
                "ok"
            } else {
                ${JSON.stringify(HELLO)}
            };
            let resp = format!(
                "HTTP/1.1 200 OK\\r\\nContent-Type: text/plain; charset=utf-8\\r\\nContent-Length: {}\\r\\nConnection: close\\r\\n\\r\\n{}",
                body.len(),
                body
            );
            let _ = s.write_all(resp.as_bytes());
        }
    }
}
`,
    input.force,
    written,
    notes,
  );
  notes.push('Rust Hello World demo (src/main.rs, std only)');
  return { ok: true, templateId: meta.id, written, notes, entry: `./target/release/${crate}` };
}

function scaffoldJavaHello(
  input: { projectName: string; force?: boolean },
  meta: AppTemplateMeta,
  appDir: string,
  notes: string[],
  written: string[],
): ScaffoldResult {
  const entry = 'HelloServer.java';
  writeIfNeeded(
    join(appDir, entry),
    `// YSK ${meta.id} — ${input.projectName}
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

public class HelloServer {
  public static void main(String[] args) throws IOException {
    int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "3000"));
    String host = System.getenv().getOrDefault("HOST", "127.0.0.1");
    HttpServer server = HttpServer.create(new InetSocketAddress(host, port), 0);
    server.createContext("/", ex -> {
      String path = ex.getRequestURI().getPath();
      byte[] body = ("/health".equals(path) ? "ok" : ${JSON.stringify(HELLO)})
          .getBytes(StandardCharsets.UTF_8);
      ex.getResponseHeaders().add("Content-Type", "text/plain; charset=utf-8");
      ex.sendResponseHeaders(200, body.length);
      try (OutputStream os = ex.getResponseBody()) { os.write(body); }
    });
    server.start();
    System.out.println("ysk hello on " + host + ":" + port);
  }
}
`,
    input.force,
    written,
    notes,
  );
  notes.push('Java Hello World demo (HelloServer.java)');
  return { ok: true, templateId: meta.id, written, notes, entry };
}

function scaffoldKotlinHello(
  input: { projectName: string; force?: boolean },
  meta: AppTemplateMeta,
  appDir: string,
  notes: string[],
  written: string[],
): ScaffoldResult {
  const entry = 'HelloServer.kt';
  writeIfNeeded(
    join(appDir, entry),
    `// YSK ${meta.id} — ${input.projectName}
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress

fun main() {
    val port = System.getenv("PORT")?.toIntOrNull() ?: 3000
    val host = System.getenv("HOST") ?: "127.0.0.1"
    val server = HttpServer.create(InetSocketAddress(host, port), 0)
    server.createContext("/") { ex ->
        val path = ex.requestURI.path
        val body = (if (path == "/health") "ok" else ${JSON.stringify(HELLO)})
            .toByteArray(Charsets.UTF_8)
        ex.responseHeaders.add("Content-Type", "text/plain; charset=utf-8")
        ex.sendResponseHeaders(200, body.size.toLong())
        ex.responseBody.use { it.write(body) }
    }
    server.start()
    println("ysk hello on $host:$port")
}
`,
    input.force,
    written,
    notes,
  );
  notes.push('Kotlin Hello World demo (HelloServer.kt)');
  return { ok: true, templateId: meta.id, written, notes, entry };
}

function scaffoldStaticHello(
  input: { projectName: string; force?: boolean },
  meta: AppTemplateMeta,
  appDir: string,
  notes: string[],
  written: string[],
): ScaffoldResult {
  const pub = join(appDir, 'public');
  mkdirSync(pub, { recursive: true });
  writeIfNeeded(
    join(pub, 'index.html'),
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.projectName)}</title>
</head>
<body>
  <h1>${HELLO}</h1>
  <p>${escapeHtml(input.projectName)}</p>
</body>
</html>
`,
    input.force,
    written,
    notes,
  );
  notes.push('Static Hello World demo (public/index.html)');
  return { ok: true, templateId: meta.id, written, notes, docRoot: pub };
}

function slug(name: string): string {
  return String(name || 'app')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'app';
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapePhp(s: string): string {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Read package.json name if present (tests / deploy hints). */
export function readAppPackageName(homeDir: string): string | undefined {
  try {
    const raw = readFileSync(join(homeDir, 'app', 'package.json'), 'utf8');
    const j = JSON.parse(raw) as { name?: string };
    return j.name;
  } catch {
    return undefined;
  }
}
