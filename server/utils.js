// server/utils.js
export function send(ws, data) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}
