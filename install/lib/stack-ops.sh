#!/usr/bin/env bash
# Install / remove components by id
# shellcheck shell=bash

preseed_postfix() {
  echo "postfix postfix/main_mailer_type select No configuration" | $SUDO debconf-set-selections || true
  echo "postfix postfix/mailname string localhost" | $SUDO debconf-set-selections || true
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

# Free :80/:443 so the primary web server can bind. Nginx and Apache must not both be active.
stop_conflicting_http_servers() {
  local keep="$1" # nginx | apache2
  resolve_sudo
  local u
  if [[ "$keep" == "nginx" ]]; then
    for u in apache2 httpd; do
      if systemctl is-active --quiet "$u" 2>/dev/null; then
        log "Stopping $u so nginx can bind :80/:443"
        # shellcheck disable=SC2086
        $SUDO systemctl stop "$u" 2>/dev/null || true
        # shellcheck disable=SC2086
        $SUDO systemctl disable "$u" 2>/dev/null || true
      fi
    done
  elif [[ "$keep" == "apache2" ]]; then
    for u in nginx; do
      if systemctl is-active --quiet "$u" 2>/dev/null; then
        log "Stopping $u so apache2 can bind :80/:443"
        # shellcheck disable=SC2086
        $SUDO systemctl stop "$u" 2>/dev/null || true
        # shellcheck disable=SC2086
        $SUDO systemctl disable "$u" 2>/dev/null || true
      fi
    done
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

  # Port 80/443 exclusivity: stop the other HTTP server before install/start
  if [[ "$id" == "nginx" ]]; then
    stop_conflicting_http_servers nginx
  elif [[ "$id" == "apache2" ]]; then
    stop_conflicting_http_servers apache2
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

  # Package postinst may leave unit failed (e.g. bind conflict). Re-assert + verify.
  if [[ ${#units[@]} -gt 0 ]]; then
    if [[ "$id" == "nginx" ]]; then
      stop_conflicting_http_servers nginx
    elif [[ "$id" == "apache2" ]]; then
      stop_conflicting_http_servers apache2
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

  if [[ "$id" == "control-plane-product" ]]; then
    log "  removing ysk-server product bits..."
    if require_cmd npm; then
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
