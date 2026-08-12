#!/usr/bin/env bash
# Install / remove components by id
# shellcheck shell=bash

# Never use "No configuration" — that leaves package installed but no main.cf,
# so systemd ConditionPathExists=/etc/postfix/main.cf skips start (panel: 已停止).
preseed_postfix() {
  local mailname
  mailname="$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo localhost)"
  echo "postfix postfix/main_mailer_type select Internet Site" | $SUDO debconf-set-selections || true
  echo "postfix postfix/mailname string ${mailname}" | $SUDO debconf-set-selections || true
  echo "postfix postfix/destinations string ${mailname}, localhost.localdomain, localhost" | $SUDO debconf-set-selections || true
}

# Safe heal: only create main.cf when missing (never overwrite operator config).
ensure_postfix_main_cf() {
  resolve_sudo
  if [[ -f /etc/postfix/main.cf ]]; then
    return 0
  fi
  local src=""
  if [[ -f /etc/postfix/main.cf.proto ]]; then
    src=/etc/postfix/main.cf.proto
  elif [[ -f /usr/share/postfix/main.cf.debian ]]; then
    src=/usr/share/postfix/main.cf.debian
  fi
  if [[ -z "$src" ]]; then
    warn "postfix main.cf missing and no template found"
    return 1
  fi
  log "postfix: creating /etc/postfix/main.cf from $src (was missing)"
  # shellcheck disable=SC2086
  $SUDO cp -a "$src" /etc/postfix/main.cf || return 1
  # shellcheck disable=SC2086
  $SUDO postfix set-permissions 2>/dev/null || true
  return 0
}

ensure_rust_on_path() {
  resolve_sudo
  local src
  for src in /usr/local/cargo/bin/cargo /usr/local/cargo/bin/rustc /usr/local/cargo/bin/rustup \
             "${HOME}/.cargo/bin/cargo" "${HOME}/.cargo/bin/rustc" /root/.cargo/bin/cargo; do
    if [[ -x "$src" ]]; then
      local base dest
      base="$(basename "$src")"
      dest="/usr/local/bin/$base"
      # shellcheck disable=SC2086
      $SUDO ln -sfn "$src" "$dest" 2>/dev/null || ln -sfn "$src" "$dest" 2>/dev/null || true
    fi
  done
  # shellcheck disable=SC1091
  [[ -f /usr/local/cargo/env ]] && . /usr/local/cargo/env || true
  # shellcheck disable=SC1090
  [[ -f "$HOME/.cargo/env" ]] && . "$HOME/.cargo/env" || true
  export PATH="/usr/local/bin:/usr/local/cargo/bin:${HOME}/.cargo/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
}

install_component_rust() {
  if find_bin cargo >/dev/null 2>&1 && find_bin rustc >/dev/null 2>&1; then
    log "Rust already present"
    ensure_rust_on_path
    manifest_add_component "rust" "" "" "/usr/local/cargo,/usr/local/rustup" "rustup"
    return 0
  fi
  if ! require_cmd curl; then
    record_hard_fail "curl required for rustup"
    return 1
  fi
  resolve_sudo
  log "Installing Rust via rustup (system-wide)..."
  local script
  script="$(mktemp)"
  curl -fsSL https://sh.rustup.rs -o "$script" || {
    rm -f "$script"
    record_hard_fail "rustup download failed"
    return 1
  }
  if [[ "$(id -u)" -eq 0 ]]; then
    env CARGO_HOME=/usr/local/cargo RUSTUP_HOME=/usr/local/rustup \
      sh "$script" -y --no-modify-path --default-toolchain stable || {
      rm -f "$script"
      record_hard_fail "rustup failed"
      return 1
    }
  else
    # shellcheck disable=SC2086
    $SUDO env CARGO_HOME=/usr/local/cargo RUSTUP_HOME=/usr/local/rustup \
      sh "$script" -y --no-modify-path --default-toolchain stable || {
      rm -f "$script"
      record_hard_fail "rustup failed"
      return 1
    }
  fi
  rm -f "$script"
  ensure_rust_on_path
  if ! find_bin cargo >/dev/null 2>&1; then
    record_hard_fail "cargo missing after rustup"
    return 1
  fi
  manifest_add_component "rust" "" "" "/usr/local/cargo,/usr/local/rustup" "rustup"
}

