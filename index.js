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

// Initialize Fastify
const fastify = Fastify();

// Register plugins first
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Register all routes AFTER websocket plugin
registerWsTestRoute(fastify);        // /ws-test
registerMediaStream(fastify);        // /media-stream
handleIncomingCall(fastify);         // /incoming-call

// Optional root route for basic health check
fastify.get("/", async (request, reply) => {
  reply.send({ message: "Twilio Media Stream Server is running!" });
});

// Start server
fastify.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`✅ Server is listening on port ${PORT}`);
});

