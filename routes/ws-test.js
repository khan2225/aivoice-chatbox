// routes/ws-test.js
export function registerWsTestRoute(fastify) {
    fastify.get("/ws-test", { websocket: true }, (connection, req) => {
      console.log("WebSocket test route connected");
  
      connection.socket.on("message", (message) => {
        const msg = message.toString();
        console.log("Received from client:", msg);
        connection.socket.send(Buffer.from("Hello from server!"));

      });
  
      connection.socket.on("close", () => {
        console.log("Client disconnected from /ws-test");
      });
    });
  }
  