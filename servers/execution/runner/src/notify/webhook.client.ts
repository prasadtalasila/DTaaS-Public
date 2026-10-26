import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import Config from '../config/configuration.service.js';
import { NotificationDto } from '../dto/notify.dto.js';
import { NotifyConfig } from './notify.config.js';

// milliseconds that one post may take
const TIMEOUT = 5000;

// milliseconds that the single post at shutdown may take
const ONCE_TIMEOUT = 2000;

// milliseconds before each retry
const RETRY_DELAYS = [1000, 2000, 4000];

type Attempt = 'done' | 'retry';

const headers = (token: string | undefined): Record<string, string> =>
  token === undefined
    ? { 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

// Posts each notification to the webhook of the configuration, if it
// has one. A network error, a timeout or a 5xx response is retried
// after 1, 2 and 4 s; any other response is final.
@Injectable()
export default class WebhookClient implements BeforeApplicationShutdown {
  private readonly logger = new Logger(WebhookClient.name);

  // aborts the posts in progress and ends the waits for retries
  private readonly controller = new AbortController();

  // a failure is logged once, until a delivery succeeds
  private failing = false;

  constructor(private readonly config: Config) {}

  // Resolves once the notification is delivered or given up
  post(notification: NotificationDto): Promise<void> {
    const webhook = this.config.getNotify();
    if (webhook === undefined) {
      return Promise.resolve();
    }
    return this.deliver(webhook, JSON.stringify(notification), 0);
  }

  // Posts the notification once, without a retry, even after shutdown
  async sendOnce(notification: NotificationDto): Promise<void> {
    const webhook = this.config.getNotify();
    if (webhook !== undefined) {
      const body = JSON.stringify(notification);
      await this.attempt(webhook, body, AbortSignal.timeout(ONCE_TIMEOUT));
    }
  }

  // The deliveries in progress are abandoned
  beforeApplicationShutdown(): void {
    this.controller.abort();
  }

  // Recurses, so that each attempt waits for the one before
  private async deliver(
    webhook: NotifyConfig,
    body: string,
    retry: number,
  ): Promise<void> {
    if (this.controller.signal.aborted) {
      return;
    }
    const signal = AbortSignal.any([
      this.controller.signal,
      AbortSignal.timeout(TIMEOUT),
    ]);
    const attempt = await this.attempt(webhook, body, signal);
    if (attempt === 'retry' && retry < RETRY_DELAYS.length) {
      await this.wait(RETRY_DELAYS[retry]);
      await this.deliver(webhook, body, retry + 1);
    }
  }

  // Only the abort at shutdown rejects with an AbortError, as a timeout
  // rejects with a TimeoutError; that abort is no failure
  private async attempt(
    webhook: NotifyConfig,
    body: string,
    signal: AbortSignal,
  ): Promise<Attempt> {
    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: headers(webhook.token),
        body,
        signal,
      });
      // the body is not read; discarding it frees the connection
      await response.body?.cancel();
      return this.answered(webhook.url, response.status);
    } catch (error) {
      if ((error as Error | undefined)?.name === 'AbortError') {
        return 'done';
      }
      return this.failed(webhook.url, String(error));
    }
  }

  // A 4xx response is a failure that a retry would repeat
  private answered(url: string, status: number): Attempt {
    if (status < 400) {
      this.failing = false;
      return 'done';
    }
    const attempt = this.failed(url, `HTTP status ${status}`);
    return status < 500 ? 'done' : attempt;
  }

  // The url may hold credentials, so only its host is logged
  private failed(url: string, reason: string): Attempt {
    if (!this.failing) {
      this.logger.error(
        `Webhook notification to ${new URL(url).host} failed: ${reason}`,
      );
    }
    this.failing = true;
    return 'retry';
  }

  // The timer does not hold the process open, and shutdown ends the wait
  private wait(delay: number): Promise<void> {
    const { signal } = this.controller;
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, delay);
      timer.unref();
      signal.addEventListener('abort', done);
    });
  }
}
