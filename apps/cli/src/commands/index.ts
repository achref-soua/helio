/**
 * Command registry. Each batch lands its commands here:
 *   D5 — up, down, status, logs, seed, uninstall
 *   D6 — update, rotate-key
 *   E4 — backup, restore
 */
import './backup';
import './doctor';
import './install';
import './lifecycle';
import './rotate-key';
import './update';
