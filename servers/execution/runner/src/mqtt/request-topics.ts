import { MqttRoute, mqttRoutes, requestTopic } from './mqtt.config.js';

const entries = (base: string): [string, MqttRoute][] =>
  mqttRoutes.map((route) => [requestTopic(base, route), route]);

// The request topics of a runner and the route of each
export default class RequestTopics {
  private readonly routes: Map<string, MqttRoute>;

  // Without a base topic, as before the MQTT service starts, there are
  // no request topics
  constructor(base?: string) {
    this.routes = new Map(base === undefined ? [] : entries(base));
  }

  keys(): string[] {
    return [...this.routes.keys()];
  }

  has(topic: string): boolean {
    return this.routes.has(topic);
  }

  get(topic: string): MqttRoute | undefined {
    return this.routes.get(topic);
  }
}
