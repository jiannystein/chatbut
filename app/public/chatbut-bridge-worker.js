const rooms = new Map();

function roomFor(token) {
  if (!rooms.has(token)) {
    rooms.set(token, {
      configurator: null,
      runtimes: new Set(),
    });
  }
  return rooms.get(token);
}

function send(port, message) {
  try {
    port.postMessage(message);
    return true;
  } catch {
    return false;
  }
}

self.onconnect = (event) => {
  const port = event.ports[0];
  let role = "";
  let room = null;

  port.onmessage = (messageEvent) => {
    const message = messageEvent.data;
    if (!message || typeof message !== "object") return;

    if (message.type === "chatbut:register") {
      const token = String(message.token ?? "");
      const requestedRole = message.role;
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return;
      if (requestedRole !== "configurator" && requestedRole !== "runtime") return;

      role = requestedRole;
      room = roomFor(token);
      if (role === "configurator") {
        room.configurator = port;
      } else {
        room.runtimes.add(port);
      }
      send(port, { type: "chatbut:registered", role });
      return;
    }

    if (!room || !role) return;
    if (role === "runtime") {
      if (room.configurator && !send(room.configurator, message)) {
        room.configurator = null;
      }
      return;
    }

    for (const runtime of room.runtimes) {
      if (!send(runtime, message)) room.runtimes.delete(runtime);
    }
  };

  port.start();
};
