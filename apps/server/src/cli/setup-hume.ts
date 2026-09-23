/**
 * Create the Hume EVI config that routes the voice conversation to this server's CLM endpoint.
 *
 *   PUBLIC_URL=https://<your-tunnel>.ngrok.app npm run setup:hume -- [--name "My Tutor"] [--voice "Ava Song"] [--silence 800] [--interrupt 300]
 *
 * Prints the config id; put it in .env as HUME_CONFIG_ID. Run it again after changing the tunnel URL,
 * the voice, or the silence settings: each run creates a new config on Hume's side.
 */
import { config } from "../config.js";
import { createEviConfig } from "../voice/hume.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const opt = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const publicUrl = opt("--url") ?? config.hume.publicUrl;
  if (!publicUrl) {
    console.error("Set PUBLIC_URL (or pass --url) to the public HTTPS base URL of this server, e.g. an ngrok tunnel.");
    process.exit(1);
  }
  const silence = opt("--silence");
  const interrupt = opt("--interrupt");
  const { id, version, modelResource } = await createEviConfig({
    publicUrl,
    name: opt("--name"),
    voiceName: opt("--voice"),
    endOfTurnSilenceMs: silence ? Number(silence) : undefined,
    minInterruptionMs: interrupt ? Number(interrupt) : undefined,
  });
  console.log(`Created EVI config ${id} (version ${version})`);
  console.log(`CLM endpoint Hume will call: ${modelResource || "(not echoed back; check the config at app.hume.ai/evi/configs)"}`);
  console.log(`\nAdd to .env:\nHUME_CONFIG_ID=${id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
