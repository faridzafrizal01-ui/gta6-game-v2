// Saving Solmar Bay: a small JSON snapshot in localStorage. Autosaves after
// every finished mission and on demand from the pause menu. Loading restores
// cash, story progress, health and the player's position.

const KEY = 'solmar-bay-save-v1';

export function saveGame(G) {
  try {
    const data = {
      version: 1,
      cash: G.player.cash,
      health: G.player.health,
      missionIndex: G.mission.index,
      x: Math.round(G.player.x),
      y: Math.round(G.player.y),
      sound: G.sound.enabled,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

export function hasSave() {
  return loadGame() !== null;
}
