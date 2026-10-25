// disconnected includes a client that is reconnecting to the broker
export type MqttHealth = 'connected' | 'disconnected' | 'disabled';

export type DatabaseMode = 'file' | 'memory';

// uptime is in whole seconds since the process started
export type HealthDto = {
  status: 'ok' | 'degraded';
  uptime: number;
  mqtt: MqttHealth;
  database: DatabaseMode;
};

export const healthReport = (
  mqtt: MqttHealth,
  database: DatabaseMode,
): HealthDto => ({
  status: mqtt === 'disconnected' ? 'degraded' : 'ok',
  uptime: Math.floor(process.uptime()),
  mqtt,
  database,
});
