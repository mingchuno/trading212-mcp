import {
  type Trading212Client,
  Trading212Error,
} from "@trading212-local/client";
import { z } from "zod";

export function publicError(error: unknown) {
  if (error instanceof Trading212Error) return error.toJSON();
  if (error instanceof z.ZodError)
    return {
      code: "INVALID_ARGUMENT",
      message: error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    };
  return {
    code: "REQUEST_FAILED",
    message:
      "Request could not be completed. Check arguments and configuration.",
  };
}

export function toolResult(
  api: Trading212Client,
  action: () => Promise<unknown>,
) {
  return action().then(
    (data) => {
      const structuredContent = {
        environment: api.environment,
        fetchedAt: new Date().toISOString(),
        data,
      };
      return {
        structuredContent,
        content: [
          { type: "text" as const, text: JSON.stringify(structuredContent) },
        ],
      };
    },
    (error) => {
      const structuredContent = {
        environment: api.environment,
        error: publicError(error),
      };
      return {
        isError: true,
        structuredContent,
        content: [
          { type: "text" as const, text: JSON.stringify(structuredContent) },
        ],
      };
    },
  );
}

export function bounded<T>(items: T[], limit: number, offset = 0) {
  const nextOffset = offset + limit < items.length ? offset + limit : null;
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    nextOffset,
    truncated: nextOffset !== null,
  };
}

export async function section(action: () => Promise<unknown>) {
  try {
    const data = await action();
    return { fetchedAt: new Date().toISOString(), data };
  } catch (error) {
    return { fetchedAt: new Date().toISOString(), error: publicError(error) };
  }
}
