import { Logger } from '@nestjs/common';
import {
  MqttRoute,
  mqttRoutes,
  OLD_TOPICS,
  requestTopic,
} from './mqtt.config.js';

type Entry = [topic: string, route: MqttRoute];

const current = (base: string): Entry[] =>
  mqttRoutes.map((route) => [requestTopic(base, route), route]);

// A write topic of before 0.11, its route, and the topic it moved to
type Old = { topic: string; route: MqttRoute; moved: string };

const old = (base: string): Old[] =>
  (Object.entries(OLD_TOPICS) as [MqttRoute, string][]).map(
    ([route, level]) => ({
      topic: `${base}/${level}`,
      route,
      moved: requestTopic(base, route),
    }),
  );

// The request topics of a runner and the route of each: the topics of
// today, and the write topics of before 0.11, which go in 0.12
export default class RequestTopics {
  private readonly logger = new Logger(RequestTopics.name);

  private readonly routes: Map<string, MqttRoute>;

  // each old topic that no request has used yet, and where it moved
  private readonly moved: Map<string, string>;

  // Without a base topic, as before the MQTT service starts, there are
  // no request topics
  constructor(base?: string) {
    const deprecated = base === undefined ? [] : old(base);
    const entries = base === undefined ? [] : current(base);
    this.routes = new Map([
      ...entries,
      ...deprecated.map(({ topic, route }): Entry => [topic, route]),
    ]);
    this.moved = new Map(deprecated.map(({ topic, moved }) => [topic, moved]));
  }

  keys(): string[] {
    return [...this.routes.keys()];
  }

  has(topic: string): boolean {
    return this.routes.has(topic);
  }

  // Warns of the first request on each old topic
  get(topic: string): MqttRoute | undefined {
    const moved = this.moved.get(topic);
    if (this.moved.delete(topic)) {
      this.logger.warn(
        `${topic} moved to ${moved}; the old topic goes in 0.12`,
      );
    }
    return this.routes.get(topic);
  }
}
