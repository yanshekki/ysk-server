#!/usr/bin/env bash
# Interactive uninstall selection
# shellcheck shell=bash

# Sets: UN_SCOPE (all|bundles|components), UN_BUNDLES_CSV, UN_COMPONENTS,
#        DATA_POLICY (keep|purge), REMOVE_PRODUCT (0|1)

wizard_uninstall_run() {
  UN_SCOPE="${UN_SCOPE:-}"
  UN_BUNDLES_CSV="${UN_BUNDLES_CSV:-}"
  UN_COMPONENTS_CSV="${UN_COMPONENTS_CSV:-}"
  DATA_POLICY="${DATA_POLICY:-keep}"
  REMOVE_PRODUCT="${REMOVE_PRODUCT:-0}"
  declare -ga UN_COMPONENT_LIST=()

  if [[ "$NON_INTERACTIVE" -eq 1 ]] || ! is_tty; then
    wizard_uninstall_noninteractive
    return 0
  fi

  echo ""
  echo "============================================================"
  echo " $PRODUCT — Uninstall wizard"
  echo "============================================================"
  echo " Manifest: ${MANIFEST_PATH:-n/a}"
  echo " Log:      ${INSTALL_LOG:-n/a}"
  echo ""

  if [[ ! -f "${MANIFEST_PATH:-}" ]]; then
    warn "No stack-manifest.json found — limited uninstall (explicit components only safer)"
  else
    echo "Installed components (from manifest):"
    local id
    while IFS= read -r id; do
      echo "  - $id"
    done < <(manifest_list_component_ids)
    echo ""
  fi

  if [[ -z "$UN_SCOPE" ]]; then
    echo "Step 1/4 — What to remove?"
    echo "  1) All YSK-tracked stack components"
    echo "  2) By bundle (web, email, …)"
    echo "  3) By single component (nginx, postfix, …)"
    echo "  q) quit"
    local ch
    ch="$(prompt_line "Enter choice" "2")"
    case "$ch" in
      q|Q) err "Cancelled"; exit 1 ;;
      1|all) UN_SCOPE=all ;;
      3|components) UN_SCOPE=components ;;
      *) UN_SCOPE=bundles ;;
    esac
  fi

  case "$UN_SCOPE" in
    all)
      UN_COMPONENT_LIST=()
      while IFS= read -r id; do
        [[ -n "$id" ]] && UN_COMPONENT_LIST+=("$id")
      done < <(manifest_list_component_ids)
      # if empty manifest, expand all known non-product components is dangerous — require explicit
      if [[ ${#UN_COMPONENT_LIST[@]} -eq 0 ]]; then
        warn "Manifest empty — will only remove control-plane-product if confirmed"
      fi
      ;;
    bundles)
      if [[ -z "$UN_BUNDLES_CSV" ]]; then
        echo ""
        echo "Bundles to remove (comma-separated ids):"
        list_all_bundle_ids | sed 's/^/  - /'
        UN_BUNDLES_CSV="$(prompt_line "Bundles" "web")"
      fi
      wizard_bundles_to_components "$UN_BUNDLES_CSV"
      ;;
    components)
      if [[ -z "$UN_COMPONENTS_CSV" ]]; then
        echo ""
        UN_COMPONENTS_CSV="$(prompt_line "Component ids (comma-separated)" "nginx")"
      fi
      local c
      local IFS=','
      for c in $UN_COMPONENTS_CSV; do
        c="$(echo "$c" | tr -d '[:space:]')"
        [[ -n "$c" ]] && UN_COMPONENT_LIST+=("$c")
      done
      ;;
  esac

  echo ""
  echo "Step 2/4 — Data policy:"
  echo "  1) keep-data  — remove packages, KEEP DB/mail/data dirs (default)"
  echo "  2) purge-data — purge packages AND delete registered data paths"
  local dp
  dp="$(prompt_line "Enter choice" "1")"
  case "$dp" in
    2|purge|purge-data) DATA_POLICY=purge ;;
    *) DATA_POLICY=keep ;;
  esac

  echo ""
  echo "Step 3/4 — Remove YSK control plane product (npm CLI / unit)?"
  if prompt_yn "Also remove ysk-server product?" default_n; then
    REMOVE_PRODUCT=1
    UN_COMPONENT_LIST+=("control-plane-product")
  fi

  echo ""
  echo "Step 4/4 — Confirm"
  wizard_uninstall_summary
  echo ""
  if [[ "$DATA_POLICY" == "purge" ]]; then
    warn "PURGE will delete database/mail data paths listed in the summary!"
    local confirm
    confirm="$(prompt_line "Type yes to purge" "")"
    if [[ "$confirm" != "yes" ]]; then
      err "Purge not confirmed — aborted"
      exit 1
    fi
  else
    if ! prompt_yn "Proceed with uninstall (keep-data)?" default_y; then
      err "Cancelled"
      exit 1
    fi
  fi
}

