// Decides when a changed state document is sent. A document that
// differs from the last one sent only in its property values waits
// until the interval since that one has passed, so that a fast feed
// gives one notification per interval; any other change is sent at
// once, with the property values that were held back.
export default class StateHold {
  // the last document sent, without its properties, and when
  private control: string | undefined;

  private sentAt = -Infinity;

  private timer: NodeJS.Timeout | undefined;

  // interval gives the milliseconds between such documents, and flush
  // sends the document as it is once a held one is due
  constructor(
    private readonly interval: () => number,
    private readonly flush: () => void,
  ) {}

  // Whether to send now a document with the given content apart from
  // its properties; if not, flush is called when it is due
  due(control: string, now = Date.now()): boolean {
    const wait = this.sentAt + this.interval() - now;
    if (control === this.control && wait > 0) {
      this.timer ??= setTimeout(() => this.release(), wait).unref();
      return false;
    }
    this.cancel();
    this.control = control;
    this.sentAt = now;
    return true;
  }

  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private release(): void {
    this.timer = undefined;
    this.flush();
  }
}
