/**
 * One-click application templates (Spec §4.10).
 * Scaffolds real files under project home; optional deploy after.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError } from '@ysk/shared';

export type AppTemplateId =
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
  runtime: 'node' | 'php' | 'static' | 'python' | 'go' | 'rust';
  runtimeVersion: string;
}

export const APP_TEMPLATES: AppTemplateMeta[] = [
  {
    id: 'node-starter',
    name: 'Node.js 起步',
    description: '最小 HTTP 伺服器（/health）+ public 靜態目錄',
    runtime: 'node',
    runtimeVersion: '20',
  },
  {
    id: 'static-site',
    name: '靜態網站',
    description: 'index.html + CSS，供 Nginx root 或靜態部署',
    runtime: 'static',
    runtimeVersion: '1',
  },
  {
    id: 'wordpress-php',
    name: 'WordPress（PHP 骨架）',
    description: 'PHP docroot + wp-config 範例（核心需另下載）',
    runtime: 'php',
    runtimeVersion: '8.2',
  },
  {
    id: 'python-fastapi',
    name: 'Python FastAPI',
    description: 'FastAPI + uvicorn；requirements.txt；/ 與 /health',
    runtime: 'python',
    runtimeVersion: '3.12',
  },
  {
    id: 'python-flask',
    name: 'Python Flask',
    description: 'Flask 最小 app.py；requirements.txt；/ 與 /health',
    runtime: 'python',
    runtimeVersion: '3.12',
  },
  {
    id: 'python-django',
    name: 'Python Django（骨架）',
    description: 'manage.py + minimal settings/urls/wsgi；需 pip install django',
    runtime: 'python',
    runtimeVersion: '3.12',
  },
  {
    id: 'go-http',
    name: 'Go HTTP',
    description: '標準庫 net/http；go.mod；/ 與 /health',
    runtime: 'go',
    runtimeVersion: '1.22',
  },
  {
    id: 'rust-http',
    name: 'Rust HTTP',
    description: '標準庫 TcpListener（無額外 crate）；Cargo.toml',
    runtime: 'rust',
    runtimeVersion: 'stable',
  },
  {
    id: 'rust-axum',
    name: 'Rust Axum',
    description: 'Axum + Tokio；需 cargo build 下載 crates（需外網）',
    runtime: 'rust',
    runtimeVersion: 'stable',
  },
];

export function listAppTemplates(): AppTemplateMeta[] {
  return APP_TEMPLATES.map((t) => ({ ...t }));
}

export function getAppTemplate(id: string): AppTemplateMeta {
  const t = APP_TEMPLATES.find((x) => x.id === id);
  if (!t) {
    throw new YskError(ErrorCodes.VALIDATION, `未知範本：${id}`, {
      httpStatus: 400,
      details: { known: APP_TEMPLATES.map((x) => x.id) },
    });
  }
  return t;
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
 * Write template files into project home (app/ or app/public).
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
  const notes: string[] = [`範本 ${meta.id}：${meta.name}`];
  const written: string[] = [];
  const appDir = join(input.homeDir, 'app');
  mkdirSync(appDir, { recursive: true });

  let result: ScaffoldResult;
  if (meta.id === 'node-starter') {
    result = scaffoldNode(input, meta, appDir, notes, written);
  } else if (meta.id === 'static-site') {
    result = scaffoldStatic(input, meta, appDir, notes, written);
  } else if (meta.id === 'wordpress-php') {
    result = scaffoldWordpress(input, meta, appDir, notes, written);
  } else if (meta.id === 'python-fastapi') {
    result = scaffoldPythonFastapi(input, meta, appDir, notes, written);
  } else if (meta.id === 'python-flask') {
    result = scaffoldPythonFlask(input, meta, appDir, notes, written);
  } else if (meta.id === 'python-django') {
    result = scaffoldPythonDjango(input, meta, appDir, notes, written);
  } else if (meta.id === 'go-http') {
    result = scaffoldGoHttp(input, meta, appDir, notes, written);
  } else if (meta.id === 'rust-axum') {
    result = scaffoldRustAxum(input, meta, appDir, notes, written);
  } else {
    // rust-http
    result = scaffoldRustHttp(input, meta, appDir, notes, written);
  }
  return attachScaffoldMarker(appDir, result);
}

/** Marker so git clone can safely replace YSK 佔位 skeleton without data-loss refuse. */
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
    if (!result.written.includes(marker)) {
      result.written.push(marker);
    }
  } catch {
    /* non-fatal */
  }
  return result;
}

