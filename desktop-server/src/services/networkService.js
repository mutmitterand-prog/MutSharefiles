import os from 'node:os';

function isPrivateIPv4(address) {
  return (
    address.startsWith('192.168.') ||
    address.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address)
  );
}

// Cartes virtuelles (VM, WSL, Docker, VPN) : jamais joignables depuis le téléphone sur le Wi-Fi.
const VIRTUAL_NAME = /vethernet|virtualbox|vbox|vmware|vmnet|hyper-v|wsl|docker|tailscale|zerotier|hamachi|loopback|bluetooth|npcap|tap-|\btun\d|vpn|nordlynx|wireguard/i;
const PHYSICAL_NAME = /wi-?fi|wlan|wireless|sans fil|ethernet|^eth|^en\d|^wl/i;

/** Adresses IPv4 locales classées : carte Wi-Fi/Ethernet réelle et réseau privé d'abord. */
export function getLocalIPv4Candidates() {
  const found = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const linkLocal = entry.address.startsWith('169.254.');
      const virtual = VIRTUAL_NAME.test(name);
      const score = (linkLocal ? -4 : 0) + (virtual ? 0 : 4) + (isPrivateIPv4(entry.address) ? 2 : 0) + (PHYSICAL_NAME.test(name) ? 1 : 0);
      found.push({ name, address: entry.address, score, linkLocal, virtual });
    }
  }
  return found.sort((a, b) => b.score - a.score);
}

export function getLocalIPv4Addresses() {
  return getLocalIPv4Candidates().map((candidate) => candidate.address);
}
