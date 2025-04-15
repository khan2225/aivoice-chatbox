// Inside index.js or a new route file
export function registerWsTestRoute(fastify) {
    fastify.get("/ws-test", { websocket: true }, (connection) => {
      console.log("✅ WebSocket test route connected");
  
      connection.socket.on("message", (message) => {
        console.log("📨 Received from client:", message.toString());
        connection.socket.send("👋 Hello from server!");
      });
    });
  }
  