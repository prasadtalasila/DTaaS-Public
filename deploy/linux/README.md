# Install DTaaS on Ubuntu OS

This directory contains code for running DTaaS application on Ubuntu 20.04 Operating System. The setup requires a machine which can spare 4GB RAM, 3 vCPUs and 50GB Hard Disk space to the DTaaS software.

A dummy **foo.com** URL has been used for illustration. Please change this to your unique website URL.

Please follow these steps to make this work in your local environment.

1. Create TLS certificates for Traefik gateway server. This enables serving of DTaaS application HTTPS protocol. If your webserver has direct connection to Internet and has a valid DNS name, please use [LetsEncrypt](https://letsencrypt.org/getting-started/) to generate the required certificates. Otherwise you can use follow the instructions in [README](../../ssl/README.md) of the private certificate generator.
1. Copy the generated TLS certificates in [certs](gateway/certs/) directory. Use `fullchain.pem` as name for public key and `privkey.pem` as name for private key.
1. The `users.sh` and `files.sh` scripts create the required workspaces for the users. Please run them before launching the gateway.
1. Replace the default [gateway config directory](../../servers/config/gateway/) with the gateway directory available in this directory.
1. Start the gateway

```bash
cd ~/DTaaS/servers/config/gateway
sudo docker run -d \               
  --network=host \
  --name "traefik-gateway" \
  -v "$PWD/traefik.yml:/etc/traefik/traefik.yml" \
  -v "$PWD/dynamic:/etc/traefik/dynamic" \
  -v "$PWD/certs:/etc/traefik/certs" \
  -v "$PWD/auth:/etc/traefik/auth" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  traefik:v2.5
```

Change the React website configuration in _client/build/env.js_.

```js
window.env = {
  REACT_APP_ENVIRONMENT: 'development',
  REACT_APP_URL_LIB: 'http://foo.com/user1/shared/filebrowser/files/workspace/?token=admin',
  REACT_APP_URL_DT: 'http://foo.com/user1/lab',
  REACT_APP_URL_WORKBENCH: 'http://foo.com/user1',
};
```

Serve the react website.

```bash
cd ~/DTaaS/client
nohup serve -s build -l 4000 & disown
```

Now you should be able to access the DTaaS application at: _http://foo.com_