function scaffoldNode(
  input: {
    projectName: string;
    force?: boolean;
  },
  meta: AppTemplateMeta,
  appDir: string,
  notes: string[],
  written: string[],
): ScaffoldResult {
  const entry = 'server.js';
  const entryPath = join(appDir, entry);
  if (existsSync(entryPath) && !input.force) {
    notes.push(`${entry} 已存在 — 已略過（force 可覆寫）`);
  } else {
    writeFileSync(
      entryPath,
      `// YSK node-starter — ${input.projectName}
const http = require('http');
const fs = require('fs');
const path = require('path');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const publicDir = path.join(__dirname, 'public');

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/health' || url === '/') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('ok ' + port + ' ' + url);
    return;
  }
  const file = path.join(publicDir, url === '/' ? 'index.html' : url.replace(/^\\//, ''));
  if (file.startsWith(publicDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.statusCode = 200;
    res.end(fs.readFileSync(file));
    return;
  }
  res.statusCode = 404;
  res.end('找不到');
});
server.listen(port, host, () => {
  process.stdout.write('ysk node-starter on ' + host + ':' + port + '\\n');
});
`,
      'utf8',
    );
    written.push(entryPath);
  }
  const pub = join(appDir, 'public');
  mkdirSync(pub, { recursive: true });
  const idx = join(pub, 'index.html');
  if (!existsSync(idx) || input.force) {
    writeFileSync(
      idx,
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(input.projectName)}</title></head>
<body><h1>${escapeHtml(input.projectName)}</h1><p>YSK Node 起步範本</p></body></html>\n`,
      'utf8',
    );
    written.push(idx);
  }
  const pkg = join(appDir, 'package.json');
  if (!existsSync(pkg) || input.force) {
    writeFileSync(
      pkg,
      JSON.stringify(
        {
          name: slug(input.projectName),
          version: '1.0.0',
          private: true,
          main: 'server.js',
          scripts: { start: 'node server.js' },
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    written.push(pkg);
  }
  notes.push('部署：面板「部署」會啟動 server.js；written ≠ 已對外');
  return { ok: true, templateId: meta.id, written, notes, entry };
}

function scaffoldStatic(
  input: { projectName: string },
  meta: AppTemplateMeta,
  appDir: string,
  notes: string[],
  written: string[],
): ScaffoldResult {
  const pub = join(appDir, 'public');
  mkdirSync(join(pub, 'assets'), { recursive: true });
  const idx = join(pub, 'index.html');
  writeFileSync(
    idx,
    `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.projectName)}</title>
  <link rel="stylesheet" href="/assets/site.css" />
</head>
<body>
  <main>
    <h1>${escapeHtml(input.projectName)}</h1>
    <p>由 YSK Server 產生的靜態站點骨架。</p>
  </main>
