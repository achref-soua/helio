/**
 * Command registry. Each batch lands its commands here:
 *   D5 — up, down, status, logs, seed, uninstall
 *   D6 — update, rotate-key
 *   E4 — backup, restore
 */
import './doctor';
import './install';
import './lifecycle';
