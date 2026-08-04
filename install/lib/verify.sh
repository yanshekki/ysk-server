#!/usr/bin/env bash
# Verify selected components after install
# shellcheck shell=bash

verify_component_units() {
  local id="$1"
  local units=()
  local u st
  while IFS= read -r u; do
    [[ -n "$u" ]] && units+=("$u")
  done < <(component_field_array "$id" "units")
  [[ ${#units[@]} -eq 0 ]] && return 0
  for u in "${units[@]}"; do
    st="$(systemctl is-active "$u" 2>/dev/null || true)"
    st="$(echo "$st" | head -1 | tr -d '[:space:]')"
    if [[ "$st" == "active" ]]; then
      log "  verify OK: $id unit $u → active"
      continue
    fi
    if component_is_optional "$id"; then
      warn "  verify soft: $id unit $u → ${st:-unknown}"
      SOFT_SKIPS+=("verify-unit:$id:$u:$st")
      continue
    fi
    # nginx often fails with apache still holding :80 — call it out
    if [[ "$u" == "nginx" && "$st" == "failed" ]]; then
      if systemctl is-active --quiet apache2 2>/dev/null || systemctl is-active --quiet httpd 2>/dev/null; then
        VERIFY_FAIL+=("${id}: unit nginx failed — apache/httpd is active on :80 (stop it: systemctl stop apache2)")
        err "  verify FAIL: nginx failed while apache2/httpd is active (port conflict)"
        return 1
      fi
    fi
    VERIFY_FAIL+=("${id}: unit $u is ${st:-unknown} (want active)")
    err "  verify FAIL: $id unit $u → ${st:-unknown}"
    return 1
  done
  return 0
}

verify_component_bins() {
  local id="$1"
  local bins=()
  local b path found=0
  while IFS= read -r b; do
    [[ -n "$b" ]] && bins+=("$b")
  done < <(component_field_array "$id" "bins")
  if [[ ${#bins[@]} -eq 0 ]]; then
    VERIFY_OK+=("${id} (no bins)")
    log "  verify OK: $id (no bin probe)"
    # still check units if declared
    verify_component_units "$id" || return 1
    return 0
  fi
  for b in "${bins[@]}"; do
    if path="$(find_bin "$b" 2>/dev/null)"; then
      VERIFY_OK+=("${id} (${path})")
      log "  verify OK: ${id} → ${path}"
      verify_component_units "$id" || return 1
      return 0
    fi
  done
  # optional components: soft fail
  if component_is_optional "$id"; then
    warn "  verify skip optional: $id missing bins [${bins[*]}]"
    SOFT_SKIPS+=("verify:$id")
    return 0
  fi
  VERIFY_FAIL+=("${id}: missing any of [${bins[*]}]")
  err "  verify FAIL: $id — none of [${bins[*]}]"
  return 1
}

verify_selected_components() {
  phase "verify-catalog"
  export PATH="/usr/local/bin:/usr/local/cargo/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin:${HOME}/.cargo/bin:${PATH:-}"
  VERIFY_OK=()
  VERIFY_FAIL=()
  local id failed=0
  log "Post-install verify for selected components..."
  for id in "$@"; do
    [[ -z "$id" ]] && continue
    # control-plane-product: check node always; ysk-server may be path wrapper
    if [[ "$id" == "control-plane-product" ]]; then
      if find_bin node >/dev/null 2>&1; then
        VERIFY_OK+=("control-plane-product (node)")
        log "  verify OK: control-plane-product → node"
        if find_bin ysk-server >/dev/null 2>&1 || find_bin "$CLI" >/dev/null 2>&1; then
          log "  verify OK: CLI on PATH"
        else
          warn "  CLI not on PATH yet (may need new shell or --from-source wrapper)"
        fi
        continue
      fi
      VERIFY_FAIL+=("control-plane-product: node missing")
      failed=1
      continue
    fi
    verify_component_bins "$id" || failed=1
  done
  log "Verify summary: ok=${#VERIFY_OK[@]} fail=${#VERIFY_FAIL[@]} soft=${#SOFT_SKIPS[@]}"
  if [[ "$failed" -ne 0 || ${#VERIFY_FAIL[@]} -gt 0 ]]; then
    record_hard_fail "component verify failed (${#VERIFY_FAIL[@]} missing)"
    local f
    for f in "${VERIFY_FAIL[@]}"; do err "  - $f"; done
    return 1
  fi
  log "All selected component probes PASSED"
  return 0
}
