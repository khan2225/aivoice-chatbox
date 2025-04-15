// routes/media-stream.js
import { PERSONAS } from "../config/variables.js"; // Correct path
import dotenv from "dotenv";
dotenv.config();

// Route for Twilio to handle incoming and outgoing calls
export function handleIncomingCall(fastify) {
    fastify.all("/incoming-call", async (request, reply) => {
        console.log("Incoming call");

        const personaKey = request.query.persona || "genZ"; // Fallback to 'genZ' if not provided
        const selectedPersona = PERSONAS[personaKey] || PERSONAS.genZ; // Ensure valid persona
        console.log("🧠 Selected Persona:", selectedPersona);

        const host = process.env.PUBLIC_HOST || request.headers.host;
        const domain = process.env.DOMAIN || request.headers.host;

        // You can now use `selectedPersona` in your logic if needed
        const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                              <Response>
                                  <Connect>
                                      <Stream url="wss://${domain}/media-stream?persona=${personaKey}" />
                                  </Connect>
                              </Response>`;
    
        reply.type("text/xml").send(twimlResponse);
    });
}
