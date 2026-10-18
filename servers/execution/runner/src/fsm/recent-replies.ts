type Stored<T> = { request: string; reply: T };

// The replies to the latest requests that carried a request key, so
// that a repeated request gets the same reply. The oldest key goes
// first once the store is full.
export default class RecentReplies<T> {
  private readonly replies = new Map<string, Stored<T>>();

  // eslint-disable-next-line no-useless-constructor
  constructor(private readonly limit = 256) {} // eslint-disable-line no-empty-function

  get(key: string): Stored<T> | undefined {
    return this.replies.get(key);
  }

  add(key: string, request: string, reply: T): void {
    this.replies.set(key, { request, reply });
    if (this.replies.size > this.limit) {
      const [oldest] = this.replies.keys();
      this.replies.delete(oldest);
    }
  }
}