install_component_node() {
  export PATH="/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
  if require_cmd node; then
    local major
    major="$(node -p "process.versions.node.split('.')[0]")"
    if [[ "$major" -ge "$MIN_NODE_MAJOR" ]]; then
      log "Node.js $(node -v) already installed"
      manifest_add_component "node" "nodejs" "" "" "nodesource"
      return 0
    fi
    log "Node.js too old ($(node -v)); upgrading via NodeSource"
  else
    log "Installing Node.js 20.x via NodeSource"
  fi
  resolve_sudo
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash - || {
    record_hard_fail "NodeSource setup failed"
    return 1
  }
  # shellcheck disable=SC2086
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs || {
    record_hard_fail "nodejs install failed"
    return 1
  }
  manifest_add_component "node" "nodejs" "" "" "nodesource"
  log "Node.js $(node -v)"
}

# Default OpenJDK LTS for stack install (panel can install 17/21 via runtime API).
install_component_java() {
  export PATH="/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
  local ver="${YSK_JAVA_VERSION:-21}"
  if require_cmd java && require_cmd javac; then
    log "Java already present: $(java -version 2>&1 | head -1)"
    manifest_add_component "java" "openjdk-${ver}-jdk" "" "" "apt"
    return 0
  fi
  resolve_sudo
  log "Installing OpenJDK ${ver}..."
  # shellcheck disable=SC2086
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -qq || true
  # shellcheck disable=SC2086
  if ! $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y "openjdk-${ver}-jdk"; then
    if [[ "$ver" != "17" ]]; then
      log "openjdk-${ver}-jdk failed; trying openjdk-17-jdk"
      # shellcheck disable=SC2086
      $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y openjdk-17-jdk || {
        record_hard_fail "OpenJDK install failed"
        return 1
      }
      ver=17
    else
      record_hard_fail "OpenJDK install failed"
      return 1
    fi
  fi
  if ! require_cmd java; then
    record_hard_fail "java missing after apt install"
    return 1
  fi
  manifest_add_component "java" "openjdk-${ver}-jdk" "" "" "apt"
  log "Java: $(java -version 2>&1 | head -1)"
}

install_component_bun() {
  export PATH="/usr/local/bin:/usr/local/ysk/bun/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
  if require_cmd bun; then
    log "Bun already present: $(bun --version 2>/dev/null || true)"
    manifest_add_component "bun" "" "" "/usr/local/ysk/bun" "bun-official"
    return 0
  fi
  if ! require_cmd curl; then
    record_hard_fail "curl required for Bun install"
    return 1
  fi
  resolve_sudo
  log "Installing Bun to /usr/local/ysk/bun..."
  # shellcheck disable=SC2086
  $SUDO mkdir -p /usr/local/ysk/bun /usr/local/bin
  # Official installer respects BUN_INSTALL
  # shellcheck disable=SC2086
  if ! $SUDO env BUN_INSTALL=/usr/local/ysk/bun bash -c 'curl -fsSL https://bun.sh/install | bash'; then
    record_hard_fail "Bun install script failed"
    return 1
  fi
  if [[ -x /usr/local/ysk/bun/bin/bun ]]; then
    # shellcheck disable=SC2086
    $SUDO ln -sfn /usr/local/ysk/bun/bin/bun /usr/local/bin/bun
  fi
  export PATH="/usr/local/bin:/usr/local/ysk/bun/bin:${PATH:-}"
  if ! require_cmd bun; then
    record_hard_fail "bun missing after install"
    return 1
  fi
  manifest_add_component "bun" "" "" "/usr/local/ysk/bun" "bun-official"
  log "Bun: $(bun --version)"
}

