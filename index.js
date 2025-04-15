import Fastify from "fastify";
import dotenv from "dotenv";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import { handleIncomingCall } from "./routes/incoming-call.js";
import { registerMediaStream } from "./routes/media-stream.js";
import { registerWsTestRoute } from "./routes/ws-test.js";

// Load environment variables from .env file
dotenv.config();

const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error("Missing OpenAI API key. Please set it in the .env file.");
  process.exit(1);
}

if (!PORT) {
  console.error("PORT is not set. Required for Cloud Run.");
  process.exit(1);
}

// Initialize Fastify
const fastify = Fastify();

fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

//registerWsTestRoute(fastify);        // /ws-test
//handleIncomingCall(fastify);         // /incoming-call
registerMediaStream(fastify);

/*// ✅ Inline media-stream route for testing
fastify.get("/media-stream", { websocket: true }, (connection, req) => {
    console.log("✅ WebSocket connected to /media-stream");
  
    connection.socket.on("message", (msg) => {
      const message = msg.toString();
      console.log("📨 Received from client:", message);
      connection.socket.send(`👋 Pong from server: "${message}"`);
    });
  
    connection.socket.on("close", () => {
      console.log("❎ WebSocket closed");
    });
  });
  
  */
  

// Health check route
fastify.get("/", async (request, reply) => {
  reply.send({ message: "Twilio Media Stream Server is running!" });
});

fastify.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`✅ Server is listening on port ${PORT}`);
});
