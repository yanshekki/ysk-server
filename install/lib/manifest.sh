#!/usr/bin/env bash
# stack-manifest.json read/write (requires jq)
# shellcheck shell=bash

manifest_require_jq() {
  if ! require_cmd jq; then
    # try install jq via apt if we can
    resolve_sudo || true
    if require_cmd apt-get; then
      # shellcheck disable=SC2086
      $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y jq 2>/dev/null || true
    fi
  fi
  if ! require_cmd jq; then
    record_hard_fail "jq is required for stack manifest"
    return 1
  fi
}

manifest_empty_json() {
  local plan="$1"
  local data_dir="$2"
  local now
  now="$(date -Is 2>/dev/null || date)"
  cat <<EOF
{
  "version": 1,
  "product": "ysk-server",
  "installedAt": "$now",
  "updatedAt": "$now",
  "plan": "$plan",
  "bundles": [],
  "options": {},
  "components": {},
  "dataDir": "$data_dir",
  "installLog": "${INSTALL_LOG:-}"
}
EOF
}

manifest_load() {
  local path="${1:-$(default_manifest_path)}"
  MANIFEST_PATH="$path"
  if [[ -f "$path" ]]; then
    MANIFEST_JSON="$(cat "$path")"
  else
    MANIFEST_JSON="$(manifest_empty_json "${PLAN:-unknown}" "$(default_data_dir)")"
  fi
}

manifest_save() {
  local path="${1:-${MANIFEST_PATH:-$(default_manifest_path)}}"
  local dir
  dir="$(dirname "$path")"
  resolve_sudo || true
  if [[ ! -d "$dir" ]]; then
    # shellcheck disable=SC2086
    $SUDO mkdir -p "$dir" 2>/dev/null || mkdir -p "$dir"
  fi
  local tmp
  tmp="$(mktemp)"
  printf '%s\n' "$MANIFEST_JSON" | jq -c . >/dev/null 2>&1 || {
    err "manifest JSON invalid; not saving"
    rm -f "$tmp"
    return 1
  }
  printf '%s\n' "$MANIFEST_JSON" | jq '.' >"$tmp"
  if [[ -w "$dir" ]] || [[ "$(id -u)" -eq 0 ]]; then
    mv "$tmp" "$path"
  else
    # shellcheck disable=SC2086
    $SUDO mv "$tmp" "$path"
  fi
  log "Manifest saved: $path"
  MANIFEST_PATH="$path"
}

manifest_set_meta() {
  local plan="$1"
  local data_dir="$2"
  local bundles_csv="$3"
  local sql="${4:-mariadb}"
  local clamav="${5:-false}"
  local now
  now="$(date -Is 2>/dev/null || date)"
  local bundles_json
  bundles_json="$(printf '%s' "$bundles_csv" | tr ',' '\n' | sed '/^$/d' | jq -R . | jq -s .)"
  MANIFEST_JSON="$(printf '%s' "$MANIFEST_JSON" | jq \
    --arg plan "$plan" \
    --arg dd "$data_dir" \
    --arg now "$now" \
    --arg log "${INSTALL_LOG:-}" \
    --argjson bundles "$bundles_json" \
    --arg sql "$sql" \
    --argjson clamav "$clamav" \
    '.plan=$plan
     | .dataDir=$dd
     | .updatedAt=$now
     | .installLog=$log
     | .bundles=$bundles
     | .options.sqlServer=$sql
     | .options.clamav=$clamav
     | if .installedAt == null or .installedAt == "" then .installedAt=$now else . end')"
}

manifest_add_component() {
  local id="$1"
  local packages_csv="${2:-}"
  local units_csv="${3:-}"
  local data_csv="${4:-}"
  local source="${5:-apt}"
  local now
  now="$(date -Is 2>/dev/null || date)"
  local pkgs units dpaths
  if [[ -n "$packages_csv" ]]; then
    pkgs="$(printf '%s' "$packages_csv" | tr ',' '\n' | sed '/^$/d' | jq -R . | jq -s .)"
  else
    pkgs='[]'
  fi
  if [[ -n "$units_csv" ]]; then
    units="$(printf '%s' "$units_csv" | tr ',' '\n' | sed '/^$/d' | jq -R . | jq -s .)"
  else
    units='[]'
  fi
  if [[ -n "$data_csv" ]]; then
    dpaths="$(printf '%s' "$data_csv" | tr ',' '\n' | sed '/^$/d' | jq -R . | jq -s .)"
  else
    dpaths='[]'
  fi
  MANIFEST_JSON="$(printf '%s' "$MANIFEST_JSON" | jq \
    --arg id "$id" \
    --arg now "$now" \
    --arg src "$source" \
    --argjson pkgs "$pkgs" \
    --argjson units "$units" \
    --argjson dpaths "$dpaths" \
    '.components[$id] = {
      source: $src,
      packages: $pkgs,
      units: $units,
      dataPaths: $dpaths,
      installedAt: $now
    } | .updatedAt=$now')"
}

manifest_remove_component() {
  local id="$1"
  local now
  now="$(date -Is 2>/dev/null || date)"
  MANIFEST_JSON="$(printf '%s' "$MANIFEST_JSON" | jq --arg id "$id" --arg now "$now" \
    'del(.components[$id]) | .updatedAt=$now')"
}

manifest_list_component_ids() {
  printf '%s' "$MANIFEST_JSON" | jq -r '.components | keys[]?' 2>/dev/null || true
}

manifest_component_packages() {
  local id="$1"
  printf '%s' "$MANIFEST_JSON" | jq -r --arg id "$id" '.components[$id].packages[]?' 2>/dev/null || true
}

manifest_component_units() {
  local id="$1"
  printf '%s' "$MANIFEST_JSON" | jq -r --arg id "$id" '.components[$id].units[]?' 2>/dev/null || true
}

manifest_component_data_paths() {
  local id="$1"
  printf '%s' "$MANIFEST_JSON" | jq -r --arg id "$id" '.components[$id].dataPaths[]?' 2>/dev/null || true
}

manifest_has_component() {
  local id="$1"
  printf '%s' "$MANIFEST_JSON" | jq -e --arg id "$id" '.components[$id] != null' >/dev/null 2>&1
}

# Expand plan id → comma-separated bundles
plan_to_bundles() {
  local plan="$1"
  jq -r --arg p "$plan" '.plans[$p].bundles // empty | join(",")' "$BUNDLES_JSON" 2>/dev/null
}

bundle_components() {
  local bundle="$1"
  # returns space-separated component ids (required only)
  jq -r --arg b "$bundle" '.bundles[$b].components // empty | .[]' "$BUNDLES_JSON" 2>/dev/null
}

bundle_optional_components() {
  local bundle="$1"
  jq -r --arg b "$bundle" '.bundles[$b].optionalComponents // empty | .[]' "$BUNDLES_JSON" 2>/dev/null
}

component_field_array() {
  local id="$1"
  local field="$2"
  jq -r --arg id "$id" --arg f "$field" '.components[$id][$f] // empty | if type=="array" then .[] else empty end' "$COMPONENTS_JSON" 2>/dev/null
}

component_is_optional() {
  local id="$1"
  jq -e --arg id "$id" '.components[$id].optional == true' "$COMPONENTS_JSON" >/dev/null 2>&1
}

list_all_bundle_ids() {
  jq -r '.bundles | keys[]' "$BUNDLES_JSON" 2>/dev/null
}

list_plan_ids() {
  jq -r '.plans | keys[]' "$BUNDLES_JSON" 2>/dev/null
}