# Kotlin compiler (needs JDK). Uses GitHub release zip from JetBrains.
install_component_kotlin() {
  export PATH="/usr/local/bin:/usr/local/ysk/kotlin/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
  if require_cmd kotlin || require_cmd kotlinc; then
    log "Kotlin already present"
    manifest_add_component "kotlin" "" "" "/usr/local/ysk/kotlin" "kotlin-official"
    return 0
  fi
  # Ensure JDK first
  if ! require_cmd java; then
    log "Kotlin requires Java — installing OpenJDK first"
    install_component_java || return 1
  fi
  if ! require_cmd curl; then
    record_hard_fail "curl required for Kotlin install"
    return 1
  fi
  resolve_sudo
  local ver="${YSK_KOTLIN_VERSION:-2.1.0}"
  local dest="/usr/local/ysk/kotlin"
  local tmp url
  tmp="$(mktemp -d)"
  log "Installing Kotlin ${ver} to ${dest}..."
  url="https://github.com/JetBrains/kotlin/releases/download/v${ver}/kotlin-compiler-${ver}.zip"
  if ! curl -fsSL "$url" -o "$tmp/kotlin.zip"; then
    # fallback slightly older LTS-ish
    ver="2.0.21"
    url="https://github.com/JetBrains/kotlin/releases/download/v${ver}/kotlin-compiler-${ver}.zip"
    curl -fsSL "$url" -o "$tmp/kotlin.zip" || {
      rm -rf "$tmp"
      record_hard_fail "Kotlin download failed"
      return 1
    }
  fi
  # shellcheck disable=SC2086
  $SUDO rm -rf "$dest"
  # shellcheck disable=SC2086
  $SUDO mkdir -p "$dest" /usr/local/bin "$tmp/out"
  if command -v unzip >/dev/null 2>&1; then
    unzip -q "$tmp/kotlin.zip" -d "$tmp/out" || {
      rm -rf "$tmp"
      record_hard_fail "unzip kotlin failed"
      return 1
    }
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$tmp/kotlin.zip" "$tmp/out" <<'PY' || {
import sys, zipfile, os
os.makedirs(sys.argv[2], exist_ok=True)
zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])
PY
      rm -rf "$tmp"
      record_hard_fail "extract kotlin failed"
      return 1
    }
  else
    rm -rf "$tmp"
    record_hard_fail "unzip or python3 required for Kotlin"
    return 1
  fi
  # zip extracts to kotlinc/
  if [[ -d "$tmp/out/kotlinc" ]]; then
    # shellcheck disable=SC2086
    $SUDO cp -a "$tmp/out/kotlinc/." "$dest/"
  else
    # shellcheck disable=SC2086
    $SUDO cp -a "$tmp/out/." "$dest/"
  fi
  rm -rf "$tmp"
  for b in kotlin kotlinc; do
    if [[ -x "$dest/bin/$b" ]]; then
      # shellcheck disable=SC2086
      $SUDO ln -sfn "$dest/bin/$b" "/usr/local/bin/$b"
    fi
  done
  export PATH="/usr/local/bin:${dest}/bin:${PATH:-}"
  if ! require_cmd kotlinc && ! require_cmd kotlin; then
    record_hard_fail "kotlin missing after install"
    return 1
  fi
  manifest_add_component "kotlin" "" "" "/usr/local/ysk/kotlin" "kotlin-official"
  log "Kotlin installed (${ver})"
}

# Topology: Nginx owns public :80/:443 (TLS edge / reverse proxy).
# Apache is PHP backend only on loopback (default 127.0.0.1:8080) — both may run together.
# Override with YSK_APACHE_BACKEND_BIND / YSK_APACHE_BACKEND_PORT.
apache_backend_bind() { printf '%s' "${YSK_APACHE_BACKEND_BIND:-127.0.0.1}"; }
apache_backend_port() { printf '%s' "${YSK_APACHE_BACKEND_PORT:-8080}"; }

