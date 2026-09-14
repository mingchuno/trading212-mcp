export class MetadataCache<T> {
  #cached?: { value: T; fetchedAt: string; expiresAt: number };
  #pending?: Promise<{ value: T; fetchedAt: string; expiresAt: number }>;

  constructor(private readonly ttlMs = 600_000) {}

  async get(load: () => Promise<T>) {
    if (this.#cached && this.#cached.expiresAt > Date.now())
      return { ...this.#cached, cached: true };
    if (!this.#pending) {
      this.#pending = load()
        .then((value) => {
          this.#cached = {
            value,
            fetchedAt: new Date().toISOString(),
            expiresAt: Date.now() + this.ttlMs,
          };
          return this.#cached;
        })
        .finally(() => {
          this.#pending = undefined;
        });
    }
    return { ...(await this.#pending), cached: false };
  }
}
