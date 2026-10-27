import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import Signer from 'src/auth/signer';
import { NotificationDto, offlineNotification } from 'src/dto/notify.dto';
import { message, mqttConfig, packet, setup } from './mqtt.fixture';

const signer = new Signer(generateKeyPairSync('ed25519').privateKey, 'dt-1');

const notification: NotificationDto = {
  kind: 'state',
  id: 'dt-1',
  time: '2026-10-25T10:00:00.000Z',
  data: {},
};

// A compact JWS: three base64url segments
const JWS = /^[\w-]+\.[\w-]+\.[\w-]+$/;

describe('MQTT service with a signing key', () => {
  it('Should connect with a signed will', () => {
    const { connect, service } = setup(mqttConfig, undefined, signer);
    service.start();
    const { will } = connect.mock.calls[0][1];

    expect(will?.payload).toMatch(JWS);
    expect(will?.payload).toBe(
      signer.encode(offlineNotification('hospital-1', null)),
    );
  });

  it('Should publish a signed response', async () => {
    const { client, service } = setup(mqttConfig, undefined, signer);
    service.start();

    await message(client, 'dtaas/runner/status', Buffer.alloc(0), packet());

    const [, payload] = client.publishAsync.mock.calls[0];
    expect(payload).toMatch(JWS);
    expect(payload).toBe(signer.encode({ status: 'success' }));
  });

  it('Should publish a signed notification', async () => {
    const { client, service } = setup(mqttConfig, undefined, signer);
    service.start();

    await service.notify('state', notification, true);

    expect(client.publishAsync).toHaveBeenCalledWith(
      'dtaas/runner/notify/state',
      signer.encode(notification),
      { qos: 1, retain: true },
    );
    expect(client.publishAsync.mock.calls[0][1]).toMatch(JWS);
  });
});
