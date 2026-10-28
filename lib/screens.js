// Grands écrans connectés : un seul d’entre eux lit les vidéos, le dernier ouvert depuis le PC du serveur.

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLoopback(address) {
  return LOOPBACK.has(address);
}

function createScreenRegistry() {
  const screens = new Map();   // id -> { loopback }, dans l’ordre d’arrivée

  return {
    add(id, { loopback }) {
      screens.delete(id);
      screens.set(id, { loopback: Boolean(loopback) });
    },
    remove(id) {
      screens.delete(id);
    },
    reader() {
      let found = null;
      for (const [id, s] of screens) if (s.loopback) found = id;
      return found;
    },
    count() {
      return screens.size;
    },
  };
}

module.exports = { isLoopback, createScreenRegistry };