</body>
</html>
`,
    'utf8',
  );
  const css = join(pub, 'assets', 'site.css');
  writeFileSync(
    css,
    `body{font-family:system-ui,sans-serif;margin:2rem;background:#0b1220;color:#e8eefc}
main{max-width:40rem}h1{color:#3b82f6}
`,
    'utf8',
  );
  written.push(idx, css);
  notes.push('以 Nginx root 或「靜態部署」提供 public/');
  return { ok: true, templateId: meta.id, written, notes, docRoot: pub };
}

function scaffoldWordpress(
  input: { projectName: string; domain?: string },
  meta: AppTemplateMeta,
  appDir: string,
  notes: string[],
  written: string[],
): ScaffoldResult {
  const docRoot = join(appDir, 'public');
  mkdirSync(docRoot, { recursive: true });
  const indexPhp = join(docRoot, 'index.php');
  writeFileSync(
    indexPhp,
    `<?php
// YSK WordPress 骨架 — 下載完整 WordPress 後覆寫
header('Content-Type: text/plain; charset=utf-8');
echo "YSK PHP OK — WordPress 尚未安裝\\n";
echo "下載：curl -sL https://wordpress.org/latest.tar.gz | tar xz -C " . __DIR__ . " --strip-components=1\\n";
`,
    'utf8',
  );
  written.push(indexPhp);
  const wpConfig = join(docRoot, 'wp-config-sample-ysk.php');
  writeFileSync(
    wpConfig,
    `<?php
/**
 * YSK 範例 — WordPress 解壓後複製為 wp-config.php
 */
define('DB_NAME', getenv('WP_DB_NAME') ?: 'wordpress');
define('DB_USER', getenv('WP_DB_USER') ?: 'wpuser');
define('DB_PASSWORD', getenv('WP_DB_PASSWORD') ?: 'change-me');
define('DB_HOST', getenv('WP_DB_HOST') ?: '127.0.0.1');
define('DB_CHARSET', 'utf8mb4');
\$table_prefix = 'wp_';
if (!defined('ABSPATH')) define('ABSPATH', __DIR__ . '/');
// require_once ABSPATH . 'wp-settings.php';
`,
    'utf8',
  );
  written.push(wpConfig);
  const planPath = join(appDir, 'WORDPRESS_INSTALL.txt');
  writeFileSync(
    planPath,
    [
      `WordPress 安裝說明 — ${input.projectName}`,
      input.domain ? `域名：${input.domain}` : '',
      '1. 於面板建立 MySQL 資料庫',
      '2. 下載 WordPress 到 app/public',
      '3. 設定 wp-config.php',
      '4. 部署 PHP + 發布 Nginx／SSL',
      '',
    ]
      .filter(Boolean)
      .join('\n'),
    'utf8',
  );
  written.push(planPath);
  notes.push('未下載 WordPress 核心（需外網／另下）— 見 WORDPRESS_INSTALL.txt');
  return { ok: true, templateId: meta.id, written, notes, docRoot };
}

function scaffoldPythonFastapi(
  input: { projectName: string; force?: boolean },
  meta: AppTemplateMeta,
  appDir: string,
  notes: string[],
  written: string[],
): ScaffoldResult {
  const entry = 'main.py';
  const mainPath = join(appDir, entry);
  if (!existsSync(mainPath) || input.force) {
    writeFileSync(
      mainPath,
      `# YSK python-fastapi — ${input.projectName}
# 部署時會建 venv 並 pip install -r requirements.txt
from fastapi import FastAPI

app = FastAPI(title=${JSON.stringify(input.projectName)})

@app.get("/")
@app.get("/health")
def health():
    return {"ok": True, "app": ${JSON.stringify(input.projectName)}}
`,
      'utf8',
    );
    written.push(mainPath);
  } else {
    notes.push('main.py 已存在 — 已略過');
  }
  const req = join(appDir, 'requirements.txt');
  if (!existsSync(req) || input.force) {
    writeFileSync(req, 'fastapi>=0.110.0\nuvicorn[standard]>=0.27.0\n', 'utf8');
    written.push(req);
  }
  notes.push(
    '部署會執行 venv + pip；ExecStart 使用 uvicorn main:app',
    '需主機有 Python 與外網 pip（否則安裝依賴會失敗）',
  );
  return { ok: true, templateId: meta.id, written, notes, entry: 'main:app' };
}

function scaffoldPythonFlask(
  input: { projectName: string; force?: boolean },
  meta: AppTemplateMeta,
  appDir: string,
  notes: string[],
  written: string[],
): ScaffoldResult {
  const entry = 'app.py';
  const appPath = join(appDir, entry);
  if (!existsSync(appPath) || input.force) {
    writeFileSync(
      appPath,
      `# YSK python-flask — ${input.projectName}
import os
from flask import Flask

app = Flask(__name__)

@app.get("/")
@app.get("/health")
def health():
    return {"ok": True, "app": ${JSON.stringify(input.projectName)}}

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3000"))
    host = os.environ.get("HOST", "127.0.0.1")
    app.run(host=host, port=port)
`,
      'utf8',
    );
    written.push(appPath);
  } else {
    notes.push('app.py 已存在 — 已略過');
  }
  const req = join(appDir, 'requirements.txt');
  if (!existsSync(req) || input.force) {
    writeFileSync(req, 'flask>=3.0.0\n', 'utf8');
    written.push(req);
  }
  notes.push(
    '部署會執行 venv + pip；entry 預設 app.py（非 ASGI）',
    '需主機有 Python 與外網 pip',
  );
  return { ok: true, templateId: meta.id, written, notes, entry: 'app.py' };
}

function scaffoldPythonDjango(
  input: { projectName: string; force?: boolean },
  meta: AppTemplateMeta,
  appDir: string,
  notes: string[],
  written: string[],
): ScaffoldResult {
  const proj = slug(input.projectName).replace(/-/g, '_') || 'ysk_site';
  const manage = join(appDir, 'manage.py');
  if (!existsSync(manage) || input.force) {
    writeFileSync(
      manage,
      `#!/usr/bin/env python3
# YSK python-django skeleton — ${input.projectName}
import os
import sys

def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "${proj}.settings")
    from django.core.management import execute_from_command_line
    execute_from_command_line(sys.argv)

if __name__ == "__main__":
    main()
`,
      'utf8',
    );
    written.push(manage);
  }
  const pkgDir = join(appDir, proj);
  mkdirSync(pkgDir, { recursive: true });
  const initPy = join(pkgDir, '__init__.py');
  if (!existsSync(initPy) || input.force) {
    writeFileSync(initPy, '', 'utf8');
    written.push(initPy);
  }
  const settings = join(pkgDir, 'settings.py');
  if (!existsSync(settings) || input.force) {
    writeFileSync(
      settings,
      `# YSK Django settings skeleton — ${input.projectName}
from pathlib import Path
BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = "ysk-dev-change-me"
DEBUG = True
ALLOWED_HOSTS = ["*"]
INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]
ROOT_URLCONF = "${proj}.urls"
WSGI_APPLICATION = "${proj}.wsgi.application"
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}
LANGUAGE_CODE = "zh-hant"
TIME_ZONE = "Asia/Hong_Kong"
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
`,
      'utf8',
    );
    written.push(settings);
  }
  const urls = join(pkgDir, 'urls.py');
  if (!existsSync(urls) || input.force) {
    writeFileSync(
      urls,
      `from django.http import JsonResponse
