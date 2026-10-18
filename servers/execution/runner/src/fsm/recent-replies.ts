type Stored<T> = { request: string; reply: T };

// The replies to the latest requests that carried a request key, so
// that a repeated request gets the same reply. The oldest key goes
// first once the store is full. An empty key, or none, marks no
// request.
export default class RecentReplies<T> {
  private readonly replies = new Map<string, Stored<T>>();

  // eslint-disable-next-line no-useless-constructor
  constructor(private readonly limit = 256) {} // eslint-disable-line no-empty-function

  get(key: string | undefined): Stored<T> | undefined {
    return key ? this.replies.get(key) : undefined;
  }

  add(key: string | undefined, request: string, reply: T): void {
    if (!key) {
      return;
    }
    this.replies.set(key, { request, reply });
    if (this.replies.size > this.limit) {
      const [oldest] = this.replies.keys();
      this.replies.delete(oldest);
    }
  }
}