# Move Apache off :80/:443 so Nginx can be the public edge. Idempotent.
configure_apache_as_nginx_backend() {
  resolve_sudo
  local bind port ports conf_d sites_d f
  bind="$(apache_backend_bind)"
  port="$(apache_backend_port)"
  ports="/etc/apache2/ports.conf"
  conf_d="/etc/apache2/conf-available"
  sites_d="/etc/apache2/sites-available"

  if [[ ! -d /etc/apache2 ]]; then
    return 0
  fi

  log "Configuring Apache as Nginx backend (${bind}:${port}); Nginx keeps public :80/:443"

  if [[ -f "$ports" ]]; then
    # shellcheck disable=SC2086
    $SUDO cp -a "$ports" "${ports}.ysk-bak" 2>/dev/null || true
  fi
  # shellcheck disable=SC2086
  $SUDO tee "$ports" >/dev/null <<EOF
# Managed by YSK install — Apache is PHP backend only.
# Nginx terminates TLS / listens on public :80 and :443 and proxies here.
# Override: YSK_APACHE_BACKEND_BIND / YSK_APACHE_BACKEND_PORT
Listen ${bind}:${port}
EOF

  # Default site: bind backend port only (not *:80)
  if [[ -f "${sites_d}/000-default.conf" ]]; then
    # shellcheck disable=SC2086
    $SUDO cp -a "${sites_d}/000-default.conf" "${sites_d}/000-default.conf.ysk-bak" 2>/dev/null || true
    # shellcheck disable=SC2086
    $SUDO sed -i \
      -e "s/<VirtualHost \*:80>/<VirtualHost ${bind}:${port}>/g" \
      -e "s/<VirtualHost \*:443>/<VirtualHost ${bind}:$((port + 1))>/g" \
      "${sites_d}/000-default.conf" 2>/dev/null || true
  fi
  # Drop public SSL vhost if present — TLS is Nginx's job
  if [[ -f "${sites_d}/default-ssl.conf" ]] && command -v a2dissite >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    $SUDO a2dissite default-ssl 2>/dev/null || true
  fi

  # Marker for operators / panel
  # shellcheck disable=SC2086
  $SUDO mkdir -p "$conf_d" 2>/dev/null || true
  # shellcheck disable=SC2086
  $SUDO tee "${conf_d}/ysk-backend-port.conf" >/dev/null <<EOF
# YSK: Apache backend for Nginx reverse proxy
# Listen is set in ports.conf → ${bind}:${port}
EOF
  if command -v a2enconf >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    $SUDO a2enconf ysk-backend-port 2>/dev/null || true
  fi

  if command -v apache2ctl >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    if ! $SUDO apache2ctl configtest 2>/dev/null; then
      warn "apache2ctl configtest failed after backend rebind — check /etc/apache2"
      return 1
    fi
  fi
  # shellcheck disable=SC2086
  $SUDO systemctl restart apache2 2>/dev/null || $SUDO systemctl start apache2 2>/dev/null || true
  if systemctl is-active --quiet apache2 2>/dev/null; then
    log "  Apache backend active on ${bind}:${port}"
    return 0
  fi
  warn "  Apache not active after backend rebind (may still be installing)"
  return 0
}

# Before Nginx starts: if Apache is present, move it to loopback backend (do NOT stop Apache).
ensure_nginx_owns_public_http() {
  if [[ -d /etc/apache2 ]] || systemctl list-unit-files apache2.service 2>/dev/null | grep -q apache2; then
    configure_apache_as_nginx_backend || true
  fi
}