from django.urls import path

def health(_request):
    return JsonResponse({"ok": True, "app": ${JSON.stringify(input.projectName)}})

urlpatterns = [
    path("", health),
    path("health", health),
]
`,
      'utf8',
    );
    written.push(urls);
  }
  const wsgi = join(pkgDir, 'wsgi.py');
  if (!existsSync(wsgi) || input.force) {
    writeFileSync(
      wsgi,
      `import os
from django.core.wsgi import get_wsgi_application
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "${proj}.settings")
application = get_wsgi_application()
`,
      'utf8',
    );
    written.push(wsgi);
  }
  const req = join(appDir, 'requirements.txt');
  if (!existsSync(req) || input.force) {
    writeFileSync(req, 'django>=5.0\ngunicorn>=22.0\n', 'utf8');
    written.push(req);
  }
  notes.push(
    'Django 骨架：部署時 pip install django/gunicorn',
    `進程 entry 預設 ${proj}.wsgi:application（gunicorn）`,
    '正式環境請改 SECRET_KEY／DEBUG 並配置資料庫',
  );
  // Optional stdlib fallback launcher if gunicorn missing (still useful for debug)
  const launcher = join(appDir, 'app.py');
  if (!existsSync(launcher) || input.force) {
    writeFileSync(
      launcher,
      `# Fallback launcher (prefer gunicorn ${proj}.wsgi:application) — ${input.projectName}
import os
from wsgiref.simple_server import make_server
from ${proj}.wsgi import application

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3000"))
    host = os.environ.get("HOST", "127.0.0.1")
    with make_server(host, port, application) as httpd:
        print(f"ysk django on {host}:{port}")
        httpd.serve_forever()
