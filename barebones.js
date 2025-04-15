// barebones.js
import Fastify from "fastify";
import fastifyWs from "@fastify/websocket";

const fastify = Fastify();
fastify.register(fastifyWs);

fastify.get("/test", { websocket: true }, (connection) => {
  console.log("🔗 WebSocket connected to /test");

  connection.socket.on("message", (msg) => {
    console.log("📨 Received:", msg.toString());
    connection.socket.send("👋 Pong");
  });

  connection.socket.on("close", () => {
    console.log("❎ WebSocket closed.");
  });
});

fastify.listen({ port: 8080 }, () => {
  console.log("🚀 Server listening on http://localhost:8080");
});