wizard_bundles_to_components() {
  local bundles_csv="$1"
  local b c
  local IFS=','
  UN_COMPONENT_LIST=()
  for b in $bundles_csv; do
    b="$(echo "$b" | tr -d '[:space:]')"
    [[ -z "$b" || "$b" == "control-plane" ]] && continue
    while IFS= read -r c; do
      [[ -z "$c" ]] && continue
      # skip node/base when removing feature bundles
      case "$c" in
        base-deps|node|git|control-plane-product) continue ;;
      esac
      array_contains "$c" "${UN_COMPONENT_LIST[@]+"${UN_COMPONENT_LIST[@]}"}" || UN_COMPONENT_LIST+=("$c")
    done < <(bundle_components "$b")
    while IFS= read -r c; do
      [[ -z "$c" ]] && continue
      array_contains "$c" "${UN_COMPONENT_LIST[@]+"${UN_COMPONENT_LIST[@]}"}" || UN_COMPONENT_LIST+=("$c")
    done < <(bundle_optional_components "$b")
  done
}

wizard_uninstall_noninteractive() {
  if [[ -z "$UN_SCOPE" ]]; then
    if [[ -n "$UN_BUNDLES_CSV" ]]; then
      UN_SCOPE=bundles
    elif [[ -n "$UN_COMPONENTS_CSV" ]]; then
      UN_SCOPE=components
    elif [[ "${UN_ALL:-0}" -eq 1 ]]; then
      UN_SCOPE=all
    else
      record_hard_fail "non-interactive uninstall requires --all, --bundles, or --components"
      return 1
    fi
  fi
  DATA_POLICY="${DATA_POLICY:-keep}"
  case "$UN_SCOPE" in
    all)
      UN_COMPONENT_LIST=()
      while IFS= read -r id; do
        [[ -n "$id" ]] && UN_COMPONENT_LIST+=("$id")
      done < <(manifest_list_component_ids)
      REMOVE_PRODUCT=1
      ;;
    bundles)
      wizard_bundles_to_components "$UN_BUNDLES_CSV"
      ;;
    components)
      local c IFS=','
      for c in $UN_COMPONENTS_CSV; do
        c="$(echo "$c" | tr -d '[:space:]')"
        [[ -n "$c" ]] && UN_COMPONENT_LIST+=("$c")
      done
      ;;
  esac
  if [[ "$REMOVE_PRODUCT" -eq 1 ]]; then
    array_contains "control-plane-product" "${UN_COMPONENT_LIST[@]+"${UN_COMPONENT_LIST[@]}"}" || \
      UN_COMPONENT_LIST+=("control-plane-product")
  fi
  log "Uninstall scope=$UN_SCOPE data=$DATA_POLICY components=${UN_COMPONENT_LIST[*]:-}"
}

wizard_uninstall_summary() {
  echo "------------------------------------------------------------"
  echo " Uninstall summary"
  echo "------------------------------------------------------------"
  echo " Scope:    $UN_SCOPE"
  echo " Data:     $DATA_POLICY"
  echo " Product:  $REMOVE_PRODUCT"
  echo " Components (${#UN_COMPONENT_LIST[@]}):"
  local c
  for c in "${UN_COMPONENT_LIST[@]+"${UN_COMPONENT_LIST[@]}"}"; do
    echo "   - $c"
    if [[ "$DATA_POLICY" == "purge" ]]; then
      local d
      while IFS= read -r d; do
        [[ -n "$d" ]] && echo "       data: $d"
      done < <(component_field_array "$c" "dataPaths")
    fi
  done
  echo "------------------------------------------------------------"
}