`,
      'utf8',
    );
    written.push(launcher);
  }
  return {
    ok: true,
    templateId: meta.id,
    written,
    notes,
    entry: `${proj}.wsgi:application`,
  };
}

function scaffoldGoHttp(
  input: { projectName: string; force?: boolean },
  meta: AppTemplateMeta,
  appDir: string,
  notes: string[],
  written: string[],
): ScaffoldResult {
  const modName = slug(input.projectName) || 'ysk-app';
  const mainPath = join(appDir, 'main.go');
  if (!existsSync(mainPath) || input.force) {
    writeFileSync(
      mainPath,
      `// YSK go-http — ${input.projectName}
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
		fmt.Fprintf(w, "ok %s %s\\n", port, r.URL.Path)
	})
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})
	addr := "127.0.0.1:" + port
	fmt.Println("ysk go-http on", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		panic(err)
	}
}
`,
      'utf8',
    );
    written.push(mainPath);
  }
  const mod = join(appDir, 'go.mod');
  if (!existsSync(mod) || input.force) {
    writeFileSync(mod, `module ${modName}\n\ngo 1.22\n`, 'utf8');
    written.push(mod);
  }
  notes.push('部署會 go build -o app .；需主機已安裝 Go toolchain');
  return { ok: true, templateId: meta.id, written, notes, entry: './app' };
}

function scaffoldRustHttp(
  input: { projectName: string; force?: boolean },
  meta: AppTemplateMeta,
  appDir: string,
  notes: string[],
  written: string[],
): ScaffoldResult {
  const crate = slug(input.projectName).replace(/-/g, '_') || 'ysk_app';
  const src = join(appDir, 'src');
  mkdirSync(src, { recursive: true });
  const mainRs = join(src, 'main.rs');
  if (!existsSync(mainRs) || input.force) {
    writeFileSync(
      mainRs,
      `// YSK rust-http — ${input.projectName}
use std::env;
use std::io::prelude::*;
use std::net::TcpListener;

fn main() {
    let port = env::var("PORT").unwrap_or_else(|_| "3000".into());
    let addr = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&addr).expect("bind");
    eprintln!("ysk rust-http on {}", addr);
    for stream in listener.incoming() {
        if let Ok(mut stream) = stream {
            let mut buf = [0; 1024];
            let _ = stream.read(&mut buf);
            let body = "ok";
            let response = format!(
                "HTTP/1.1 200 OK\\r\\nContent-Length: {}\\r\\nContent-Type: text/plain; charset=utf-8\\r\\nConnection: close\\r\\n\\r\\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
        }
    }
}
`,
      'utf8',
    );
    written.push(mainRs);
  }
  const cargo = join(appDir, 'Cargo.toml');
  if (!existsSync(cargo) || input.force) {
    writeFileSync(
      cargo,
      `[package]
name = "${crate}"
version = "0.1.0"
edition = "2021"

[dependencies]
`,
      'utf8',
    );
    written.push(cargo);
  }
  notes.push(
    `部署會 cargo build --release；二進位預設 ./target/release/${crate}`,
    '需主機已安裝 cargo／rustc',
  );
  return {
    ok: true,
    templateId: meta.id,
    written,
    notes,
    entry: `./target/release/${crate}`,
  };
}

function scaffoldRustAxum(
  input: { projectName: string; force?: boolean },
  meta: AppTemplateMeta,
  appDir: string,
  notes: string[],
  written: string[],
): ScaffoldResult {
  const crate = slug(input.projectName).replace(/-/g, '_') || 'ysk_app';
  const src = join(appDir, 'src');
  mkdirSync(src, { recursive: true });
  const mainRs = join(src, 'main.rs');
  if (!existsSync(mainRs) || input.force) {
    writeFileSync(
      mainRs,
      `// YSK rust-axum — ${input.projectName}
// cargo build 需外網下載 crates
use axum::{routing::get, Json, Router};
use serde_json::{json, Value};
use std::env;
use std::net::SocketAddr;

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "app": ${JSON.stringify(input.projectName)} }))
}

#[tokio::main]
async fn main() {
    let port: u16 = env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3000);
    let app = Router::new()
        .route("/", get(health))
        .route("/health", get(health));
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    eprintln!("ysk rust-axum on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}
`,
      'utf8',
    );
    written.push(mainRs);
  }
  const cargo = join(appDir, 'Cargo.toml');
  if (!existsSync(cargo) || input.force) {
    writeFileSync(
      cargo,
      `[package]
name = "${crate}"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
serde_json = "1"
`,
      'utf8',
    );
    written.push(cargo);
  }
  notes.push(
    `Axum 範本：cargo build --release 需外網 crates.io`,
    `二進位 ./target/release/${crate}`,
    '首次 build 可能數分鐘；失敗時見 notes／日誌',
  );
  return {
    ok: true,
    templateId: meta.id,
    written,
    notes,
    entry: `./target/release/${crate}`,
  };
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'app'
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Read package.json name if present (for tests) */
export function readAppPackageName(homeDir: string): string | null {
  const p = join(homeDir, 'app', 'package.json');
  if (!existsSync(p)) return null;
  try {
    return (JSON.parse(readFileSync(p, 'utf8')) as { name?: string }).name ?? null;
  } catch {
    return null;
  }
}
