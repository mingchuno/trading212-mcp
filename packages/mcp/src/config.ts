import { constants } from "node:fs";
import { open } from "node:fs/promises";
import {
  type ClientConfig,
  environmentSchema,
} from "@mingchuno/trading212-client";
import { z } from "zod";

export class ConfigurationError extends Error {}

const credentialsSchema = z.strictObject({
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
});

async function readCredentials(path: string) {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 16_384)
      throw new ConfigurationError("Invalid credentials file.");
    if (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
      throw new ConfigurationError(
        "Credentials file must be accessible only to its owner (chmod 600).",
      );
    return credentialsSchema.parse(JSON.parse(await file.readFile("utf8")));
  } catch {
    throw new ConfigurationError(
      "Cannot read credentials file. Use an owner-only regular JSON file containing apiKey and apiSecret; on Unix run chmod 600.",
    );
  } finally {
    await file?.close();
  }
}

export async function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ClientConfig> {
  const environment = environmentSchema.safeParse(env.T212_ENV ?? "live");
  if (!environment.success)
    throw new ConfigurationError("T212_ENV must be live or demo.");
  const flag = env.T212_ALLOW_TRADING ?? "false";
  if (flag !== "true" && flag !== "false")
    throw new ConfigurationError("T212_ALLOW_TRADING must be true or false.");
  if (env.T212_CREDENTIALS_FILE && (env.T212_API_KEY || env.T212_API_SECRET))
    throw new ConfigurationError(
      "Use either T212_CREDENTIALS_FILE or the API key/secret environment variables, not both.",
    );
  const credentials = env.T212_CREDENTIALS_FILE
    ? await readCredentials(env.T212_CREDENTIALS_FILE)
    : credentialsSchema.safeParse({
        apiKey: env.T212_API_KEY,
        apiSecret: env.T212_API_SECRET,
      });
  if ("success" in credentials) {
    if (!credentials.success)
      throw new ConfigurationError(
        "Set both T212_API_KEY and T212_API_SECRET, or T212_CREDENTIALS_FILE.",
      );
    return {
      ...credentials.data,
      environment: environment.data,
      allowTrading: flag === "true",
    };
  }
  return {
    ...credentials,
    environment: environment.data,
    allowTrading: flag === "true",
  };
}