enable_component_units() {
  local id="$1"
  shift
  local units=("$@")
  local u st
  [[ ${#units[@]} -eq 0 ]] && return 0
  resolve_sudo
  for u in "${units[@]}"; do
    [[ -z "$u" ]] && continue
    log "Enable/start unit: $u (component $id)"
    # shellcheck disable=SC2086
    if ! $SUDO systemctl enable --now "$u" 2>/dev/null; then
      # shellcheck disable=SC2086
      $SUDO systemctl start "$u" 2>/dev/null || true
    fi
    st="$(systemctl is-active "$u" 2>/dev/null || true)"
    st="$(echo "$st" | head -1 | tr -d '[:space:]')"
    if [[ "$st" == "active" ]]; then
      log "  unit $u → active"
    elif component_is_optional "$id"; then
      warn "  unit $u → ${st:-unknown} (optional component; soft)"
      SOFT_SKIPS+=("unit:$u:$st")
    else
      err "  unit $u → ${st:-unknown} (expected active)"
      # shellcheck disable=SC2086
      $SUDO journalctl -u "$u" -n 15 --no-pager 2>/dev/null | while IFS= read -r line; do
        err "    $line"
      done || true
      if [[ "$st" == "failed" || "$st" == "inactive" || -z "$st" ]]; then
        record_hard_fail "unit not active after install: $u ($st)"
        return 1
      fi
    fi
  done
  return 0
}

install_component_apt() {
  local id="$1"
  local pkgs=()
  local opt=()
  local units=()
  local dpaths=()
  local p u d
  while IFS= read -r p; do [[ -n "$p" ]] && pkgs+=("$p"); done < <(component_field_array "$id" "aptPackages")
  while IFS= read -r p; do [[ -n "$p" ]] && opt+=("$p"); done < <(component_field_array "$id" "optionalApt")
  while IFS= read -r u; do [[ -n "$u" ]] && units+=("$u"); done < <(component_field_array "$id" "units")
  while IFS= read -r d; do [[ -n "$d" ]] && dpaths+=("$d"); done < <(component_field_array "$id" "dataPaths")

  if [[ "$id" == "postfix" ]]; then
    preseed_postfix
  fi

  # Nginx edge needs :80 free of Apache's default Listen 80 — rebind Apache, never kill it.
  if [[ "$id" == "nginx" ]]; then
    ensure_nginx_owns_public_http
  fi

  if [[ ${#pkgs[@]} -gt 0 ]]; then
    if component_is_optional "$id"; then
      apt_install_optional "${pkgs[@]}"
    else
      apt_install_core "${pkgs[@]}" || return 1
    fi
  fi
  if [[ ${#opt[@]} -gt 0 ]]; then
    apt_install_optional "${opt[@]}"
  fi

  # After Apache package: immediately backend-only so it does not steal :80 from Nginx
  if [[ "$id" == "apache2" ]]; then
    configure_apache_as_nginx_backend || true
  fi

  # Postfix: package may be present without main.cf (old No-configuration seed or
  # incomplete configure). Heal before enable/start so unit is not permanently skipped.
  if [[ "$id" == "postfix" ]]; then
    ensure_postfix_main_cf || true
  fi

  # Package postinst may leave unit failed (e.g. bind conflict). Re-assert + verify.
  if [[ ${#units[@]} -gt 0 ]]; then
    if [[ "$id" == "nginx" ]]; then
      ensure_nginx_owns_public_http
    fi
    enable_component_units "$id" "${units[@]}" || return 1
  fi

  local pkgs_csv units_csv data_csv
  pkgs_csv="$(IFS=','; echo "${pkgs[*]}")"
  units_csv="$(IFS=','; echo "${units[*]}")"
  data_csv="$(IFS=','; echo "${dpaths[*]}")"
  manifest_add_component "$id" "$pkgs_csv" "$units_csv" "$data_csv" "apt"
}

install_component() {
  local id="$1"
  log "Install component: $id"
  case "$id" in
    rust) install_component_rust ;;
    node) install_component_node ;;
    java) install_component_java ;;
    kotlin) install_component_kotlin ;;
    bun) install_component_bun ;;
    control-plane-product)
      # handled later in install_product phase
      log "  (product deferred to product phase)"
      ;;
    *)
      local src
      src="$(jq -r --arg id "$id" '.components[$id].source // "apt"' "$COMPONENTS_JSON")"
      case "$src" in
        rustup) install_component_rust ;;
        nodesource) install_component_node ;;
        bun-official) install_component_bun ;;
        kotlin-official) install_component_kotlin ;;
        npm) log "  npm product deferred" ;;
        *) install_component_apt "$id" ;;
      esac
      ;;
  esac
}

