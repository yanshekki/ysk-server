#!/usr/bin/env bash
# Interactive install plan selection
# shellcheck shell=bash

# Globals set: PLAN, BUNDLES_CSV, SQL_SERVER, WITH_CLAMAV, DATA_DIR,
# INSTALL_FROM_SOURCE, INSTALL_SYSTEMD, RUN_SETUP

wizard_install_run() {
  PLAN="${PLAN:-}"
  BUNDLES_CSV="${BUNDLES_CSV:-}"
  SQL_SERVER="${SQL_SERVER:-mariadb}"
  WITH_CLAMAV="${WITH_CLAMAV:-0}"
  DATA_DIR="${DATA_DIR:-$(default_data_dir)}"
  INSTALL_FROM_SOURCE="${INSTALL_FROM_SOURCE:-0}"
  INSTALL_SYSTEMD="${INSTALL_SYSTEMD:-0}"
  RUN_SETUP="${RUN_SETUP:-1}"

  if [[ "$NON_INTERACTIVE" -eq 1 ]] || ! is_tty; then
    wizard_install_apply_defaults_noninteractive
    return 0
  fi

  echo ""
  echo "============================================================"
  echo " $PRODUCT — Install wizard"
  echo "============================================================"
  echo " Log: ${INSTALL_LOG:-n/a}"
  echo ""

  # Step 1: plan
  if [[ -z "$PLAN" && -z "$BUNDLES_CSV" ]]; then
    echo "Step 1/6 — Choose an install plan:"
    echo "  1) recommended  — control-plane + web + database + defense  (default)"
    echo "  2) full         — all software bundles"
    echo "  3) minimal      — control plane only"
    echo "  4) custom       — pick bundles one by one"
    echo "  q) quit"
    local choice
    choice="$(prompt_line "Enter choice" "1")"
    case "$choice" in
      q|Q) err "Cancelled"; exit 1 ;;
      2|full) PLAN=full ;;
      3|minimal) PLAN=minimal ;;
      4|custom) PLAN=custom ;;
      *) PLAN=recommended ;;
    esac
  fi

  if [[ "$PLAN" == "custom" ]]; then
    wizard_pick_bundles
  elif [[ -n "$PLAN" && -z "$BUNDLES_CSV" ]]; then
    BUNDLES_CSV="$(plan_to_bundles "$PLAN")"
    if [[ -z "$BUNDLES_CSV" ]]; then
      record_hard_fail "unknown plan: $PLAN"
      return 1
    fi
  fi

  # ensure control-plane
  if ! csv_contains "control-plane" "$BUNDLES_CSV"; then
    BUNDLES_CSV="control-plane,${BUNDLES_CSV}"
  fi

  # Step 2: SQL
  if csv_contains "database" "$BUNDLES_CSV"; then
    echo ""
    echo "Step 2/6 — SQL server (exclusive):"
    echo "  1) MariaDB (default)"
    echo "  2) MySQL (Oracle package mysql-server)"
    local sc
    sc="$(prompt_line "Enter choice" "1")"
    case "$sc" in
      2|mysql|MySQL) SQL_SERVER=mysql; WITH_MYSQL_SERVER=1 ;;
      *) SQL_SERVER=mariadb; WITH_MYSQL_SERVER=0 ;;
    esac
  fi

  # Step 3: clamav if email
  if csv_contains "email" "$BUNDLES_CSV"; then
    echo ""
    echo "Step 3/6 — Optional ClamAV (large antivirus)?"
    if prompt_yn "Install ClamAV?" default_n; then
      WITH_CLAMAV=1
    else
      WITH_CLAMAV=0
    fi
  fi

  # Step 4: source
  echo ""
  echo "Step 4/6 — Product install source:"
  echo "  1) npm global package ysk-server (default)"
  echo "  2) from this git checkout (--from-source)"
  local src
  src="$(prompt_line "Enter choice" "1")"
  case "$src" in
    2|source|from-source) INSTALL_FROM_SOURCE=1 ;;
    *) INSTALL_FROM_SOURCE=0 ;;
  esac

  # Step 5: data dir
  echo ""
  echo "Step 5/6 — Data directory for panel state"
  DATA_DIR="$(prompt_line "Data dir" "$DATA_DIR")"

  # Step 6: systemd (product default ON when root — ready to use)
  echo ""
  echo "Step 6/6 — systemd unit (recommended: enable + start panel)?"
  local sysd_default=default_y
  if [[ "$(id -u)" -ne 0 ]]; then
    sysd_default=default_n
    echo "  (not root — unit may need sudo later)"
  fi
  if [[ "${INSTALL_SYSTEMD_EXPLICIT:-0}" -eq 1 ]]; then
    : # keep CLI flag
  elif prompt_yn "Install and start ysk-server.service?" "$sysd_default"; then
    INSTALL_SYSTEMD=1
  else
    INSTALL_SYSTEMD=0
  fi

  wizard_print_summary
  if ! prompt_yn "Proceed with installation?" default_y; then
    err "Cancelled by user"
    exit 1
  fi
}