# Resolve final component list from bundles + options
# Sets SELECTED_COMPONENTS array
resolve_components_from_bundles() {
  local bundles_csv="$1"
  local sql_server="${2:-mariadb}" # mariadb | mysql
  local with_clamav="${3:-0}"
  SELECTED_COMPONENTS=()
  local b c
  local IFS=','
  # shellcheck disable=SC2086
  for b in $bundles_csv; do
    b="$(echo "$b" | tr -d '[:space:]')"
    [[ -z "$b" ]] && continue
    while IFS= read -r c; do
      [[ -z "$c" ]] && continue
      # SQL exclusive
      if [[ "$c" == "mariadb-server" && "$sql_server" == "mysql" ]]; then
        c="mysql-server"
      elif [[ "$c" == "mysql-server" && "$sql_server" == "mariadb" ]]; then
        continue
      fi
      if [[ "$c" == "mariadb-server" && "$sql_server" != "mariadb" ]]; then continue; fi
      if [[ "$c" == "mysql-server" && "$sql_server" != "mysql" ]]; then continue; fi
      array_contains "$c" "${SELECTED_COMPONENTS[@]+"${SELECTED_COMPONENTS[@]}"}" || SELECTED_COMPONENTS+=("$c")
    done < <(bundle_components "$b")
    # optional components
    while IFS= read -r c; do
      [[ -z "$c" ]] && continue
      if [[ "$c" == "clamav" && "$with_clamav" -ne 1 ]]; then continue; fi
      if [[ "$c" == "rspamd" ]]; then
        # include rspamd as optional install attempt when email selected
        array_contains "$c" "${SELECTED_COMPONENTS[@]+"${SELECTED_COMPONENTS[@]}"}" || SELECTED_COMPONENTS+=("$c")
      fi
      if [[ "$c" == "clamav" && "$with_clamav" -eq 1 ]]; then
        array_contains "$c" "${SELECTED_COMPONENTS[@]+"${SELECTED_COMPONENTS[@]}"}" || SELECTED_COMPONENTS+=("$c")
      fi
    done < <(bundle_optional_components "$b")
  done
  # always ensure control-plane base pieces if any install
  if ! array_contains "base-deps" "${SELECTED_COMPONENTS[@]+"${SELECTED_COMPONENTS[@]}"}"; then
    SELECTED_COMPONENTS=("base-deps" "${SELECTED_COMPONENTS[@]+"${SELECTED_COMPONENTS[@]}"}")
  fi
}

stop_component_units() {
  local id="$1"
  local u
  while IFS= read -r u; do
    [[ -z "$u" ]] && continue
    log "  stop/disable $u"
    # shellcheck disable=SC2086
    $SUDO systemctl stop "$u" 2>/dev/null || true
    # shellcheck disable=SC2086
    $SUDO systemctl disable "$u" 2>/dev/null || true
  done < <(manifest_component_units "$id")
  # also from components.json if not in manifest
  while IFS= read -r u; do
    [[ -z "$u" ]] && continue
    # shellcheck disable=SC2086
    $SUDO systemctl stop "$u" 2>/dev/null || true
    # shellcheck disable=SC2086
    $SUDO systemctl disable "$u" 2>/dev/null || true
  done < <(component_field_array "$id" "units")
}