wizard_pick_bundles() {
  echo ""
  echo "Custom bundles (space-separated numbers, control-plane always included):"
  local ids=() titles=() i=1 id
  while IFS= read -r id; do
    [[ "$id" == "control-plane" ]] && continue
    ids+=("$id")
    local t
    t="$(jq -r --arg b "$id" '.bundles[$b].title // $b' "$BUNDLES_JSON")"
    titles+=("$t")
    echo "  $i) $id — $t"
    i=$((i + 1))
  done < <(list_all_bundle_ids)

  local pick
  pick="$(prompt_line "Select numbers (e.g. 1 2 5)" "")"
  BUNDLES_CSV="control-plane"
  local n
  for n in $pick; do
    if [[ "$n" =~ ^[0-9]+$ ]] && [[ "$n" -ge 1 && "$n" -le ${#ids[@]} ]]; then
      BUNDLES_CSV="${BUNDLES_CSV},${ids[$((n - 1))]}"
    fi
  done
  PLAN=custom
}

wizard_install_apply_defaults_noninteractive() {
  if [[ -z "$PLAN" && -z "$BUNDLES_CSV" ]]; then
    PLAN=recommended
    log "Non-interactive: default plan=recommended (use --plan full for all software)"
  fi
  if [[ -n "$PLAN" && -z "$BUNDLES_CSV" ]]; then
    # legacy aliases
    case "$PLAN" in
      full|all) PLAN=full ;;
      minimal|min) PLAN=minimal ;;
      recommended|default|rec) PLAN=recommended ;;
    esac
    BUNDLES_CSV="$(plan_to_bundles "$PLAN")"
    if [[ -z "$BUNDLES_CSV" ]]; then
      record_hard_fail "unknown plan: $PLAN"
      return 1
    fi
  fi
  if ! csv_contains "control-plane" "$BUNDLES_CSV"; then
    BUNDLES_CSV="control-plane,${BUNDLES_CSV}"
  fi
  if [[ "${WITH_MYSQL_SERVER:-0}" -eq 1 ]]; then
    SQL_SERVER=mysql
  else
    SQL_SERVER="${SQL_SERVER:-mariadb}"
  fi
  WITH_CLAMAV="${WITH_CLAMAV:-0}"
  DATA_DIR="${DATA_DIR:-$(default_data_dir)}"
  log "Plan=$PLAN bundles=$BUNDLES_CSV sql=$SQL_SERVER clamav=$WITH_CLAMAV dataDir=$DATA_DIR"
}

wizard_print_summary() {
  echo ""
  echo "------------------------------------------------------------"
  echo " Install summary"
  echo "------------------------------------------------------------"
  echo " Plan:     ${PLAN:-custom}"
  echo " Bundles:  $BUNDLES_CSV"
  echo " SQL:      $SQL_SERVER"
  echo " ClamAV:   $WITH_CLAMAV"
  echo " Source:   $([[ "$INSTALL_FROM_SOURCE" -eq 1 ]] && echo from-source || echo npm)"
  echo " Data dir: $DATA_DIR"
  echo " systemd:  $INSTALL_SYSTEMD"
  echo " Log:      ${INSTALL_LOG:-n/a}"
  resolve_components_from_bundles "$BUNDLES_CSV" "$SQL_SERVER" "$WITH_CLAMAV"
  echo " Components (${#SELECTED_COMPONENTS[@]}):"
  local c
  for c in "${SELECTED_COMPONENTS[@]+"${SELECTED_COMPONENTS[@]}"}"; do
    echo "   - $c"
  done
  echo "------------------------------------------------------------"
}