remove_component() {
  local id="$1"
  local data_policy="${2:-keep}" # keep | purge
  log "Remove component: $id (data=$data_policy)"
  resolve_sudo

  if [[ "$id" == "rust" ]]; then
    stop_component_units "$id"
    if [[ "$data_policy" == "purge" ]]; then
      # shellcheck disable=SC2086
      $SUDO rm -rf /usr/local/cargo /usr/local/rustup 2>/dev/null || true
      # shellcheck disable=SC2086
      $SUDO rm -f /usr/local/bin/cargo /usr/local/bin/rustc /usr/local/bin/rustup 2>/dev/null || true
    else
      log "  keep Rust toolchains on disk (keep-data)"
    fi
    manifest_remove_component "$id"
    return 0
  fi

  if [[ "$id" == "bun" ]]; then
    if [[ "$data_policy" == "purge" ]]; then
      # shellcheck disable=SC2086
      $SUDO rm -rf /usr/local/ysk/bun 2>/dev/null || true
      # shellcheck disable=SC2086
      $SUDO rm -f /usr/local/bin/bun 2>/dev/null || true
    else
      log "  keep Bun install dir (keep-data); remove PATH link only"
      # shellcheck disable=SC2086
      $SUDO rm -f /usr/local/bin/bun 2>/dev/null || true
    fi
    manifest_remove_component "$id"
    return 0
  fi

  if [[ "$id" == "kotlin" ]]; then
    if [[ "$data_policy" == "purge" ]]; then
      # shellcheck disable=SC2086
      $SUDO rm -rf /usr/local/ysk/kotlin 2>/dev/null || true
      # shellcheck disable=SC2086
      $SUDO rm -f /usr/local/bin/kotlin /usr/local/bin/kotlinc 2>/dev/null || true
    else
      log "  keep Kotlin install dir (keep-data); remove PATH links only"
      # shellcheck disable=SC2086
      $SUDO rm -f /usr/local/bin/kotlin /usr/local/bin/kotlinc 2>/dev/null || true
    fi
    manifest_remove_component "$id"
    return 0
  fi

  if [[ "$id" == "control-plane-product" ]]; then
    log "  removing ysk-server product bits..."
    if require_cmd npm; then
      # Prefer scoped publish name; also drop legacy unscoped if present
      npm uninstall -g "${PKG:-ysk-server}" 2>/dev/null || true
      npm uninstall -g ysk-server 2>/dev/null || true
    fi
    # shellcheck disable=SC2086
    $SUDO rm -f /usr/local/bin/ysk-server 2>/dev/null || true
    rm -f "${HOME}/.local/bin/ysk-server" 2>/dev/null || true
    # shellcheck disable=SC2086
    $SUDO systemctl disable --now ysk-server 2>/dev/null || true
    # shellcheck disable=SC2086
    $SUDO rm -f /etc/systemd/system/ysk-server.service 2>/dev/null || true
    if [[ "$data_policy" == "purge" ]]; then
      local dd
      dd="$(printf '%s' "$MANIFEST_JSON" | jq -r '.dataDir // empty')"
      [[ -z "$dd" ]] && dd="$(default_data_dir)"
      if [[ -n "$dd" && "$dd" != "/" && "$dd" != "/var" && "$dd" != "/home" ]]; then
        log "  purge dataDir: $dd"
        # shellcheck disable=SC2086
        $SUDO rm -rf "$dd" 2>/dev/null || true
      fi
    else
      log "  keep dataDir (keep-data)"
    fi
    manifest_remove_component "$id"
    return 0
  fi

  if [[ "$id" == "node" ]]; then
    log "  Node.js left installed by default (shared runtime); use purge + manual apt remove if needed"
    if [[ "$data_policy" == "purge" ]]; then
      apt_remove_pkgs purge nodejs || true
    fi
    manifest_remove_component "$id"
    return 0
  fi

  stop_component_units "$id"

  local pkgs=()
  local p
  while IFS= read -r p; do
    [[ -n "$p" ]] && pkgs+=("$p")
  done < <(manifest_component_packages "$id")
  if [[ ${#pkgs[@]} -eq 0 ]]; then
    while IFS= read -r p; do
      [[ -n "$p" ]] && pkgs+=("$p")
    done < <(component_field_array "$id" "aptPackages")
  fi

  # Never remove essential meta packages that break the OS
  local filtered=()
  for p in "${pkgs[@]+"${pkgs[@]}"}"; do
    case "$p" in
      sudo|bash|coreutils|apt|dpkg) warn "  skip removing essential: $p" ;;
      *) filtered+=("$p") ;;
    esac
  done

  if [[ ${#filtered[@]} -gt 0 ]]; then
    if [[ "$data_policy" == "purge" ]]; then
      apt_remove_pkgs purge "${filtered[@]}"
    else
      apt_remove_pkgs remove "${filtered[@]}"
    fi
  fi

  if [[ "$data_policy" == "purge" ]]; then
    local d
    while IFS= read -r d; do
      [[ -z "$d" || "$d" == "/" ]] && continue
      # safety: only absolute paths under /var /etc /usr/local
      case "$d" in
        /var/*|/etc/letsencrypt|/usr/local/cargo|/usr/local/rustup)
          log "  purge data path: $d"
          # shellcheck disable=SC2086
          $SUDO rm -rf "$d" 2>/dev/null || true
          ;;
        *)
          warn "  refuse to purge unexpected path: $d"
          ;;
      esac
    done < <(manifest_component_data_paths "$id")
    while IFS= read -r d; do
      [[ -z "$d" || "$d" == "/" ]] && continue
      case "$d" in
        /var/*|/etc/letsencrypt|/usr/local/cargo|/usr/local/rustup)
          log "  purge data path: $d"
          # shellcheck disable=SC2086
          $SUDO rm -rf "$d" 2>/dev/null || true
          ;;
      esac
    done < <(component_field_array "$id" "dataPaths")
  fi

  manifest_remove_component "$id"
}

install_selected_components() {
  phase "stack-packages"
  resolve_sudo
  if ! require_cmd apt-get; then
    record_hard_fail "apt-get not found"
    return 1
  fi
  apt_update
  local id
  for id in "${SELECTED_COMPONENTS[@]+"${SELECTED_COMPONENTS[@]}"}"; do
    install_component "$id" || return 1
  done
}
